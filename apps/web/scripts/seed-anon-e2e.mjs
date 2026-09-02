// 072 匿名可编辑公开链接 e2e 种子脚本（本地真实后端专用）
//
// 用法：node scripts/seed-anon-e2e.mjs
// 前置：supabase start（本地后端运行中）
// 产出：.tmp-e2e/anon-seed.json（公开编辑 token + 只读 token），供 e2e/anon-collab.spec.ts 读取
//
// 做三件事：
//   1. 从 `supabase status` 取 service_role key
//   2. Admin API 建属主账号（幂等）
//   3. PostgREST（service_role 直写）建笔记 + public_edit / public_read 两条分享（固定 uuid，幂等）
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const status = JSON.parse(execSync("supabase status -o json", { encoding: "utf8" }));
const url = status.API_URL;
const serviceKey = status.SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const OWNER_EMAIL = "anon-share-owner@test.local";
let ownerId;
const list = await admin.auth.admin.listUsers();
const existing = list.data?.users?.find((u) => u.email === OWNER_EMAIL);
if (existing) {
  ownerId = existing.id;
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email: OWNER_EMAIL,
    password: "anon-e2e-password",
    email_confirm: true,
    user_metadata: { full_name: "分享属主" },
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  ownerId = data.user.id;
}

const NOTE_ID = "ee100000-0000-4000-8000-000000000001";
const EDIT_TOKEN = "anon-e2e-edit-token-0001";
const READ_TOKEN = "anon-e2e-read-token-0001";

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

// 笔记（幂等 upsert，绕 RLS 由 service role 完成）
const seedContent = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "第一段：属主播种内容" }] },
    { type: "paragraph" },
  ],
};
const { error: noteErr } = await db.from("notes").upsert({
  id: NOTE_ID,
  user_id: ownerId,
  title: "匿名协同 e2e 笔记",
  content: seedContent,
  content_revision: 0,
});
if (noteErr) throw new Error(`upsert note: ${noteErr.message}`);

// 两条分享：可编辑 / 只读（幂等）
for (const [token, mode] of [
  [EDIT_TOKEN, "public_edit"],
  [READ_TOKEN, "public_read"],
]) {
  const { error } = await db.from("shares").upsert(
    {
      owner_id: ownerId,
      resource_type: "note",
      resource_id: NOTE_ID,
      token,
      is_public: mode !== "disabled",
      access_mode: mode,
    },
    { onConflict: "token" }
  );
  if (error) throw new Error(`upsert share ${mode}: ${error.message}`);
}

mkdirSync(".tmp-e2e", { recursive: true });
writeFileSync(
  ".tmp-e2e/anon-seed.json",
  JSON.stringify({ noteId: NOTE_ID, editToken: EDIT_TOKEN, readToken: READ_TOKEN })
);
console.log("anon e2e seed written: .tmp-e2e/anon-seed.json");
