// B01 备份 v5 完整恢复演练（真实后端）
//
// 用法（前置：本地 Supabase 运行中）：
//   cd apps/web && npx tsx scripts/backup-restore-drill.ts
// 或 CI/显式注入：
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   npx tsx scripts/backup-restore-drill.ts
//
// 流程：
//   1. admin API 建本轮专用 A/B 账号（每轮随机后缀，幂等免清理）
//   2. service_role 给 A 播种全量数据（29 表覆盖 + 回收站行 + 回收站子行 +
//      指向回收站的内链 + 软删速记/列表 + list_id 归属）
//   3. 以 A 的会话走生产导出代码（fetchBackupData + createBackupV2，RLS 真实可见性）
//   4. 以 B 的会话走生产恢复代码（inspect → prepareRestorePayload → restore RPC）
//   5. 读回 B 的全部数据，逐表逐行与恢复载荷比对（ID 映射/关系/软删除语义/内容重写）
//   6. 负例：非空账号恢复拒绝、损坏 JSON、超限文件
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import {
  BACKUP_MAX_BYTES,
  BACKUP_TABLES,
  createBackupV2,
  inspectBackupV2,
} from "../lib/backup/schema";
import { fetchBackupData, pruneExportData } from "../lib/backup/export-data";
import { prepareRestorePayload, ID_TABLES } from "../lib/backup/restore";

const RUN = Date.now().toString(36);
const PASSWORD = `b01-drill-${RUN}-password`;
const EMAIL_A = `backup-drill-a-${RUN}@test.local`;
const EMAIL_B = `backup-drill-b-${RUN}@test.local`;

const status = JSON.parse(execSync("supabase status -o json", { encoding: "utf8" }));
const URL = process.env.SUPABASE_URL ?? status.API_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? status.ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? status.SERVICE_ROLE_KEY;

// admin 仅用于 auth.admin / signInWithPassword；PostgREST 播种一律走 serviceDb——
// signInWithPassword 会改写调用它的客户端的会话（后续请求带上该用户 token），
// 复用同一客户端播种会以「最后登录用户」的身份撞 RLS。
const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
const serviceDb = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${SERVICE_KEY}` } },
});
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

let failed = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.error(`FAIL: ${label}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
  }
}

// ---- 稳定 JSON（键序无关）比较 ----
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, stable(v)])
    );
  }
  return value;
}
const j = (value: unknown) => JSON.stringify(stable(value));

const TS_FIELDS = new Set([
  "created_at", "updated_at", "started_reading_at", "completed_reading_at",
  "due_date", "completed_at", "notified_at", "resolved_at", "deleted_at",
]);
// updated_at 在恢复插入时被触发器覆盖为恢复时刻（新鲜度元数据不回溯，
// 067 blob 新鲜度规则依赖 notes.updated_at）——不参与逐行比对
const SKIP_FIELDS = new Set(["updated_at"]);

/** 恢复载荷行 vs DB 实际行：时间戳按时刻比较，其余按稳定 JSON 比较 */
function rowMatches(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (SKIP_FIELDS.has(key)) continue;
    if (TS_FIELDS.has(key)) {
      if (value == null) {
        if (actual[key] != null) return false;
      } else if (Date.parse(String(value)) !== Date.parse(String(actual[key]))) {
        return false;
      }
    } else if (j(value) !== j(actual[key])) {
      return false;
    }
  }
  return true;
}

async function ensureUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
  const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list.data?.users?.find((u) => u.email === email);
  let id: string;
  if (existing) {
    id = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser ${email}: ${error.message}`);
    id = data.user.id;
  }
  const { data: signIn, error: signInError } = await admin.auth.signInWithPassword({ email, password: PASSWORD });
  void signIn;
  if (signInError) throw new Error(`signIn ${email}: ${signInError.message}`);
  const client = createClient(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${signIn.session!.access_token}` } },
  });
  return { id, client };
}

