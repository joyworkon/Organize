/**
 * B07-3 附件可携带备份——恢复侧核心库（设计 docs/attachment-portable-backup-design.md §5/§6）。
 *
 * 恢复顺序（§5）：先文件后 JSON——本模块产出「重映射」交由 prepareRestorePayload
 * 的内容重写层消费（B07-4 演练/UI 接入）。
 *
 * 安全合同（§5-1 校验先行）：任何校验失败（坏包/白名单外条目/非 STORE/sha 不符/
 * manifest 不一致）→ 抛错退出，**零 Storage 上传、零数据库写入**。
 * 「包内缺文件」与「上传失败」按设计记入 missing[] 不阻断。
 *
 * 防炸弹：解包前先解析 zip 中央目录（不解压任何数据）——条目数/解压总量护栏 +
 * 只接受 STORE 条目（本包格式既定，deflate 炸弹直接拒绝）；超限在解压前失败。
 * zip64（>4GB/条目数溢出标记）明确不支持（护栏本身就排除该量级）。
 *
 * 依赖注入（单测免真实 Storage）：uploadObject / publicUrl。
 */
import { unzipSync } from "fflate";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ATTACHMENT_PACKAGE_VERSION,
  AttachmentPackageError,
  sha256Hex,
  PACKAGE_MAX_FILES,
  PACKAGE_MAX_TOTAL_BYTES,
  isValidPackageKey,
  type AttachmentManifest,
  type AttachmentManifestFile,
  type PackageBucket,
} from "./attachment-package";

export class AttachmentRestoreError extends AttachmentPackageError {}

const MANIFEST_NAME = "manifest.json";
/** 解压总量 / zip 字节 的理论上限已由 STORE-only 隐含（ratio≈1）；此比例护栏兜底畸形包 */
const MAX_RATIO = 8;

export interface PackageRestoreOptions {
  /** 用户会话客户端（Storage 重放走属主权限，不引入 service_role——设计 §6） */
  supabase: SupabaseClient;
  /** 新账号 user id（重放路径前缀 {userId}/{uuid}.{ext}，原路径含旧 userId 不可复用） */
  userId: string;
  maxTotalBytes?: number;
  maxFiles?: number;
  /** 注入上传（单测）；默认 supabase-js storage .upload（用户会话） */
  uploadObject?: (
    bucket: PackageBucket,
    path: string,
    bytes: Uint8Array,
    mimeType: string
  ) => Promise<void>;
  /** 注入公开 URL 生成（单测）；默认 storage .getPublicUrl */
  publicUrl?: (bucket: PackageBucket, path: string) => string;
  uuid?: () => string;
}

export interface AttachmentRestoreMapping {
  manifest: AttachmentManifest;
  /** 内容 URL 重映射依据：旧完整 URL → 新完整 URL */
  urlMap: Array<{ old_url: string; new_url: string }>;
  /**
   * 附件坐标重映射依据：`${bucket}/${原path}` → 新坐标（task_attachments 行重写 +
   * 内容 URL 按坐标查找，比整串 URL 匹配对宿主变更更稳健）
   */
  pathMap: Map<string, { bucket: PackageBucket; path: string; newUrl: string }>;
  /** 缺文件/上传失败清单（不阻断恢复；对应 URL 原样保留为失效引用） */
  missing: Array<{ file_key: string; old_urls: string[]; reason: string }>;
  migrated: { files: number; bytes: number };
}

// ---- zip 中央目录预检（不解压任何数据） ----

interface ZipEntryInfo {
  name: string;
  method: number;
  uncompressedSize: number;
}

/**
 * 解析 zip 中央目录（EOCD → central directory 条目）。
 * 只读元数据，不碰条目数据——护栏失败在解压前发生。
 */
