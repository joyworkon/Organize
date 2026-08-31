// P5-03 协作端到端验证种子脚本（本地真实后端专用）
//
// 用法：node scripts/seed-collab-e2e.mjs
// 前置：supabase start（本地后端运行中）
// 产出：.tmp-e2e/collab-seed.json（noteId + 两个测试账号），供 e2e/collab.spec.ts 读取
//
// 做四件事：
//   1. 从 `supabase status` 取 anon / service_role key
//   2. Admin API 建 A/B 两个账号（幂等，重复运行返回同一账号）
//   3. PostgREST（service_role 直写）建笔记 / 空间 / 成员 / editor 授权（固定 uuid，幂等）
//   4. 写 seed JSON
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const status = JSON.parse(execSync("supabase status -o json", { encoding: "utf8" }));
const url = status.API_URL;
const serviceKey = status.SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const PASSWORD = "collab-e2e-password";
const USERS = [
  { email: "collab-a@test.local", name: "协作甲" },
  { email: "collab-b@test.local", name: "协作乙" },
];

async function ensureUser({ email, name }) {
  // 先查（幂等）：admin list 过滤
  const list = await admin.auth.admin.listUsers();
  const existing = list.data?.users?.find((u) => u.email === email);
  if (existing) return existing.id;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

const [userA, userB] = await Promise.all(USERS.map(ensureUser));

// 固定 uuid：笔记 N 属于 A；W 为 A 的团队空间，B 是 member，笔记对 W 授权 editor
const NOTE_ID = "ee000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "ee000000-0000-4000-8000-000000000002";

const db = createClient(url, serviceKey, {
  auth: { persistSession: false },
  db: { schema: "public" },
  global: { headers: { Authorization: `Bearer ${serviceKey}` } },
});

const { error: wsErr } = await db
  .from("workspaces")
  .upsert({ id: WORKSPACE_ID, name: "协作E2E空间", kind: "team", owner_id: userA });
if (wsErr) throw new Error(`workspace: ${wsErr.message}`);

const { error: memErr } = await db.from("workspace_members").upsert(
  [
    { workspace_id: WORKSPACE_ID, user_id: userA, role: "owner" },
    { workspace_id: WORKSPACE_ID, user_id: userB, role: "member" },
  ],
  { onConflict: "workspace_id,user_id" }
);
if (memErr) throw new Error(`members: ${memErr.message}`);

const { error: noteErr } = await db.from("notes").upsert(
  {
    id: NOTE_ID,
    user_id: userA,
    title: "协作端到端验证笔记",
    content: {
      type: "doc",
      content: [{ type: "paragraph" }, { type: "paragraph" }],
    },
    content_revision: 0,
  },
  { onConflict: "id" }
);
if (noteErr) throw new Error(`note: ${noteErr.message}`);

const { error: aclErr } = await db.from("resource_acl").upsert(
  {
    workspace_id: WORKSPACE_ID,
    resource_type: "note",
    resource_id: NOTE_ID,
    access_role: "editor",
    created_by: userA,
  },
  { onConflict: "workspace_id,resource_type,resource_id" }
);
if (aclErr) throw new Error(`acl: ${aclErr.message}`);

mkdirSync(".tmp-e2e", { recursive: true });
writeFileSync(
  ".tmp-e2e/collab-seed.json",
  JSON.stringify(
    {
      noteId: NOTE_ID,
      userA: { email: USERS[0].email, password: PASSWORD },
      userB: { email: USERS[1].email, password: PASSWORD },
    },
    null,
    2
  )
);
console.log("seeded:", { noteId: NOTE_ID, userA, userB });