// ============ 1. 账号 ============
const A = await ensureUser(EMAIL_A);
const B = await ensureUser(EMAIL_B);
console.log(`drill run ${RUN}: A=${A.id} B=${B.id}`);

// ============ 2. 播种（service_role，全部新 UUID，幂等免清理） ============
const ids = {
  R1: uuid(), R2: uuid(), R3: uuid(), R4: uuid(), // R4 回收站
  N1: uuid(), N2: uuid(), N3: uuid(), N4: uuid(), // N4 回收站
  G1: uuid(), G2: uuid(), G3: uuid(),
  T1: uuid(), T2: uuid(), T3: uuid(), T5: uuid(), T6: uuid(), // T6 回收站
  L1: uuid(), L2: uuid(), // L2 回收站
  E1: uuid(),
  H1: uuid(), H2: uuid(), // H2 挂回收站文章（RLS 应隐藏）
  F1: uuid(), F2: uuid(), F3: uuid(),
  V1: uuid(), V2: uuid(), V3: uuid(), // V3 挂回收站笔记（孤儿探针）
  TH1: uuid(), C1: uuid(), C2: uuid(), C3: uuid(),
  S1: uuid(),
  D1: uuid(), DR1: uuid(),
  M1: uuid(), AT1: uuid(), AC1: uuid(),
  TP1: uuid(), CD1: uuid(),
  MM1: uuid(), MM2: uuid(), // MM2 回收站速记（导出应带 flag 保留）
  MN1: uuid(), MN2: uuid(),
  TR1: uuid(), TR2: uuid(), TR3: uuid(), // TR2/TR3 指向回收站行（孤儿探针）
  CL1: uuid(), CL2: uuid(), CL3: uuid(), // CL3 挂回收站任务 T6
  DEP1: uuid(), DEP2: uuid(), // DEP2 挂回收站任务 T6
};
const ts = now();
const past = new Date(Date.now() - 86_400_000).toISOString();

const N1_CONTENT = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "复杂正文标题" }] },
    { type: "callout", attrs: { emoji: "💡" }, content: [{ type: "text", text: "标注块" }] },
    { type: "paragraph", content: [{ type: "text", text: "外链 ", marks: [] }, { type: "text", text: "阅读链接", marks: [{ type: "link", attrs: { href: `/library/${ids.R1}#blk-x` } }] }] },
    { type: "paragraph", content: [{ type: "text", text: "笔记链接", marks: [{ type: "link", attrs: { href: `/notes/${ids.N2}` } }] }] },
    // 指向回收站笔记的悬空内链：导出必须成功、恢复后保持悬空（产品以「链接失效」装饰呈现）
    { type: "paragraph", content: [{ type: "text", text: "悬空链接", marks: [{ type: "link", attrs: { href: `/notes/${ids.N4}` } }] }] },
    { type: "taskItem", attrs: { taskId: ids.T1 }, content: [{ type: "text", text: "绑定任务一" }] },
    { type: "taskItem", attrs: { taskId: null }, content: [{ type: "text", text: "未绑定清单项" }] },
    { type: "syncedBlock", attrs: { syncedId: ids.S1 } },
    { type: "databaseBlock", attrs: { databaseId: ids.D1 } },
    { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const x = 1;" }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "text", text: "列表项" }] }] },
  ],
};
const N2_CONTENT = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "父笔记正文" }] }] };
const N4_CONTENT = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "回收站笔记正文" }] }] };