function readCentralDirectory(bytes: Uint8Array): ZipEntryInfo[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD 签名 0x06054b50；最短 22 字节，评论区最长 65535——从尾部找
  let eocd = -1;
  const scanStart = Math.max(0, bytes.length - 22 - 65_536);
  for (let i = bytes.length - 22; i >= scanStart; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new AttachmentRestoreError("坏包：zip 结束记录（EOCD）缺失");
  const entryCount = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new AttachmentRestoreError("坏包：zip64 不支持（护栏量级下不应出现）");
  }
  if (cdOffset + cdSize > bytes.length) {
    throw new AttachmentRestoreError("坏包：中央目录越界");
  }
  const decoder = new TextDecoder();
  const entries: ZipEntryInfo[] = [];
  let at = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) {
      throw new AttachmentRestoreError("坏包：中央目录条目损坏");
    }
    const method = view.getUint16(at + 10, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.push({ name, method, uncompressedSize });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function preflightZipStructure(
  bytes: Uint8Array,
  maxTotalBytes: number,
  maxFiles: number
): void {
  const entries = readCentralDirectory(bytes);
  if (entries.length > maxFiles + 1) {
    throw new AttachmentRestoreError(
      `坏包：条目数 ${entries.length} 超过上限 ${maxFiles + 1}（文件 + manifest）`
    );
  }
  let total = 0;
  for (const entry of entries) {
    // 本包格式为 zip(STORE)（§3）；非 STORE 条目是 deflate 炸弹的载体，直接拒绝
    if (entry.method !== 0) {
      throw new AttachmentRestoreError(
        `坏包：条目 ${entry.name.slice(0, 80)} 非 STORE 存储（本包格式不接受压缩条目）`
      );
    }
    if (entry.name !== MANIFEST_NAME && !isValidPackageKey(entry.name)) {
      throw new AttachmentRestoreError(
        `坏包：条目名不在白名单内（zip-slip 防护）：${entry.name.slice(0, 80)}`
      );
    }
    total += entry.uncompressedSize;
  }
  if (total > maxTotalBytes) {
    throw new AttachmentRestoreError(
      `坏包：解压总量 ${total.toLocaleString()} 字节超过上限 ${maxTotalBytes.toLocaleString()}（zip 炸弹防护）`
    );
  }
  if (bytes.length > 0 && total > bytes.length * MAX_RATIO) {
    throw new AttachmentRestoreError("坏包：解压总量与包体积比例异常（zip 炸弹防护）");
  }
}

// ---- manifest 校验 ----

function validateManifest(value: unknown): AttachmentManifest {
  if (typeof value !== "object" || value === null) {
    throw new AttachmentRestoreError("坏包：manifest.json 不是对象");
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.package_version !== 1) {
    throw new AttachmentRestoreError(
      `坏包：不支持的包格式版本 ${String(manifest.package_version)}`
    );
  }
  if (!Array.isArray(manifest.files) || !Array.isArray(manifest.url_map)) {
    throw new AttachmentRestoreError("坏包：manifest 缺 files/url_map");
  }
  const fileKeys = new Set<string>();
  for (const file of manifest.files as AttachmentManifestFile[]) {
    if (
      typeof file !== "object" ||
      file === null ||
      typeof file.key !== "string" ||
      (file.bucket !== "images" && file.bucket !== "attachments" && file.bucket !== "import-files") ||
      typeof file.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(file.sha256) ||
      typeof file.size_bytes !== "number" ||
      typeof file.mime_type !== "string"
    ) {
      throw new AttachmentRestoreError("坏包：manifest.files 条目字段缺失或非法");
    }
    if (!isValidPackageKey(file.key)) {
      throw new AttachmentRestoreError(`坏包：manifest.files.key 非法：${file.key.slice(0, 80)}`);
    }
    if (fileKeys.has(file.key)) {
      throw new AttachmentRestoreError(`坏包：manifest.files 重复条目：${file.key}`);
    }
    fileKeys.add(file.key);
  }
  for (const mapping of manifest.url_map as Array<{ old_url?: unknown; file_key?: unknown }>) {
    if (
      typeof mapping !== "object" ||
      mapping === null ||
      typeof mapping.old_url !== "string" ||
      typeof mapping.file_key !== "string" ||
      !fileKeys.has(mapping.file_key)
    ) {
      throw new AttachmentRestoreError("坏包：manifest.url_map 引用了未申报的 file_key");
    }
  }
  return manifest as unknown as AttachmentManifest;
}

/** sha256 先行校验（全部通过才进入上传阶段——§5-1 任何校验失败零上传） */
async function verifyFileBytes(
  file: AttachmentManifestFile,
  bytes: Uint8Array
): Promise<void> {
  const digest = await sha256Hex(bytes);
  if (digest !== file.sha256) {
    throw new AttachmentRestoreError(`坏包：${file.key} sha256 与 manifest 不符`);
  }
  if (bytes.length !== file.size_bytes) {
    throw new AttachmentRestoreError(`坏包：${file.key} 字节数与 manifest 不符`);
  }
}

const extensionOf = (path: string): string => {
  const raw = path.split(".").pop() ?? "";
  return /^[a-z0-9]{1,8}$/i.test(raw) ? raw.toLowerCase() : "bin";
};

/**
 * 安全解包 + Storage 重放（§5-1/§5-2）。全部结构校验与逐文件 sha256 复核通过后
 * 才开始上传；上传失败或包内缺文件记入 missing[] 不阻断。
 */
export async function restoreAttachmentPackage(
  zipBytes: Uint8Array,
  options: PackageRestoreOptions
): Promise<AttachmentRestoreMapping> {
  const maxTotalBytes = options.maxTotalBytes ?? PACKAGE_MAX_TOTAL_BYTES;
  const maxFiles = options.maxFiles ?? PACKAGE_MAX_FILES;
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const publicUrl =
    options.publicUrl ??
    ((bucket: PackageBucket, path: string) => {
      const url = options.supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
      if (!url) throw new AttachmentRestoreError(`生成公开 URL 失败：${bucket}/${path}`);
      return url;
    });
  const uploadObject =
    options.uploadObject ??
    (async (bucket: PackageBucket, path: string, bytes: Uint8Array, mimeType: string) => {
      const { error } = await options.supabase.storage
        .from(bucket)
        .upload(path, bytes, { contentType: mimeType, upsert: false });
      if (error) throw new AttachmentRestoreError(`上传 ${bucket}/${path} 失败：${error.message}`);
    });

  // 1) 结构预检（未解压）：数量/总量/STORE/白名单
  preflightZipStructure(zipBytes, maxTotalBytes, maxFiles);

  // 2) 解包（护栏已保证内存有界）
  const entries = unzipSync(zipBytes);

  // 3) manifest 校验（§3 唯一事实源；JSON 解析失败/缺字段 → 整包拒绝）
  if (!entries[MANIFEST_NAME]) {
    throw new AttachmentRestoreError("坏包：manifest.json 缺失");
  }
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(new TextDecoder().decode(entries[MANIFEST_NAME]));
  } catch {
    throw new AttachmentRestoreError("坏包：manifest.json 不是合法 JSON");
  }
  const manifest = validateManifest(manifestValue);
  if (manifest.files.length > maxFiles) {
    throw new AttachmentRestoreError(`坏包：manifest.files 数量超过上限 ${maxFiles}`);
  }
  const declaredBytes = manifest.files.reduce((sum, file) => sum + file.size_bytes, 0);
  if (declaredBytes > maxTotalBytes) {
    throw new AttachmentRestoreError(
      `坏包：manifest 申报总量超过上限 ${maxTotalBytes.toLocaleString()}`
    );
  }

  // 4) zip 条目 ↔ manifest.files 交叉核对：未申报条目拒绝；已申报缺失 → missing
  const knownKeys = new Set(manifest.files.map((file) => file.key));
  for (const name of Object.keys(entries)) {
    if (name !== MANIFEST_NAME && !knownKeys.has(name)) {
      throw new AttachmentRestoreError(`坏包：存在 manifest 未申报的条目：${name.slice(0, 80)}`);
    }
  }
  const oldUrlsByKey = new Map<string, string[]>();
  for (const mapping of manifest.url_map) {
    const list = oldUrlsByKey.get(mapping.file_key) ?? [];
    list.push(mapping.old_url);
    oldUrlsByKey.set(mapping.file_key, list);
  }

  // 5) sha/字节先行校验（全部文件，任何不符整包拒绝、零上传）
  const verified = new Map<string, Uint8Array>();
  for (const file of manifest.files) {
    const bytes = entries[file.key];
    if (!bytes) continue; // 包内缺文件 → missing（不阻断），上传阶段登记
    await verifyFileBytes(file, bytes);
    verified.set(file.key, bytes);
  }

  // 6) Storage 重放：新路径 {userId}/{uuid}.{ext}；失败 → missing 不阻断
  const mapping: AttachmentRestoreMapping = {
    manifest,
    urlMap: [],
    pathMap: new Map(),
    missing: [],
    migrated: { files: 0, bytes: 0 },
  };
  for (const file of manifest.files) {
    const bytes = verified.get(file.key);
    const oldUrls = oldUrlsByKey.get(file.key) ?? [];
    if (!bytes) {
      mapping.missing.push({ file_key: file.key, old_urls: oldUrls, reason: "包内缺文件" });
      continue;
    }
    const newPath = `${options.userId}/${uuid()}.${extensionOf(file.path)}`;
    try {
      await uploadObject(file.bucket, newPath, bytes, file.mime_type);
    } catch (error) {
      mapping.missing.push({
        file_key: file.key,
        old_urls: oldUrls,
        reason: `上传失败：${error instanceof Error ? error.message.slice(0, 200) : String(error)}`,
      });
      continue;
    }
    const newUrl = publicUrl(file.bucket, newPath);
    mapping.pathMap.set(`${file.bucket}/${file.path}`, {
      bucket: file.bucket,
      path: newPath,
      newUrl,
    });
    for (const oldUrl of oldUrls) {
      mapping.urlMap.push({ old_url: oldUrl, new_url: newUrl });
    }
    mapping.migrated.files += 1;
    mapping.migrated.bytes += bytes.length;
  }
  return mapping;
}

