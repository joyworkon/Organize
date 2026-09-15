// B07-4 附件可携带备份——空账号端到端演练（真实后端）
//
// 用法（前置：本地 Supabase 运行中）：
//   cd apps/web && npx tsx scripts/attachment-restore-drill.mts
// 或显式注入（CI/显式环境）：
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   npx tsx scripts/attachment-restore-drill.mts
//
// 流程（设计 §5 全链路，含 restore RPC 落库）：
//   1. admin 建本轮专用 A/B 账号（随机后缀，免清理）
//   2. service_role 给 A 播种：images 图片 + attachments 附件（A 会话/服务端上传）、
//      引用它们的笔记与版本行、任务附件行、base64 自包含内容、外链内容
//   3. A 会话走生产导出链（fetchBackupData → 剪枝 → createBackupV2 → scan →
//      buildAttachmentPackage 真实 Storage 下载）
//   4. B 空账号：restoreAttachmentPackage（默认 uploadObject/getPublicUrl 真实重放）
//      → prepareRestorePayload（附件重映射）→ restore_backup_v2_full RPC 落库
//   5. 离线可读检查：读回 B 的全部载荷行，内容里每个 A 类 URL 都能从 B 的
//      Storage 下载到字节一致的副本（missing 为空 ⇒ A 类全部可读）
//   6. 逐项比对：task_attachments 坐标、内容 URL、base64/外链计数、
//      非空账号负例（A 再恢复 → not_empty）
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  fetchBackupData,
  pruneExportData,
} from "../lib/backup/export-data";
import {
  buildAttachmentPackage,
  scanAttachmentReferences,
} from "../lib/backup/attachment-package";
import { restoreAttachmentPackage } from "../lib/backup/attachment-restore";
import { createBackupV2 } from "../lib/backup/schema";
import { prepareRestorePayload } from "../lib/backup/restore";

const RUN = Date.now().toString(36);
const PASSWORD = `b074-drill-${RUN}-password`;
const EMAIL_A = `attach-drill-a-${RUN}@test.local`;
const EMAIL_B = `attach-drill-b-${RUN}@test.local`;

const status = JSON.parse(execSync("supabase status -o json", { encoding: "utf8" }));
const URL = process.env.SUPABASE_URL ?? status.API_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? status.ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? status.SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
const serviceDb = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${SERVICE_KEY}` } },
});

let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`PASS: ${label}`);
  else {
    failed++;
    console.error(`FAIL: ${label}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
  }
}

async function ensureUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  const { data: signIn, error: signInError } = await admin.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw new Error(`signIn ${email}: ${signInError.message}`);
  const client = createClient(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${signIn!.session!.access_token}` } },
  });
  return { id: created.user!.id, client };
}

// ---- 1. 账号 ----
const A = await ensureUser(EMAIL_A);
const B = await ensureUser(EMAIL_B);

// ---- 2. 播种 A（Storage 对象走真实上传：图片走 A 会话、附件走服务端） ----
const PNG = new TextEncoder().encode(`PNGDATA-b074-${RUN}-roundtrip`);
const PDF = new TextEncoder().encode(`%PDF-1.4 b074 drill attachment ${RUN}`);
const upImage = await A.client.storage.from("images").upload(`${A.id}/note.png`, PNG, { contentType: "image/png" });
if (upImage.error) throw new Error(`upload image: ${upImage.error.message}`);
const upFile = await serviceDb.storage.from("attachments").upload(`${A.id}/task.pdf`, PDF, { contentType: "application/pdf" });
if (upFile.error) throw new Error(`upload attachment: ${upFile.error.message}`);

const publicUrl = (bucket: string, path: string) =>
  `${URL}/storage/v1/object/public/${bucket}/${path}`;
const imageOldUrl = publicUrl("images", `${A.id}/note.png`);
const fileOldUrl = publicUrl("attachments", `${A.id}/task.pdf`);

const { error: noteErr } = await serviceDb.from("notes").insert({
  user_id: A.id,
  title: "B07-4 演练笔记",
  content: {
    type: "doc",
    content: [
      { type: "resizableImage", attrs: { src: imageOldUrl } },
      { type: "paragraph", content: [{ type: "text", text: `外链 https://cdn.other.com/pic.jpg 不打包；base64 data:image/png;base64,iVBORw0KGgo= 自包含` }] },
    ],
  },
});
if (noteErr) throw new Error(`insert note: ${noteErr.message}`);
const noteId = (await serviceDb.from("notes").select("id").eq("user_id", A.id).single()).data!.id as string;
await serviceDb.from("note_versions").insert({
  note_id: noteId, title: "历史版本", content: { type: "doc", content: [{ type: "resizableImage", attrs: { src: imageOldUrl } }] },
});
const { data: taskRow, error: taskErr } = await serviceDb
  .from("tasks")
  .insert({ user_id: A.id, title: "B07-4 演练任务", status: "todo" })
  .select("id")
  .single();