type Seed = { table: string; row: Record<string, unknown> };
const seed: Seed[] = [
  // 阅读库：三态 + 全宽 + 回收站 R4
  { table: "reading_items", row: { id: ids.R1, user_id: A.id, url: "https://example.com/a1", title: "未读文章", content: "<p>正文一</p>", excerpt: "摘要一", cover_image: null, reading_status: "unread", reading_progress: 0, is_pinned: false, full_width: false, started_reading_at: null, completed_reading_at: null, created_at: past, updated_at: ts } },
  { table: "reading_items", row: { id: ids.R2, user_id: A.id, url: "https://example.com/a2", title: "在读文章", content: "<p>正文二</p>", excerpt: null, cover_image: "https://example.com/cover.jpg", reading_status: "reading", reading_progress: 0.5, is_pinned: true, full_width: true, started_reading_at: past, completed_reading_at: null, created_at: past, updated_at: ts } },
  { table: "reading_items", row: { id: ids.R3, user_id: A.id, url: "https://example.com/a3", title: "已读文章", content: "<p>正文三</p>", excerpt: null, cover_image: null, reading_status: "read", reading_progress: 1, is_pinned: false, full_width: false, started_reading_at: past, completed_reading_at: ts, created_at: past, updated_at: ts } },
  { table: "reading_items", row: { id: ids.R4, user_id: A.id, url: "https://example.com/trash", title: "回收站文章", content: "<p>回收站正文</p>", excerpt: null, cover_image: null, reading_status: "unread", reading_progress: 0, is_pinned: false, full_width: false, started_reading_at: null, completed_reading_at: null, created_at: past, updated_at: ts, deleted_at: ts } },
  // 笔记：复杂正文 N1 / 页面设置 N2 / 层级 N3 / 回收站 N4
  { table: "notes", row: { id: ids.N1, user_id: A.id, title: "复杂笔记", content: N1_CONTENT, reading_item_id: ids.R1, icon: "📚", cover_url: "https://example.com/note-cover.jpg", cover_position: 30, parent_note_id: null, full_width: true, font_family: "serif", small_font: true, is_pinned: true, last_edit_by: null, created_at: past, updated_at: ts } },
  { table: "notes", row: { id: ids.N2, user_id: A.id, title: "父笔记", content: N2_CONTENT, reading_item_id: null, icon: null, cover_url: null, cover_position: 50, parent_note_id: null, full_width: false, font_family: "mono", small_font: false, is_pinned: false, last_edit_by: null, created_at: past, updated_at: ts } },
  { table: "notes", row: { id: ids.N3, user_id: A.id, title: "子笔记", content: { type: "doc", content: [] }, reading_item_id: null, icon: null, cover_url: null, cover_position: 50, parent_note_id: ids.N2, full_width: false, font_family: "default", small_font: false, is_pinned: false, last_edit_by: null, created_at: past, updated_at: ts } },
  { table: "notes", row: { id: ids.N4, user_id: A.id, title: "回收站笔记", content: N4_CONTENT, reading_item_id: null, icon: null, cover_url: null, cover_position: 50, parent_note_id: null, full_width: false, font_family: "default", small_font: false, is_pinned: false, last_edit_by: null, created_at: past, updated_at: ts, deleted_at: ts } },
  // 标签与关系（NT3 是回收站笔记的标签行——孤儿探针）
  { table: "tags", row: { id: ids.G1, user_id: A.id, name: "重要", color: "blue", created_at: past } },
  { table: "tags", row: { id: ids.G2, user_id: A.id, name: "稍后", color: "amber", created_at: past } },
  { table: "tags", row: { id: ids.G3, user_id: A.id, name: "回收站标签", color: "gray", created_at: past } },
  { table: "item_tags", row: { item_id: ids.R1, tag_id: ids.G1 } },
  { table: "item_tags", row: { item_id: ids.R4, tag_id: ids.G2 } },
  { table: "note_tags", row: { note_id: ids.N1, tag_id: ids.G1 } },
  { table: "note_tags", row: { note_id: ids.N4, tag_id: ids.G3 } },
  // 任务：层级 T1→T2 / 清单依赖提醒附件活动 T3 / 列表归属 / 引用回收站笔记 T5 / 回收站 T6
  { table: "task_lists", row: { id: ids.L1, user_id: A.id, name: "工作", icon: "💼", color: "#3b82f6", sort_order: 0, is_default: true, created_at: past, updated_at: ts } },
  { table: "task_lists", row: { id: ids.L2, user_id: A.id, name: "回收站列表", icon: null, color: null, sort_order: 1, is_default: false, created_at: past, updated_at: ts, deleted_at: ts } },
  { table: "tasks", row: { id: ids.T1, user_id: A.id, title: "父任务", description: null, status: "todo", priority: "high", category: "work", due_date: null, estimated_minutes: 30, actual_minutes: null, reading_item_id: null, note_id: ids.N1, parent_task_id: null, is_pinned: false, sort_order: 0, completed_at: null, created_at: past, updated_at: ts, list_id: ids.L1 } },
  { table: "tasks", row: { id: ids.T2, user_id: A.id, title: "子任务", description: null, status: "in_progress", priority: "medium", category: "work", due_date: ts, estimated_minutes: null, actual_minutes: 10, reading_item_id: ids.R2, note_id: null, parent_task_id: ids.T1, is_pinned: true, sort_order: 1, completed_at: null, created_at: past, updated_at: ts, list_id: ids.L1 } },
  { table: "tasks", row: { id: ids.T3, user_id: A.id, title: "全配件任务", description: "带清单/依赖/提醒/附件/活动", status: "todo", priority: "low", category: "life", due_date: null, estimated_minutes: null, actual_minutes: null, reading_item_id: null, note_id: null, parent_task_id: null, is_pinned: false, sort_order: 2, completed_at: null, created_at: past, updated_at: ts, list_id: null } },
  { table: "tasks", row: { id: ids.T5, user_id: A.id, title: "回收站列表里的任务", description: null, status: "todo", priority: "medium", category: "study", due_date: null, estimated_minutes: null, actual_minutes: null, reading_item_id: null, note_id: null, parent_task_id: null, is_pinned: false, sort_order: 3, completed_at: null, created_at: past, updated_at: ts, list_id: ids.L2 } },
  { table: "tasks", row: { id: ids.T6, user_id: A.id, title: "回收站任务", description: null, status: "done", priority: "high", category: "work", due_date: null, estimated_minutes: null, actual_minutes: 60, reading_item_id: null, note_id: null, parent_task_id: null, is_pinned: false, sort_order: 4, completed_at: ts, created_at: past, updated_at: ts, list_id: null, deleted_at: ts } },
  { table: "task_checklists", row: { id: ids.CL1, task_id: ids.T3, content: "清单一", is_completed: false, sort_order: 0, created_at: past, updated_at: ts } },
  { table: "task_checklists", row: { id: ids.CL2, task_id: ids.T3, content: "清单二", is_completed: true, sort_order: 1, created_at: past, updated_at: ts } },
  { table: "task_checklists", row: { id: ids.CL3, task_id: ids.T6, content: "回收站任务的清单", is_completed: false, sort_order: 0, created_at: past, updated_at: ts } },
  { table: "task_dependencies", row: { task_id: ids.T3, depends_on_task_id: ids.T2, user_id: A.id, created_at: past } },
  { table: "task_dependencies", row: { task_id: ids.T6, depends_on_task_id: ids.T1, user_id: A.id, created_at: past } },
  { table: "task_tags", row: { task_id: ids.T3, tag_id: ids.G1 } },
  { table: "task_tags", row: { task_id: ids.T6, tag_id: ids.G2 } },
  { table: "task_reminders", row: { id: ids.M1, user_id: A.id, task_id: ids.T3, anchor: "start", offset_minutes: -15, notified_at: null, created_at: past } },
  { table: "task_attachments", row: { id: ids.AT1, user_id: A.id, task_id: ids.T3, name: "spec.pdf", bucket: "attachments", path: "task/spec.pdf", mime_type: "application/pdf", size_bytes: 1024, created_at: past } },
  { table: "task_activities", row: { id: ids.AC1, user_id: A.id, task_id: ids.T3, action: "created", detail: { by: "seed" }, created_at: past } },
  { table: "task_item_refs", row: { id: ids.TR1, user_id: A.id, task_id: ids.T1, note_id: ids.N1, block_id: "blk-ref-1", created_at: past } },
  { table: "task_item_refs", row: { id: ids.TR2, user_id: A.id, task_id: ids.T3, note_id: ids.N4, block_id: "blk-trash-1", created_at: past } },
  { table: "task_item_refs", row: { id: ids.TR3, user_id: A.id, task_id: ids.T6, note_id: ids.N1, block_id: "blk-trash-2", created_at: past } },
  // 经验 + 标签
  { table: "lessons", row: { id: ids.E1, user_id: A.id, title: "经验一", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "关联", marks: [{ type: "link", attrs: { href: `/notes/${ids.N1}` } }] }] }] }, lesson_type: "lesson", task_id: ids.T1, reading_item_id: ids.R1, note_id: ids.N1, created_at: past, updated_at: ts } },
  { table: "lesson_tags", row: { lesson_id: ids.E1, tag_id: ids.G1 } },
  // 高亮：H1 全引用；H2 挂回收站文章（RLS 应隐藏）
  { table: "highlights", row: { id: ids.H1, user_id: A.id, reading_item_id: ids.R1, content: "高亮正文", note: "备注", color: "yellow", anchor_path: "body>p[0]", anchor_offset: 3, note_id: ids.N1, task_id: ids.T1, created_at: past, updated_at: ts } },
  { table: "highlights", row: { id: ids.H2, user_id: A.id, reading_item_id: ids.R4, content: "回收站文章高亮", note: null, color: "blue", anchor_path: null, anchor_offset: null, note_id: null, task_id: null, created_at: past, updated_at: ts } },
  // 收藏三类
  { table: "favorites", row: { id: ids.F1, user_id: A.id, target_type: "reading", target_id: ids.R1, note: null, created_at: past } },
  { table: "favorites", row: { id: ids.F2, user_id: A.id, target_type: "note", target_id: ids.N1, note: "置顶", created_at: past } },
  { table: "favorites", row: { id: ids.F3, user_id: A.id, target_type: "task", target_id: ids.T1, note: null, created_at: past } },
  // 版本（V3 挂回收站笔记——孤儿探针）、评论线程、建议
  { table: "note_versions", row: { id: ids.V1, note_id: ids.N1, content: N2_CONTENT, title: "历史一", message: "初版", created_at: past } },
  { table: "note_versions", row: { id: ids.V2, note_id: ids.N1, content: N1_CONTENT, title: "历史二", message: null, created_at: ts } },
  { table: "note_versions", row: { id: ids.V3, note_id: ids.N4, content: N4_CONTENT, title: "回收站笔记历史", message: null, created_at: ts } },
  { table: "note_comment_threads", row: { id: ids.TH1, user_id: A.id, note_id: ids.N1, block_id: "blk-c-1", resolved_at: null, created_at: past, updated_at: ts } },
  { table: "note_comments", row: { id: uuid(), user_id: A.id, thread_id: ids.TH1, body: "评论正文", created_at: past, updated_at: ts } },
  { table: "note_suggestions", row: { id: uuid(), user_id: A.id, note_id: ids.N1, block_id: "blk-c-1", original_block: { type: "paragraph" }, proposed_block: { type: "heading", attrs: { level: 2 } }, status: "pending", created_at: past, updated_at: ts } },
  // 同步块 / 数据库块
  { table: "synced_blocks", row: { id: ids.S1, user_id: A.id, content: [{ type: "paragraph", content: [{ type: "text", text: "同步块内容" }] }], created_at: past, updated_at: ts } },
  { table: "db_databases", row: { id: ids.D1, user_id: A.id, parent_note_id: ids.N1, title: "书籍清单", icon: "📚", schema: [{ id: "p1", name: "书名", type: "text" }], views: [{ id: "v1", type: "table", config: {} }], created_at: past, updated_at: ts } },
  { table: "db_rows", row: { id: ids.DR1, user_id: A.id, database_id: ids.D1, sort: 0, values: { p1: "深入理解计算机系统", link: { type: "paragraph", content: [{ type: "text", text: "相关笔记", marks: [{ type: "link", attrs: { href: `/notes/${ids.N1}` } }] }] } }, created_at: past, updated_at: ts } },
  // 模板 / 倒数日
  { table: "task_templates", row: { id: ids.TP1, user_id: A.id, name: "周报模板", template: { type: "doc", content: [{ type: "paragraph" }] }, created_at: past, updated_at: ts } },
  { table: "countdown_days", row: { id: ids.CD1, user_id: A.id, title: "发布日", target_date: "2027-01-01", repeat_annually: true, deleted_at: null, created_at: past, updated_at: ts } },
  // 速记（MM2 回收站：导出应带 deleted_at 标记无损保留）+ 转笔记关联
  { table: "memos", row: { id: ids.MM1, user_id: A.id, content: "速记一 #标签", tags: ["标签"], deleted_at: null, created_at: past, updated_at: ts } },
  { table: "memos", row: { id: ids.MM2, user_id: A.id, content: "回收站速记", tags: [], deleted_at: ts, created_at: past, updated_at: ts } },
  { table: "memo_notes", row: { id: ids.MN1, user_id: A.id, memo_id: ids.MM1, note_id: ids.N1, created_at: past } },
  { table: "memo_notes", row: { id: ids.MN2, user_id: A.id, memo_id: ids.MM2, note_id: ids.N1, created_at: past } },
];

