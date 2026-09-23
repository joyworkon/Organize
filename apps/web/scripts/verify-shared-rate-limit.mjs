// A06 共享限流两实例实测脚本（本地与 CI collab-e2e job 通用）
//
// 用法（前提：本地 Supabase 运行中；两个 web 实例与两个 collab 实例均已以
// RATE_LIMIT_BACKEND=postgres 启动，指向同一 Supabase）：
//   WEB_A=http://127.0.0.1:3101 WEB_B=http://127.0.0.1:3102 \
//   COLLAB_A=ws://127.0.0.1:1421 COLLAB_B=ws://127.0.0.1:1422 \
//   node scripts/verify-shared-rate-limit.mjs
//
// 三个场景（docs/anon-rate-limit-design.md §5）：
//   1. web token+IP 档：两实例交替对同一（形状合法的）token 保存，
//      合计第 31 次起 429 —— 限流发生在鉴权前，假 token 也计数，无副作用
//   2. web 总量档：每次轮换伪造 XFF（IP 档永不触发），合计第 121 次起 429
//      —— 不信任任意 X-Forwarded-For 的兜底
//   3. WS 握手档：service_role 建专用 public_read 分享（只读连接零写入），
//      两 collab 实例交替握手；本机直连无 XFF → 按设计退化为单 token 总量档，
//      合计第 121 次起 authenticationFailed
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const WEB_A = process.env.WEB_A ?? "http://127.0.0.1:3101";
const WEB_B = process.env.WEB_B ?? "http://127.0.0.1:3102";
const COLLAB_A = process.env.COLLAB_A ?? "ws://127.0.0.1:1421";
const COLLAB_B = process.env.COLLAB_B ?? "ws://127.0.0.1:1422";

// 每轮用随机后缀：窗口 60s 内不与上一轮残留计数互扰，脚本可立即重跑
const RUN = Math.random().toString(36).slice(2, 8);
const WS_TOKEN = `rl-verify-ws-${RUN}`.padEnd(20, "0");
const OWNER_EMAIL = `rl-verify-owner-${RUN}@test.local`;

// 076 共享计数是固定窗口（window = DB clock 对齐 wall clock 分钟，设计决策：
// 单条 UPSERT 原子自增，代价是窗口切换瞬间最多 2× limit 突刺）。
// 每个场景 ~1-40s 远小于 60s 窗口：等下一个窗口起点再开跑，避免场景中途
// 跨分钟边界把计数清零、断言失准（CI 实测 flake：场景 2 起止 00:29:58.9→
// 00:30:01.9 正好跨过 :00 边界，122 次全部放行）。DB 与 runner 同机（容器
// 共享内核时钟），500ms 余量足够。
async function alignToFreshWindow() {
  const wait = 60_000 - (Date.now() % 60_000) + 500;
  await new Promise((resolve) => setTimeout(resolve, wait));
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

async function saveOnce(baseUrl, token, xff) {
  const headers = { "content-type": "application/json" };
  if (xff) headers["x-forwarded-for"] = xff;
  const res = await fetch(`${baseUrl}/api/public-share/${token}/save`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content: { type: "doc", content: [] } }),
  });
  // 消费响应体避免连接悬挂
  await res.text();
  return res.status;
}

// ========== 场景 1：token+IP 档两实例合计 30 ==========
async function scenario1() {
  await alignToFreshWindow();
  const token = `rl-verify-ip-${RUN}`.padEnd(20, "0"); // 形状合法（>=16 chars）即计数
  let four29 = 0;
  let non429 = 0;
  for (let i = 0; i < 32; i++) {
    const status = await saveOnce(i % 2 === 0 ? WEB_A : WEB_B, token, null);
    if (status === 429) four29++;
    else non429++;
  }
  assert(non429 === 30, `场景1 token+IP 档：前 30 次放行（实测 ${non429}）`);
  assert(four29 === 2, `场景1 token+IP 档：第 31/32 次 429（实测 ${four29}）`);
}

// ========== 场景 2：轮换伪造 XFF，总量档合计 120 ==========
async function scenario2() {
  await alignToFreshWindow();
  const token = `rl-verify-xff-${RUN}`.padEnd(20, "0");
  let four29 = 0;
  let non429 = 0;
  for (let i = 0; i < 122; i++) {
    const status = await saveOnce(
      i % 2 === 0 ? WEB_A : WEB_B,
      token,
      `198.51.100.${(i % 254) + 1}` // 每次不同假 IP：IP 档（30/min）永不触发
    );
    if (status === 429) four29++;
    else non429++;
  }
  assert(non429 === 120, `场景2 总量档：轮换 XFF 下前 120 次放行（实测 ${non429}）`);
  assert(four29 === 2, `场景2 总量档：第 121/122 次 429——伪造 IP 绕不过总量档（实测 ${four29}）`);
}