if (taskErr) throw new Error(`insert task: ${taskErr.message}`);
await serviceDb.from("task_attachments").insert({
  user_id: A.id, task_id: taskRow!.id, name: "task.pdf",
  bucket: "attachments", path: `${A.id}/task.pdf`, mime_type: "application/pdf", size_bytes: PDF.length,
});

// ---- 3. A 导出（生产链） ----
const dataA = pruneExportData(await fetchBackupData(A.client, A.id));
const backup = createBackupV2(dataA);
const scanned = scanAttachmentReferences(dataA);
check("扫描：A 类 2 个文件 / url_map 1 条（附件坐标走元数据行）/ base64 1 处",
  scanned.files.length === 2 && scanned.urlMap.length === 1 && scanned.inlineBase64Count === 1,
  { files: scanned.files.length, urlMap: scanned.urlMap.length, base64: scanned.inlineBase64Count });

const chunks: Uint8Array[] = [];
const built = await buildAttachmentPackage(scanned, (chunk) => { chunks.push(chunk); }, {
  supabase: A.client,
  appVersion: "b074-drill",
});
const zipLen = chunks.reduce((n, c) => n + c.length, 0);
const zipBytes = new Uint8Array(zipLen);
let offset = 0;
for (const chunk of chunks) { zipBytes.set(chunk, offset); offset += chunk.length; }
console.log(`导出：${built.fileCount} 附件 / zip ${zipLen} 字节 / manifest ${built.manifest.files.length} 条`);

// ---- 4. B 恢复（重放 + 重映射 + RPC 落库） ----
const mapping = await restoreAttachmentPackage(zipBytes, { supabase: B.client, userId: B.id });
check("重放：2 个迁移、0 缺失", mapping.migrated.files === 2 && mapping.missing.length === 0, mapping.missing);
const payload = prepareRestorePayload(backup, undefined, { attachments: mapping });
const { data: rpcResult, error: rpcError } = await B.client.rpc("restore_backup_v2_full", { p_payload: payload });
if (rpcError) throw new Error(`restore RPC: ${rpcError.message}`);
const resultStatus = (rpcResult as { status?: string } | null)?.status;
check("restore RPC 成功（非 not_empty）", resultStatus !== "not_empty", rpcResult);

// 非空账号负例：对 A（已有数据）恢复 → not_empty
const { data: notEmpty } = await A.client.rpc("restore_backup_v2_full", { p_payload: payload });
check("非空账号恢复 → not_empty", (notEmpty as { status?: string } | null)?.status === "not_empty", notEmpty);

// ---- 5. 读回 B 并逐项比对 + 离线可读 ----
const { data: bNotes } = await B.client.from("notes").select("title, content");
const { data: bVersions } = await B.client.from("note_versions").select("title, content");
const { data: bAttachments } = await B.client.from("task_attachments").select("bucket, path, name, size_bytes");

const allContent = JSON.stringify({ notes: bNotes ?? [], versions: bVersions ?? [] });
check("内容不再含旧账号 URL 前缀", !allContent.includes(`object/public/images/${A.id}/`) && !allContent.includes(`object/public/attachments/${A.id}/`));
check("内容引用 B 的新公开 URL", (allContent.match(/storage\/v1\/object\/public\//g) ?? []).length >= 2 && allContent.includes(B.id));

// 逐个 A 类 URL：从 B 的 Storage 下载字节比对（离线可读 ⇒ missing 为空时 A 类全可读）
const contentUrls = [...new Set(
  (allContent.match(/https?:\/\/[^/\s"'<>\\]+\/storage\/v1\/object\/public\/(images|attachments)\/([A-Za-z0-9/._-]+)/g) ?? [])
)];
check("B 载荷中的 A 类内容 URL 共 1 个（附件坐标走 task_attachments 行）", contentUrls.length === 1, contentUrls);
for (const url of contentUrls) {
  const response = await fetch(url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const source = url.endsWith(".png") ? PNG : PDF;
  const digest = createHash("sha256").update(bytes).digest("hex");
  const sourceDigest = createHash("sha256").update(source).digest("hex");
  check(`离线可读：${url.slice(-24)} 字节一致`, response.ok && digest === sourceDigest, { status: response.status });
}

check("task_attachments 坐标已改写为 B 路径", (bAttachments ?? []).length === 1 && String((bAttachments ?? [])[0]?.path ?? "").startsWith(`${B.id}/`), bAttachments);
check("task_attachments 字节长度保留", (bAttachments ?? [])[0]?.size_bytes === PDF.length);
const bAttachPath = String((bAttachments ?? [])[0]?.path ?? "");
const bAttachObject = await serviceDb.storage.from("attachments").download(bAttachPath);
check("任务附件对象在 B 存储可下载且字节一致",
  !bAttachObject.error && new Uint8Array(await (bAttachObject.data as Blob).arrayBuffer()).every((v, i) => v === PDF[i]));

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