for (const [index, { table, row }] of seed.entries()) {
  const { error } = await serviceDb.from(table).insert(row);
  if (error) console.error(`>> failed at seed[${index}] ${table} id=${row.id}`);
  if (error) throw new Error(`seed ${table} [${row.id ?? JSON.stringify(row).slice(0, 60)}]: ${error.message}`);
}
console.log(`seeded ${seed.length} rows for A`);

// ============ 3. 以 A 的会话导出（生产代码路径） ============
const exportA = pruneExportData(await fetchBackupData(A.client, A.id));
let backupJson: string;
try {
  backupJson = JSON.stringify(createBackupV2(exportA));
  console.log(`export ok: ${backupJson.length} bytes`);
} catch (err) {
  check("导出（含回收站行/孤儿行场景）成功", false, err instanceof Error ? err.message : err);
  process.exit(1);
}
check("导出（含回收站行/孤儿行场景）成功", true);

const inspection = inspectBackupV2(backupJson);
check("导出文件通过备份校验", inspection.ok, inspection.ok ? undefined : inspection.issues.slice(0, 5));
if (!inspection.ok) process.exit(1);
const backup = inspection.backup;

// 导出可见性断言（RLS + 剪枝后的合同语义）
check("回收站笔记不进导出", !backup.data.notes.some((r) => r.id === ids.N4));
check("回收站文章不进导出", !backup.data.reading_items.some((r) => r.id === ids.R4));
check("回收站任务不进导出", !backup.data.tasks.some((r) => r.id === ids.T6));
check("回收站任务列表不进导出", !backup.data.task_lists.some((r) => r.id === ids.L2));
check("回收站速记带 deleted_at 标记无损导出", backup.data.memos.some((r) => r.id === ids.MM2 && r.deleted_at !== null));
check("回收站笔记的孤儿标签行被剔除", !backup.data.note_tags.some((r) => r.note_id === ids.N4));
check("回收站笔记的孤儿版本行被剔除", !backup.data.note_versions.some((r) => r.id === ids.V3));
check("回收站文章的孤儿标签行被剔除", !backup.data.item_tags.some((r) => r.item_id === ids.R4));
check("回收站任务的孤儿清单/依赖/标签行被剔除",
  !backup.data.task_checklists.some((r) => r.id === ids.CL3) &&
  !backup.data.task_dependencies.some((r) => r.task_id === ids.T6) &&
  !backup.data.task_tags.some((r) => r.task_id === ids.T6));