// ---- 备份数据重映射（prepareRestorePayload 消费） ----

const ATTACHMENT_URL_RE =
  /https?:\/\/[^/\s"'<>\\]+\/storage\/v1\/object\/public\/(images|attachments)\/([A-Za-z0-9/._-]+)/g;

function remapAttachmentString(value: string, mapping: AttachmentRestoreMapping): string {
  return value.replace(ATTACHMENT_URL_RE, (match, bucket: string, path: string) => {
    if (path.split("/").some((segment) => segment === "." || segment === "..")) return match;
    const hit = mapping.pathMap.get(`${bucket}/${path}`);
    return hit ? hit.newUrl : match;
  });
}

function remapAttachmentValue(value: unknown, mapping: AttachmentRestoreMapping): unknown {
  if (typeof value === "string") return remapAttachmentString(value, mapping);
  if (Array.isArray(value)) return value.map((entry) => remapAttachmentValue(entry, mapping));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        remapAttachmentValue(entry, mapping),
      ])
    );
  }
  return value;
}

/**
 * B07-3：附件重映射应用到恢复载荷（§5-3，rewriteInternalLinks 的同级重写层）。
 * - 内容字段（与导出扫描同一白名单）里的 A 类 URL → 新账号公开 URL；
 *   missing 的 URL 原样保留（成为与 B/D 同类的失效引用，UI 失效装饰如实呈现）。
 * - task_attachments 行的 Storage 坐标 → 新路径（文件已重放，坐标必须跟着走）。
 */
