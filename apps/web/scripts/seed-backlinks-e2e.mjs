// B03 反链读路径切读（v2）E2E 种子（真实后端专用）
//
// 用法：node scripts/seed-backlinks-e2e.mjs
// 前置：supabase start + scripts/seed-collab-e2e.mjs（复用其 A 账号与密码约定）
// 产出：.tmp-e2e/backlinks-seed.json（目标/来源笔记 id + 账号凭据）
//
// 幂等 upsert（固定 UUID，重跑同一起点）：
//   1. 目标笔记 BL_T：A 所有，正文一段（无链接）
//   2. 来源笔记 BL_S：A 所有，正文含指向 BL_T 的 link mark（href=/notes/{T}）
//      ——078 触发器在 upsert 时即建边，无需回填
//
// E2E（e2e/note-backlinks.spec.ts）：A 打开 BL_T → 反链面板列出 BL_S 标题，
// 验证切读后的 get_note_backlinks_v2 全链路（客户端 v2 游标读 → 078 索引）。
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const status = JSON.parse(execSync("supabase status -o json", { encoding: "utf8" }));
const url = status.API_URL;
const serviceKey = status.SERVICE_ROLE_KEY;

const collabSeed = JSON.parse(readFileSync(".tmp-e2e/collab-seed.json", "utf8"));
const password = collabSeed.userA.password;

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const list = await admin.auth.admin.listUsers();
const userA = list.data?.users?.find((u) => u.email === collabSeed.userA.email);
if (!userA) throw new Error("collab seed 账号缺失：先运行 seed-collab-e2e.mjs");

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const TARGET_ID = "ee300000-0000-4000-8000-000000000001";
const SOURCE_ID = "ee300000-0000-4000-8000-000000000002";

const { error: targetErr } = await db.from("notes").upsert({
  id: TARGET_ID,
  user_id: userA.id,
  title: "反链目标笔记",
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "被链接的目标正文" }] }],
  },
});
if (targetErr) throw new Error(`target upsert: ${targetErr.message}`);

const { error: sourceErr } = await db.from("notes").upsert({
  id: SOURCE_ID,
  user_id: userA.id,
  title: "反链来源笔记",
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "引用",
            marks: [{ type: "link", attrs: { href: `/notes/${TARGET_ID}` } }],
          },
        ],
      },
    ],
  },
});
if (sourceErr) throw new Error(`source upsert: ${sourceErr.message}`);

mkdirSync(".tmp-e2e", { recursive: true });
writeFileSync(
  ".tmp-e2e/backlinks-seed.json",
  JSON.stringify(
    {
      targetId: TARGET_ID,
      sourceId: SOURCE_ID,
      userA: { email: userA.email, password },
    },
    null,
    2
  )
);
console.log("backlinks e2e seed ok:", { TARGET_ID, SOURCE_ID });