check("指向回收站行的任务双链行被剔除", !backup.data.task_item_refs.some((r) => r.id === ids.TR2 || r.id === ids.TR3));
check("挂回收站文章的高亮被剔除", !backup.data.highlights.some((r) => r.id === ids.H2));
check("回收站列表中任务的 list_id 置空", backup.data.tasks.some((r) => r.id === ids.T5 && r.list_id == null));
check("活跃任务的 list_id 保留", backup.data.tasks.some((r) => r.id === ids.T1 && r.list_id === ids.L1));

// ============ 4. 以 B 的会话恢复（生产代码路径：inspect → prepare → RPC） ============
// 预生成 ID 队列：与 prepareRestorePayload 的消费顺序一致（ID_TABLES × 行序），
// 从而在客户端侧拿到完整 旧ID→新ID 映射供逐项比对。
const idMaps = new Map<string, string>();
const queue: string[] = [];
for (const table of ID_TABLES) {
  for (const row of backup.data[table] ?? []) {
    const newId = uuid();
    idMaps.set(String(row.id), newId);
    queue.push(newId);
  }
}
const payload = prepareRestorePayload(backup, () => {
  const next = queue.shift();
  if (!next) throw new Error("uuid queue exhausted — prepareRestorePayload consumed more IDs than expected");
  return next;
});
check("ID 队列恰好耗尽（客户端映射与 prepareRestorePayload 同序）", queue.length === 0);
for (const [oldId, newId] of idMaps) {
  if (j(payload.data).includes(oldId)) {
    check(`旧 ID ${oldId} 不残留于载荷`, false);
  }
}
check("载荷不含任何旧 ID", true);

