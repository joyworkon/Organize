/**
 * B07-2 附件可携带备份——导出侧核心库（设计 docs/attachment-portable-backup-design.md §3/§4）。
 *
 * 与 v5 备份 JSON 的关系：文件包是伴生容器（zip STORE），不改备份 schema。
 * 四类资源形态（§1.2）：A=本应用 Storage 附件（打包，恢复期重映射）/ B=远程图片、
 * D=失效外链（external_urls 如实声明，不打包）/ C=正文 base64（自包含，只计数）。
 *
 * 依赖注入点（单测不需真实 Storage/磁盘）：
 *   - downloadObject：默认走 supabase-js storage .download（用户会话，RLS 权限即够，
 *     设计 §6 不提升权限）；单对象整块载入内存 ≤ bucket 上限（5/50MB）。
 *   - writeChunk：zip 输出 sink——脚本传磁盘流，测试缓冲在内存。
 *
 * manifest.json 是包内**最后一个** entry：files 清单（sha256/字节数）下载完成才可知，
 * zip 各 entry 相互独立、读者不依赖顺序。
 *
 * B07-3 将实现恢复侧（安全解包/Storage 重放/URL 重映射）；本文件只导出。
 */
import { Zip, ZipPassThrough } from "fflate";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BACKUP_VERSION, type BackupData } from "./schema";

export const ATTACHMENT_PACKAGE_VERSION = 1;
/** §7-c 默认护栏：包总字节 / 文件数（可经 options 覆盖，PR review 可调） */
export const PACKAGE_MAX_TOTAL_BYTES = 500 * 1024 * 1024;
export const PACKAGE_MAX_FILES = 5_000;
/** external_urls 清单上限（防极端内容撑爆 manifest；截断时布尔位如实声明） */
export const PACKAGE_MAX_EXTERNAL_URLS = 5_000;

/** 与恢复侧（B07-3 §5-1）共用的 zip entry 白名单合同 */
export const PACKAGE_KEY_PATTERN = /^files\/(images|attachments)\/[A-Za-z0-9/._-]+$/;

/**
 * 包内 entry key 的完整安全校验（B07-3 恢复侧解包用）：
 * 白名单正则之外再拒 `.`/`..` 路径段——正则字符集含点号，`u1/../evil.png`
 * 能通过正则但构成路径逃逸，必须在两侧（导出扫描与恢复解包）都显式拒绝。
 */