export function remapAttachmentReferences(
  data: Record<string, unknown>,
  mapping: AttachmentRestoreMapping
): void {
  const contentFields = [
    ["notes", "content"],
    ["notes", "cover_url"],
    ["note_versions", "content"],
    ["note_suggestions", "original_block"],
    ["note_suggestions", "proposed_block"],
    ["reading_items", "content"],
    ["reading_items", "cover_image"],
    ["synced_blocks", "content"],
    ["canvas_documents", "content"],
    ["tasks", "description"],
  ] as const;
  for (const [table, field] of contentFields) {
    const rows = data[table] as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(rows)) continue;
    for (let index = 0; index < rows.length; index++) {
      const value = rows[index][field];
      if (value == null) continue;
      rows[index] = { ...rows[index], [field]: remapAttachmentValue(value, mapping) };
    }
  }
  const attachments = data.task_attachments as
    | Array<{ bucket?: unknown; path?: unknown }>
    | undefined;
  if (Array.isArray(attachments)) {
    for (let index = 0; index < attachments.length; index++) {
      const row = attachments[index];
      if (row.bucket !== "images" && row.bucket !== "attachments") continue;
      if (typeof row.path !== "string" || !row.path) continue;
      const hit = mapping.pathMap.get(`${row.bucket}/${row.path}`);
      if (hit) attachments[index] = { ...row, path: hit.path };
    }
  }
  // 091（v7）：导入原件与嵌入图是私有桶坐标（行字段，不是内容 URL）——
  // 文件已重放到新账号目录，行内坐标必须跟着走；missing 的保留旧路径
  // （下载报 404，与「缺失资产明确报告」一致）
  const importFiles = data.import_files as
    | Array<{ storage_path?: unknown; asset_paths?: unknown }>
    | undefined;
  if (Array.isArray(importFiles)) {
    const remapPath = (path: string): string => {
      const hit = mapping.pathMap.get(`import-files/${path}`);
      return hit ? hit.path : path;
    };
    for (let index = 0; index < importFiles.length; index++) {
      const row = importFiles[index];
      const next: Record<string, unknown> = { ...row };
      if (typeof row.storage_path === "string" && row.storage_path) {
        next.storage_path = remapPath(row.storage_path);
      }
      if (Array.isArray(row.asset_paths)) {
        next.asset_paths = row.asset_paths.map((p) =>
          typeof p === "string" ? remapPath(p) : p
        );
      }
      importFiles[index] = next;
    }
  }
}