const restoreAsB = await (B.client.rpc as unknown as (
  fn: string, args: Record<string, unknown>
) => Promise<{ data: { status?: string; counts?: Record<string, number> } | null; error: { message: string } | null }>)(
  "restore_backup_v2_full", { p_payload: payload }
);
check("恢复 RPC 成功", !restoreAsB.error && restoreAsB.data?.status === "restored", restoreAsB.error?.message);
if (restoreAsB.error || restoreAsB.data?.status !== "restored") process.exit(1);

// ============ 5. 读回 B 并逐表逐行比对 ============
const restoredB = await fetchBackupData(B.client, B.id);

let comparedRows = 0;
const tableMismatches: string[] = [];
for (const table of BACKUP_TABLES) {
  const expectedRows = payload.data[table] as unknown as Array<Record<string, unknown>>;
  const actualRows = restoredB[table] as unknown as Array<Record<string, unknown>>;
  const byId = new Map(actualRows.map((r) => [String(r.id), r]));
  for (const expected of expectedRows) {
    comparedRows++;
    const actual = byId.get(String(expected.id));
    if (!actual || !rowMatches(expected, actual)) {
      tableMismatches.push(`${table}:${expected.id}`);
    }
  }
  check(`${table}: 载荷 ${expectedRows.length} 行与恢复结果一致`, expectedRows.every((expected) => {
    const actual = byId.get(String(expected.id));
    return actual && rowMatches(expected, actual);
  }), tableMismatches.filter((m) => m.startsWith(`${table}:`)));
}
console.log(`compared ${comparedRows} rows across ${BACKUP_TABLES.length} tables`);