// ========== 场景 3：WS 握手两实例合计（单 token 总量档 120） ==========
// 本机直连无边缘代理 → 无 XFF → 握手限流按设计退化为单 token 总量档
// （「无可信代理只走总量档」本身就是设计语义，见 anon-auth-limiter.ts）。
// token+IP 档的共享合计由场景 1（web）+ pgTAP 076 覆盖（同一 RPC 同一机制）。
async function scenario3() {
  await alignToFreshWindow();
  // service_role 建专用账号 + 笔记 + public_read 分享（幂等；只读连接零写入）
  const status = JSON.parse(execSync("supabase status -o json", { encoding: "utf8" }));
  const url = process.env.SUPABASE_URL ?? status.API_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? status.SERVICE_ROLE_KEY;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list.data?.users?.find((u) => u.email === OWNER_EMAIL);
  let ownerId;
  if (existing) {
    ownerId = existing.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: OWNER_EMAIL,
      password: "rl-verify-owner-password",
      email_confirm: true,
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    ownerId = data.user.id;
  }

  const NOTE_ID = "ee200000-0000-4000-8000-000000000003"; // 专用固定 uuid（幂等 upsert）
  const { error: noteErr } = await admin.from("notes").upsert({
    id: NOTE_ID,
    user_id: ownerId,
    title: "限流验证专用笔记",
    content: { type: "doc", content: [{ type: "paragraph" }] },
    content_revision: 0,
  });
  if (noteErr) throw new Error(`upsert note: ${noteErr.message}`);

  const { error: ydocErr } = await admin.from("note_ydocs").delete().eq("note_id", NOTE_ID);
  if (ydocErr) throw new Error(`note_ydocs cleanup: ${ydocErr.message}`);

  const { error: shareErr } = await admin.from("shares").upsert(
    {
      owner_id: ownerId,
      resource_type: "note",
      resource_id: NOTE_ID,
      token: WS_TOKEN,
      is_public: true,
      access_mode: "public_read",
    },
    { onConflict: "token" }
  );
  if (shareErr) throw new Error(`upsert share: ${shareErr.message}`);

  const { HocuspocusProvider } = await import("@hocuspocus/provider");
  const Y = await import("yjs");

  /** 单次握手：resolve true（synced）或 false（authenticationFailed/超时） */
  function handshake(wsUrl) {
    return new Promise((resolveHandshake) => {
      const doc = new Y.Doc();
      let done = false;
      const provider = new HocuspocusProvider({
        url: wsUrl,
        name: `note:${NOTE_ID}`,
        document: doc,
        token: `share:${WS_TOKEN}`,
        maxRetryCount: 0, // 被拒即终止，不自动重连干扰计数
        onAuthenticationFailed: () => settled(false),
        onSynced: () => settled(true),
      });
      function settled(result) {
        if (done) return;
        done = true;
        try {
          provider.destroy();
        } catch {
          /* destroy 竞态忽略 */
        }
        doc.destroy();
        resolveHandshake(result);
      }
      // 兜底超时：连接既没 synced 也没被拒（网络问题）按失败处理
      setTimeout(() => settled(false), 10_000).unref?.();
    });
  }

  let okCount = 0;
  let rejected = 0;
  for (let i = 0; i < 122; i++) {
    const ok = await handshake(i % 2 === 0 ? COLLAB_A : COLLAB_B);
    if (ok) okCount++;
    else rejected++;
  }
  assert(okCount === 120, `场景3 WS 握手：前 120 次成功（实测 ${okCount}）`);
  assert(rejected === 2, `场景3 WS 握手：第 121/122 次被拒——两实例合计额度正确（实测 ${rejected}）`);

  // 清理本轮分享行（账号与笔记幂等保留，供下轮复用）
  await admin.from("shares").delete().eq("token", WS_TOKEN);
}

// 先探活，避免「实例没起」被误判为限流行为
for (const [name, base] of [
  ["WEB_A", WEB_A],
  ["WEB_B", WEB_B],
]) {
  const res = await fetch(`${base}/api/health`).catch(() => null);
  assert(res && res.ok, `${name} (${base}) 健康检查通过`);
}

await scenario1();
await scenario2();
await scenario3();
console.log("\nA06 共享限流两实例验证：3/3 场景全部通过");