export function isValidPackageKey(key: string): boolean {
  if (!PACKAGE_KEY_PATTERN.test(key)) return false;
  const rel = key.replace(/^files\/(images|attachments)\//, "");
  return !rel.split("/").some((segment) => segment === "." || segment === "..");
}

type Bucket = "images" | "attachments";
export type PackageBucket = Bucket;
const BUCKETS: readonly Bucket[] = ["images", "attachments"];

export interface ScannedAttachmentRef {
  bucket: Bucket;
  path: string;
}

export interface ScannedPackage {
  /** bucket+path 去重后的 A 类文件（保持首现顺序） */
  files: ScannedAttachmentRef[];
  /** old_url → file_key（files/{bucket}/{path}）；多条 old_url 可指向同一 file_key */
  urlMap: Array<{ old_url: string; file_key: string }>;
  /** B/D 类外链清单（如实声明「未打包」；去重，超上限截断） */
  externalUrls: string[];
  externalUrlsTruncated: boolean;
  /** C 类 base64 内联出现次数 */
  inlineBase64Count: number;
}

export class AttachmentPackageError extends Error {}
export class AttachmentPackageLimitError extends AttachmentPackageError {}
export class AttachmentPackageCancelledError extends AttachmentPackageError {}

const STORAGE_URL_RE =
  /https?:\/\/[^/\s"'<>\\]+\/storage\/v1\/object\/public\/(images|attachments)\/([A-Za-z0-9/._-]+)/g;
const DATA_URL_RE = /data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,/g;
const HTTP_URL_RE = /https?:\/\/[^\s"'<>\\)]+/g;
const PATH_CHARSET_RE = /^[A-Za-z0-9/._-]+$/;

/** §5-1 路径合同的前置保证：字符白名单 + 拒绝 `.`/`..` 路径段与绝对路径（zip-slip 源头） */
function assertSafeStoragePath(bucket: Bucket, path: string, origin: string): void {
  if (
    !path ||
    !PATH_CHARSET_RE.test(path) ||
    path.startsWith("/") ||
    path.split("/").some((seg) => seg === "." || seg === "..")
  ) {
    throw new AttachmentPackageError(
      `Storage 路径含白名单外字符或路径段，无法安全打包: ${origin} ${bucket}/${path.slice(0, 80)}`
    );
  }
}

/**
 * 扫描备份数据中的资源引用并分类（§4-1/4-2）。
 * 只走内容字段白名单（notes/note_versions/note_suggestions 的正文 JSON、
 * reading_items 正文与封面、synced_blocks、tasks.description 纯文本、
 * task_attachments 元数据行）——reading_items.url 等来源字段不进 external_urls。
 */
export function scanAttachmentReferences(data: BackupData): ScannedPackage {
  const fileByKey = new Map<string, ScannedAttachmentRef>();
  const fileKeyByUrl = new Map<string, string>();
  const urlMap: ScannedPackage["urlMap"] = [];
  const external = new Set<string>();
  let externalUrlsTruncated = false;
  let inlineBase64Count = 0;

  const contentString = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value == null) return "";
    return JSON.stringify(value);
  };

  const classify = (text: string) => {
    // A 类：本应用 Storage 公开 URL（笔记正文 JSON 的 src 属性与 HTML 正文字符串同规处理）
    for (const match of text.matchAll(STORAGE_URL_RE)) {
      const bucket = match[1] as Bucket;
      const path = match[2];
      assertSafeStoragePath(bucket, path, match[0]);
      const key = `files/${bucket}/${path}`;
      if (!fileByKey.has(key)) fileByKey.set(key, { bucket, path });
      const oldUrl = match[0];
      if (!fileKeyByUrl.has(oldUrl)) {
        fileKeyByUrl.set(oldUrl, key);
        urlMap.push({ old_url: oldUrl, file_key: key });
      }
    }
    // C 类：base64 内联只计数
    for (const _ of text.matchAll(DATA_URL_RE)) inlineBase64Count++;
    // B/D 类：其余外链（去重、上限截断）
    if (external.size < PACKAGE_MAX_EXTERNAL_URLS) {
      for (const match of text.matchAll(HTTP_URL_RE)) {
        if (match[0].includes("/storage/v1/object/public/")) continue;
        if (!external.has(match[0])) {
          external.add(match[0]);
          if (external.size >= PACKAGE_MAX_EXTERNAL_URLS) {
            externalUrlsTruncated = true;
            break;
          }
        }
      }
    } else {
      externalUrlsTruncated = true;
    }
  };

  for (const row of data.notes) {
    classify(contentString(row.content));
    classify(String(row.cover_url ?? ""));
  }
  for (const row of data.note_versions) classify(contentString(row.content));
  for (const row of data.note_suggestions) {
    classify(contentString(row.original_block));
    classify(contentString(row.proposed_block));
  }
  for (const row of data.reading_items) {
    classify(String(row.content ?? ""));
    classify(String(row.cover_image ?? ""));
  }
  for (const row of data.synced_blocks) classify(contentString(row.content));
  for (const row of data.tasks) classify(String(row.description ?? ""));
  // task_attachments 元数据行：bucket/path 即 A 类坐标（URL 形态由恢复侧重映射处理）
  for (const row of data.task_attachments) {
    const bucket = row.bucket;
    const path = String(row.path ?? "");
    if (bucket !== "images" && bucket !== "attachments") continue;
    assertSafeStoragePath(bucket, path, `task_attachments:${row.id}`);
    const key = `files/${bucket}/${path}`;
    if (!fileByKey.has(key)) fileByKey.set(key, { bucket, path });
  }

  return {
    files: [...fileByKey.values()],
    urlMap,
    externalUrls: [...external],
    externalUrlsTruncated,
    inlineBase64Count,
  };
}

// ---- 打包 ----

export interface AttachmentManifestFile {
  key: string;
  bucket: Bucket;
  path: string;
  sha256: string;
  size_bytes: number;
  mime_type: string;
}

export interface AttachmentManifest {
  package_version: number;
  created_at: string;
  backup_version: number;
  app_version?: string;
  files: AttachmentManifestFile[];
  url_map: Array<{ old_url: string; file_key: string }>;
  external_urls: string[];
  external_urls_truncated: boolean;
  inline_base64_count: number;
  total_bytes: number;
}

export interface PackageBuildOptions {
  supabase: SupabaseClient;
  signal?: AbortSignal;
  maxTotalBytes?: number;
  maxFiles?: number;
  appVersion?: string;
  now?: () => Date;
  /** 注入下载（单测）；默认 supabase-js storage .download（用户会话） */
  downloadObject?: (
    bucket: Bucket,
    path: string,
    signal: AbortSignal
  ) => Promise<Uint8Array>;
}

export interface PackageBuildResult {
  manifest: AttachmentManifest;
  fileCount: number;
  totalBytes: number;
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
};

/**
 * sha256 hex（同构实现）：库同时跑在浏览器（设置页 UI）与 Node（演练脚本），
 * 用全局 WebCrypto 而非 node:crypto——后者无法进浏览器 bundle。
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

const mimeForPath = (path: string): string => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
};

const defaultDownload = async (
  supabase: SupabaseClient,
  bucket: Bucket,
  path: string,
  signal: AbortSignal
): Promise<Uint8Array> => {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new AttachmentPackageError(`下载 ${bucket}/${path} 失败: ${error.message}`);
  if (signal.aborted) throw new AttachmentPackageCancelledError("已取消");
  return new Uint8Array(await data.arrayBuffer());
};

/**
 * 流式打包（§4-3/4-4）：STORE 模式逐文件边下边写，writeChunk 收 zip 字节流。
 * 文件清单先于 manifest 落包（manifest 最后写）。
 * 任何失败（超限/取消/下载错误/sink 错误）抛错即弃——调用方负责丢弃半成品，
 * 不产出部分包；护栏超限明确报错不静默截断（§4-4）。
 */
export async function buildAttachmentPackage(
  scanned: ScannedPackage,
  writeChunk: (chunk: Uint8Array) => void | Promise<void>,
  options: PackageBuildOptions
): Promise<PackageBuildResult> {
  const maxTotalBytes = options.maxTotalBytes ?? PACKAGE_MAX_TOTAL_BYTES;
  const maxFiles = options.maxFiles ?? PACKAGE_MAX_FILES;
  const signal = options.signal ?? new AbortController().signal;
  const download =
    options.downloadObject ?? ((b, p, s) => defaultDownload(options.supabase, b, p, s));
  const now = options.now ?? (() => new Date());

  if (scanned.files.some((f) => !BUCKETS.includes(f.bucket))) {
    throw new AttachmentPackageError(`未知 bucket：${[...new Set(scanned.files.filter((f) => !BUCKETS.includes(f.bucket)).map((f) => f.bucket))].join(", ")}`);
  }
  if (scanned.files.length > maxFiles) {
    throw new AttachmentPackageLimitError(
      `文件数 ${scanned.files.length} 超过上限 ${maxFiles}，不静默截断；建议清理附件或调高上限`
    );
  }
  if (signal.aborted) throw new AttachmentPackageCancelledError("已取消");

  // fflate Zip 的 data 回调同步推流；磁盘 sink 可能 backpressure，用 promise 链保序，
  // 每个阶段边界 await tail 落实，sink 抛错经 sinkError 在阶段边界浮出
  let tail: Promise<void> = Promise.resolve();
  let sinkError: unknown = null;
  const zip = new Zip((err, chunk) => {
    if (err) {
      sinkError = sinkError ?? err;
      return;
    }
    if (!chunk || chunk.length === 0) return;
    tail = tail.then(() => writeChunk(chunk));
  });

  const manifestFiles: AttachmentManifestFile[] = [];
  let totalBytes = 0;
  let zipClosed = false;

  const drain = async (): Promise<void> => {
    await tail;
    if (sinkError) throw sinkError instanceof Error ? sinkError : new AttachmentPackageError(String(sinkError));
  };

  try {
    for (const ref of scanned.files) {
      if (signal.aborted) throw new AttachmentPackageCancelledError("已取消");
      const bytes = await download(ref.bucket, ref.path, signal);
      if (signal.aborted) throw new AttachmentPackageCancelledError("已取消");
      if (manifestFiles.length + 1 > maxFiles) {
        throw new AttachmentPackageLimitError(
          `文件数超过上限 ${maxFiles}（扫描清单 ${scanned.files.length} 个）`
        );
      }
      if (totalBytes + bytes.length > maxTotalBytes) {
        throw new AttachmentPackageLimitError(
          `包总大小将达 ${(totalBytes + bytes.length).toLocaleString()} 字节，超过上限 ${maxTotalBytes.toLocaleString()}（已完成 ${manifestFiles.length} 个文件）；建议清理大附件或调高上限`
        );
      }
      const key = `files/${ref.bucket}/${ref.path}`;
      const sha256 = await sha256Hex(bytes);
      const entry = new ZipPassThrough(key);
      zip.add(entry);
      // 单对象 ≤ bucket 上限（5/50MB），整块推送；entry 以空块+final 收尾
      entry.push(bytes);
      entry.push(new Uint8Array(0), true);
      await drain();
      manifestFiles.push({
        key,
        bucket: ref.bucket,
        path: ref.path,
        sha256,
        size_bytes: bytes.length,
        mime_type: mimeForPath(ref.path),
      });
      totalBytes += bytes.length;
    }

    // manifest 最后落包（§3 唯一事实源；不入自身校验链）
    const manifest: AttachmentManifest = {
      package_version: ATTACHMENT_PACKAGE_VERSION,
      created_at: now().toISOString(),
      backup_version: BACKUP_VERSION,
      ...(options.appVersion ? { app_version: options.appVersion } : {}),
      files: manifestFiles,
      url_map: scanned.urlMap,
      external_urls: scanned.externalUrls,
      external_urls_truncated: scanned.externalUrlsTruncated,
      inline_base64_count: scanned.inlineBase64Count,
      total_bytes: totalBytes,
    };
    const manifestEntry = new ZipPassThrough("manifest.json");
    zip.add(manifestEntry);
    manifestEntry.push(new TextEncoder().encode(JSON.stringify(manifest, null, 2)));
    manifestEntry.push(new Uint8Array(0), true);
    zipClosed = true;
    zip.end();
    await drain();

    return { manifest, fileCount: manifestFiles.length, totalBytes };
  } catch (error) {
    if (!zipClosed) {
      // 终止 zip 内部状态，防止悬挂（sink 链已不保证完整）
      try {
        zip.end();
      } catch {
        // 丢弃
      }
    }
    throw error;
  }
}