// 无 id 的纯关系表按元组集合比对
const TUPLE_KEYS: Record<string, string[]> = {
  item_tags: ["item_id", "tag_id"],
  note_tags: ["note_id", "tag_id"],
  task_tags: ["task_id", "tag_id"],
  lesson_tags: ["lesson_id", "tag_id"],
  task_dependencies: ["task_id", "depends_on_task_id"],
};
for (const [table, keys] of Object.entries(TUPLE_KEYS)) {
  const project = (r: Record<string, unknown>) => j(Object.fromEntries(keys.map((k) => [k, r[k]])));
  const expectedSet = new Set((payload.data[table as keyof typeof payload.data] as unknown as Array<Record<string, unknown>>).map(project));
  const actualSet = new Set((restoredB[table as keyof typeof restoredB] as unknown as Array<Record<string, unknown>>).map(project));
  let ok = expectedSet.size === actualSet.size;
  if (ok) for (const entry of expectedSet) if (!actualSet.has(entry)) { ok = false; break; }
  check(`${table}: 元组集合一致`, ok, { expected: [...expectedSet], actual: [...actualSet] });
}

// 软删除语义
check("B 无回收站笔记", !restoredB.notes.some((r) => r.title === "回收站笔记"));
check("B 无回收站任务", !restoredB.tasks.some((r) => r.title === "回收站任务"));
check("B 无回收站任务列表", !restoredB.task_lists.some((r) => r.title === "回收站列表" || r.name === "回收站列表"));
check("B 的回收站速记保留为回收站态", restoredB.memos.some((r) => r.id === idMaps.get(ids.MM2) && r.deleted_at !== null));
check("B 的速记↔笔记关联保留（含回收站速记的关联）",
  restoredB.memo_notes.length === 2 &&
  restoredB.memo_notes.some((r) => r.memo_id === idMaps.get(ids.MM1) && r.note_id === idMaps.get(ids.N1)) &&
  restoredB.memo_notes.some((r) => r.memo_id === idMaps.get(ids.MM2) && r.note_id === idMaps.get(ids.N1)));

