// A04 同步块双浏览器可靠性 E2E 种子（真实后端专用）
//
// 用法：node scripts/seed-synced-block-e2e.mjs
// 前置：supabase start + scripts/seed-collab-e2e.mjs（复用其 A/B 账号与团队空间）
// 产出：.tmp-e2e/synced-block-seed.json（两篇笔记 + 共享同步块 id + 账号凭据）
//
// 幂等 upsert：
//   1. synced_blocks 行（属主 A，revision=1，内容两段）
//   2. 笔记 SB1：syncedBlock 节点带 hydrated=true + 「过期快照」（验证组件忽略旧值、
//      挂载必拉服务端）；尾随普通段落
//   3. 笔记 SB2：syncedBlock 节点 hydrated=false，快照与服务端一致
//   4. resource_acl：协作 E2E 空间对 SB1 授权 editor（B 的降级视角用例：
//      B 能读笔记但 RLS 拿不到 synced_blocks 行）
//
// 重跑清理：删除两篇笔记的协作 ydoc 残留（067）。上轮运行落下的 blob 若比
// 本次种子的 notes.updated_at 新，连接时会先回放旧内容而非重新播种，
// 「每次重跑同一起点」就不成立；service_role 经 067 的 grant all 可直删。
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const status = JSON.parse(execSync("supabase status -o json", { encoding: "utf8" }));
const url = status.API_URL;
const serviceKey = status.SERVICE_ROLE_KEY;

const collabSeed = JSON.parse(readFileSync(".tmp-e2e/collab-seed.json", "utf8"));
const userAEmail = collabSeed.userA.email;
const userBEmail = collabSeed.userB.email;
const password = collabSeed.userA.password; // 两个账号同密码（seed-collab 约定）

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const list = await admin.auth.admin.listUsers();
const userA = list.data?.users?.find((u) => u.email === userAEmail);
const userB = list.data?.users?.find((u) => u.email === userBEmail);
if (!userA || !userB) throw new Error("collab seed 账号缺失：先运行 seed-collab-e2e.mjs");

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const SB_ID = "ee200000-0000-4000-8000-000000000001";
const NOTE1_ID = "ee200000-0000-4000-8000-000000000011";
const NOTE2_ID = "ee200000-0000-4000-8000-000000000012";
// 与 seed-collab-e2e.mjs 的 WORKSPACE_ID 一致（B 已是其 member）
const WORKSPACE_ID = "ee000000-0000-4000-8000-000000000002";

// 重跑清理：删除两篇笔记的协作 ydoc 残留（067）
const { error: ydocCleanupErr } = await db
  .from("note_ydocs")
  .delete()
  .in("note_id", [NOTE1_ID, NOTE2_ID]);
if (ydocCleanupErr) throw new Error(`note_ydocs cleanup: ${ydocCleanupErr.message}`);

const serverContent = [
  { type: "paragraph", content: [{ type: "text", text: "同步块服务端第一段" }] },
  { type: "paragraph", content: [{ type: "text", text: "服务端第二段" }] },
];
// SB1 的过期快照：hydrated=true 也不得阻止服务端内容生效
const staleSnapshot = [{ type: "paragraph", content: [{ type: "text", text: "不应出现的旧快照段落" }] }] ;

const { error: blockErr } = await db.from("synced_blocks").upsert(
  { id: SB_ID, user_id: userA.id, content: serverContent, revision: 1 },
  { onConflict: "id" }
);
if (blockErr) throw new Error(`synced_blocks: ${blockErr.message}`);

const noteDoc = (blockSnapshot, hydrated) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "页面引导段落" }] },
    {
      type: "syncedBlock",
      attrs: { syncedId: SB_ID, hydrated },
      content: blockSnapshot,
    },
    { type: "paragraph", content: [{ type: "text", text: "页面收尾段落" }] },
  ],
});

const { error: n1Err } = await db.from("notes").upsert(
  {
    id: NOTE1_ID,
    user_id: userA.id,
    title: "同步块E2E-页一",
    content: noteDoc(staleSnapshot, true),
    content_revision: 0,
  },
  { onConflict: "id" }
);
if (n1Err) throw new Error(`note1: ${n1Err.message}`);

const { error: n2Err } = await db.from("notes").upsert(
  {
    id: NOTE2_ID,
    user_id: userA.id,
    title: "同步块E2E-页二",
    content: noteDoc(serverContent, false),
    content_revision: 0,
  },
  { onConflict: "id" }
);
if (n2Err) throw new Error(`note2: ${n2Err.message}`);

const { error: aclErr } = await db.from("resource_acl").upsert(
  {
    workspace_id: WORKSPACE_ID,
    resource_type: "note",
    resource_id: NOTE1_ID,
    access_role: "editor",
    created_by: userA.id,
  },
  { onConflict: "workspace_id,resource_type,resource_id" }
);
if (aclErr) throw new Error(`acl: ${aclErr.message}`);

writeFileSync(
  ".tmp-e2e/synced-block-seed.json",
  JSON.stringify(
    {
      syncedId: SB_ID,
      note1Id: NOTE1_ID,
      note2Id: NOTE2_ID,
      userA: { email: userAEmail, password },
      userB: { email: userBEmail, password },
    },
    null,
    2
  )
);
console.log("seeded synced-block e2e:", { SB_ID, NOTE1_ID, NOTE2_ID });
