// B03 基准比较：get_note_backlinks（074 LIKE 全扫）vs get_note_backlinks_v2（078 索引）
//
// 用法（前置：本地 Supabase 运行中，已应用 078/079）：
//   cd apps/web && npx tsx scripts/perf/backlinks-bench.mts
//
// 方法（设计 §5「基准比较」）：
//   - 建本轮专用基准账号，service_role 播种：1 目标 + 1,000 来源（各含 1 条内链）
//     + 100 篇无链接干扰笔记；每篇正文约 2KB（贴近真实笔记体量——v1 LIKE 扫描的
//     成本与该用户全部笔记的 content 文本总量成正比，微缩正文会低估 v1）
//   - 同一用户会话、同一负载，v1 / v2 各预热 1 轮 + 计时 5 轮（每轮 = 全量翻页取尽），
//     报告 min / 中位数 / max
//   - 结束清理本轮账号与数据
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const RUN = Date.now().toString(36);
const EMAIL = `backlinks-bench-${RUN}@test.local`;
const PASSWORD = `b03-bench-${RUN}-password`;
const SOURCES = 1000;
const DISTRACTORS = 100;
const ROUNDS = 5;
const PAGE_SIZE = 100;

const status = JSON.parse(execSync("supabase status -o json", { encoding: "utf8" }));
const URL = process.env.SUPABASE_URL ?? status.API_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? status.SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
const serviceDb = createClient(URL, SERVICE_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${SERVICE_KEY}` } },
});
const uuid = () => crypto.randomUUID();

async function createUser(): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
}

function linkContent(targetId: string) {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: `${filler(2000)}内链`,
            marks: [{ type: "link", attrs: { href: `/notes/${targetId}` } }],
          },
        ],
      },
    ],
  };
}

// ~2KB 中文正文（贴近真实笔记体量）
function filler(chars: number): string {
  return "正文内容取样".repeat(Math.ceil(chars / 6)).slice(0, chars);
}

function plainContent() {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: filler(2000) }] },
    ],
  };
}

async function seed(userId: string): Promise<string> {
  const targetId = uuid();
  const rows: { id: string; user_id: string; title: string; content: unknown }[] = [
    { id: targetId, user_id: userId, title: "基准目标", content: { type: "doc", content: [] } },
  ];
  for (let i = 0; i < SOURCES; i += 1) {
    rows.push({
      id: uuid(),
      user_id: userId,
      title: `来源 ${i}`,
      content: linkContent(targetId),
    });
  }
  for (let i = 0; i < DISTRACTORS; i += 1) {
    rows.push({
      id: uuid(),
      user_id: userId,
      title: `干扰 ${i}`,
      content: plainContent(),
    });
  }
  // 分批插入（PostgREST 单请求体量护栏）
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await serviceDb.from("notes").insert(rows.slice(i, i + 200));
    if (error) throw error;
  }
  return targetId;
}

async function signIn(userId: string): Promise<SupabaseClient> {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: PASSWORD,
  });
  if (error) throw error;
  const { data, error: signErr } = await admin.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (signErr) throw signErr;
  // 用独立客户端携带该用户会话（避免污染 admin 客户端状态）
  return createClient(URL, status.ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session!.access_token}` } },
  });
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0].toFixed(1),
    median: sorted[Math.floor(sorted.length / 2)].toFixed(1),
    max: sorted[sorted.length - 1].toFixed(1),
  };
}

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

async function walkV1(user: SupabaseClient, targetId: string): Promise<number> {
  let collected = 0;
  let total = Number.POSITIVE_INFINITY;
  let page = 0;
  while (collected < total) {
    const { data, error } = await user.rpc("get_note_backlinks", {
      p_note_id: targetId,
      p_page_size: PAGE_SIZE,
      p_page: page,
    });
    if (error) throw error;
    total = (data as { total: number }).total;
    collected += (data as { rows: unknown[] }).rows.length;
    if ((data as { rows: unknown[] }).rows.length === 0) break;
    page += 1;
  }
  return collected;
}

async function walkV2(user: SupabaseClient, targetId: string): Promise<number> {
  let collected = 0;
  let cursor: unknown = null;
  for (;;) {
    const { data, error } = await user.rpc("get_note_backlinks_v2", {
      p_note_id: targetId,
      p_page_size: PAGE_SIZE,
      p_cursor: cursor,
    });
    if (error) throw error;
    const page = data as { rows: unknown[]; next_cursor?: unknown };
    collected += page.rows.length;
    if (page.next_cursor === null || page.next_cursor === undefined) break;
    cursor = page.next_cursor;
  }
  return collected;
}

const userId = await createUser();
try {
  const targetId = await seed(userId);
  const user = await signIn(userId);

  // 完整性自检：两条读路径都应取满 1000 个来源
  const v1Count = await walkV1(user, targetId);
  const v2Count = await walkV2(user, targetId);
  if (v1Count !== SOURCES || v2Count !== SOURCES) {
    throw new Error(`完整性自检失败：v1=${v1Count} v2=${v2Count} 期望=${SOURCES}`);
  }
  console.log(`完整性自检：v1=${v1Count} v2=${v2Count}（期望 ${SOURCES}）\n`);

  // 预热
  await timed(() => walkV1(user, targetId));
  await timed(() => walkV2(user, targetId));

  const v1Times: number[] = [];
  const v2Times: number[] = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    v1Times.push(await timed(() => walkV1(user, targetId)));
    v2Times.push(await timed(() => walkV2(user, targetId)));
  }

  console.log(`v1（074 LIKE 全扫，${ROUNDS} 轮全量翻页）ms:`, stats(v1Times));
  console.log(`v2（078 索引，${ROUNDS} 轮全量翻页）ms:`, stats(v2Times));
} finally {
  // 清理：先删数据（cascade 清边）再删账号，本轮专用账号不残留
  await serviceDb.from("notes").delete().eq("user_id", userId);
  await admin.auth.admin.deleteUser(userId);
  console.log("\n清理完成");
}