// 内容重写与悬空引用
const restoredN1 = restoredB.notes.find((r) => r.id === idMaps.get(ids.N1));
const n1Json = restoredN1 ? j(restoredN1.content) : "";
check("N1 内链指向新 R1", n1Json.includes(`/library/${idMaps.get(ids.R1)}`));
check("N1 内链指向新 N2", n1Json.includes(`/notes/${idMaps.get(ids.N2)}`));
check("指向回收站笔记的悬空链接原样保留（旧 N4 id）", n1Json.includes(`/notes/${ids.N4}`));
check("taskItem 绑定重映射到新 T1", n1Json.includes(`"taskId":"${idMaps.get(ids.T1)}"`));
check("同步块引用重映射到新 S1", n1Json.includes(String(idMaps.get(ids.S1))));
check("数据库块引用重映射到新 D1", n1Json.includes(String(idMaps.get(ids.D1))));
check("last_edit_by 不搬运（066 合同）", restoredN1?.last_edit_by === null || restoredN1?.last_edit_by === undefined);
check("恢复的 last_edit_by 字段为 null 而非透传", restoredN1 ? restoredN1.last_edit_by === null : false);
check("任务双链重映射到新 T1/N1", restoredB.task_item_refs.some((r) => r.task_id === idMaps.get(ids.T1) && r.note_id === idMaps.get(ids.N1)));

// ============ 6. 负例 ============
const rerestoreA = await (A.client.rpc as unknown as (
  fn: string, args: Record<string, unknown>
) => Promise<{ data: { status?: string } | null; error: { message: string } | null }>)(
  "restore_backup_v2_full", { p_payload: payload }
);
check("非空账号恢复被拒（not_empty）", rerestoreA.data?.status === "not_empty", rerestoreA.data);

check("损坏 JSON（截断）被拒", (() => {
  const result = inspectBackupV2(backupJson.slice(0, Math.floor(backupJson.length / 2)));
  return !result.ok && result.issues[0]?.code === "INVALID_JSON";
})());
check("非法 JSON 被拒", (() => {
  const result = inspectBackupV2("{not json at all");
  return !result.ok && result.issues[0]?.code === "INVALID_JSON";
})());
check("超限文件（>10MiB 字符串）被拒", (() => {
  const big = JSON.stringify({ pad: "x".repeat(BACKUP_MAX_BYTES + 1024) });
  const result = inspectBackupV2(big);
  return !result.ok && result.issues[0]?.code === "LIMIT_EXCEEDED";
})());

console.log(failed === 0 ? `\nB01 演练：全部通过（${RUN}）` : `\nB01 演练：${failed} 项失败（${RUN}）`);
process.exit(failed === 0 ? 0 : 1);