// ---- 线上传输格式（浏览器重放 → /api/backup/restore 服务端重写载荷） ----

export interface AttachmentMappingWire {
  migrated: { files: number; bytes: number };
  missing: AttachmentRestoreMapping["missing"];
  urlMap: AttachmentRestoreMapping["urlMap"];
  pathMap: Array<{
    bucket: PackageBucket;
    old_path: string;
    path: string;
    new_url: string;
  }>;
  externalUrlCount: number;
  inlineBase64Count: number;
}

export function serializeAttachmentMapping(
  mapping: AttachmentRestoreMapping
): AttachmentMappingWire {
  return {
    migrated: mapping.migrated,
    missing: mapping.missing,
    urlMap: mapping.urlMap,
    pathMap: [...mapping.pathMap.entries()].map(([key, hit]) => ({
      bucket: hit.bucket,
      old_path: key.slice(key.indexOf("/") + 1),
      path: hit.path,
      new_url: hit.newUrl,
    })),
    externalUrlCount: mapping.manifest.external_urls.length,
    inlineBase64Count: mapping.manifest.inline_base64_count,
  };
}

/** 服务端 fail-closed 校验（映射只影响用户自己载荷的字符串重写，但仍验形状与规模） */
export function isAttachmentMappingWire(value: unknown): value is AttachmentMappingWire {
  if (typeof value !== "object" || value === null) return false;
  const wire = value as AttachmentMappingWire;
  if (
    typeof wire.migrated !== "object" ||
    wire.migrated === null ||
    typeof wire.migrated.files !== "number" ||
    typeof wire.migrated.bytes !== "number" ||
    !Array.isArray(wire.missing) ||
    !Array.isArray(wire.urlMap) ||
    !Array.isArray(wire.pathMap) ||
    typeof wire.externalUrlCount !== "number" ||
    typeof wire.inlineBase64Count !== "number"
  ) {
    return false;
  }
  if (wire.pathMap.length > PACKAGE_MAX_FILES || wire.urlMap.length > PACKAGE_MAX_FILES * 2) {
    return false;
  }
  for (const entry of wire.pathMap) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      (entry.bucket !== "images" && entry.bucket !== "attachments" && entry.bucket !== "import-files") ||
      typeof entry.old_path !== "string" ||
      !entry.old_path ||
      typeof entry.path !== "string" ||
      entry.path.length === 0 ||
      entry.path.length > 512 ||
      typeof entry.new_url !== "string" ||
      !entry.new_url.startsWith("http")
    ) {
      return false;
    }
    if (!isValidPackageKey(`files/${entry.bucket}/${entry.old_path}`)) return false;
  }
  for (const entry of wire.urlMap) {
    if (typeof entry !== "object" || entry === null || typeof entry.old_url !== "string" || typeof entry.new_url !== "string") {
      return false;
    }
  }
  for (const entry of wire.missing) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.file_key !== "string" ||
      !Array.isArray(entry.old_urls) ||
      !entry.old_urls.every((url) => typeof url === "string") ||
      typeof entry.reason !== "string"
    ) {
      return false;
    }
  }
  return true;
}

export function attachmentMappingFromWire(
  wire: AttachmentMappingWire
): AttachmentRestoreMapping {
  return {
    manifest: {
      package_version: ATTACHMENT_PACKAGE_VERSION,
      created_at: "",
      backup_version: 5,
      files: [],
      url_map: wire.urlMap.map((entry) => ({
        old_url: entry.old_url,
        file_key: "",
      })),
      external_urls: new Array(wire.externalUrlCount).fill(""),
      external_urls_truncated: false,
      inline_base64_count: wire.inlineBase64Count,
      total_bytes: wire.migrated.bytes,
    },
    urlMap: wire.urlMap,
    pathMap: new Map(
      wire.pathMap.map((entry) => [
        `${entry.bucket}/${entry.old_path}`,
        { bucket: entry.bucket, path: entry.path, newUrl: entry.new_url },
      ])
    ),
    missing: wire.missing,
    migrated: wire.migrated,
  };
}
