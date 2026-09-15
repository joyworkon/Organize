import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// C05 S4 本地段（设计 docs/handoff/c05-notification-design.md §3.1）：cron 路由的
// 投递分支单测——stub web-push（纯 Node 层，不冒充推送服务本身）+ stub 服务端
// Supabase 客户端。覆盖：鉴权、未配置 503、claim 失败 500、成功投递置 sent、
// 永久失败（404/410）停订、瞬时失败指数退避、lastSentAt 心跳透出。
// 浏览器订阅→真实推送服务→离线补投属 staging 项（自动化环境的 push 服务注册
// 层被拒——2026-09-15 三种浏览器配置实测，见设计文档 §3.1 记录）。

type DeliveryRow = Record<string, unknown>;
let claimedFixture: Array<Record<string, unknown>> = [];
let claimError: { message: string } | null = null;
const deliveryUpdates: Array<{ values: DeliveryRow; id: string }> = [];
const subscriptionUpdates: Array<{ values: DeliveryRow; id: string }> = [];
let lastSentFixture: Array<{ sent_at: string | null }> = [];
const sendCalls: Array<{ endpoint: string; payload: string }> = [];
/** 按 sendNotification 调用顺序取用的失败注入：数字=HTTP 状态码，undefined=成功 */
let sendFailures: Array<number | undefined> = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { persistSession: false, autoRefreshToken: false },
    rpc: async (name: string, args: unknown) => {
      expect(name).toBe("claim_due_task_reminder_deliveries");
      expect(args).toEqual({ p_limit: 100 });
      if (claimError) return { data: null, error: claimError };
      return { data: claimedFixture, error: null };
    },
    from: (table: string) => ({
      // 心跳查询：.select("sent_at").not("sent_at","is",null).order().limit(1)
      select() {
        return {
          not() {
            return {
              order() {
                return {
                  limit() {
                    return Promise.resolve({ data: lastSentFixture, error: null });
                  },
                };
              },
            };
          },
        };
      },
      update(values: DeliveryRow) {
        return {
          eq(_column: string, id: string) {
            if (table === "task_reminder_deliveries") deliveryUpdates.push({ values, id });
            else if (table === "web_push_subscriptions") subscriptionUpdates.push({ values, id });
            return Promise.resolve({ error: null });
          },
        };
      },
    }),
  }),
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (subscription: { endpoint: string }, payload: string) => {
      const failure = sendFailures.shift();
      sendCalls.push({ endpoint: subscription.endpoint, payload });
      if (failure !== undefined) {
        throw Object.assign(new Error(`send failed ${failure}`), { statusCode: failure });
      }
      return {};
    }),
  },
}));

import { POST } from "./route";

const DELIVERY_BASE = {
  subscription_id: "sub-1",
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  p256dh: "p256dh-key",
  auth_secret: "auth-key",
  task_id: "task-1",
  task_title: "投递任务",
  anchor: "start" as const,
  scheduled_for: new Date("2026-09-15T08:00:00Z").toISOString(),
  attempt_count: 0,
};

const ENV_KEYS = [
  "CRON_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
] as const;
const savedEnv: Record<string, string | undefined> = {};

const callPost = (secret?: string) =>
  POST(
    new Request("http://localhost:3000/api/cron/task-reminders", {
      method: "POST",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }) as never
  ).then(async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> }));

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    process.env[key] =
      {
        CRON_SECRET: "test-cron-secret",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "test-public-key",
        VAPID_PRIVATE_KEY: "test-private-key",
        VAPID_SUBJECT: "mailto:test@organize.local",
      }[key] ?? "";
  }
  claimedFixture = [
    { ...DELIVERY_BASE, delivery_id: "delivery-1" },
    { ...DELIVERY_BASE, delivery_id: "delivery-2", endpoint: "https://fcm.googleapis.com/fcm/send/def" },
  ];
  claimError = null;
  deliveryUpdates.length = 0;
  subscriptionUpdates.length = 0;
  lastSentFixture = [];
  sendCalls.length = 0;
  sendFailures = [];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("POST /api/cron/task-reminders", () => {
  it("缺少/错误 CRON_SECRET → 401 且不触达推送", async () => {
    await expect(callPost()).resolves.toMatchObject({ status: 401 });
    await expect(callPost("wrong-secret")).resolves.toMatchObject({ status: 401 });
    expect(sendCalls).toHaveLength(0);
  });

  it("推送环境未配置齐 → 503 提醒服务未配置", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    await expect(callPost("test-cron-secret")).resolves.toMatchObject({
      status: 503,
      body: { error: "提醒服务未配置" },
    });
    expect(sendCalls).toHaveLength(0);
  });

  it("claim RPC 失败 → 500 且不发送", async () => {
    claimError = { message: "rpc boom" };
    await expect(callPost("test-cron-secret")).resolves.toMatchObject({ status: 500 });
    expect(sendCalls).toHaveLength(0);
  });

  it("成功投递：逐条发送（payload 带 /tasks/{taskId} 跳转 URL）并置 sent + sent_at，心跳透出", async () => {
    const sentAt = new Date("2026-09-15T08:30:00Z").toISOString();
    lastSentFixture = [{ sent_at: sentAt }];
    const result = await callPost("test-cron-secret");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ claimed: 2, sent: 2, failed: 0, lastSentAt: sentAt });
    expect(sendCalls).toHaveLength(2);
    const payload = JSON.parse(sendCalls[0].payload) as { url: string; title: string };
    expect(payload.url).toBe("/tasks/task-1");
    expect(payload.title).toBe("投递任务");
    expect(deliveryUpdates).toHaveLength(2);
    for (const update of deliveryUpdates) {
      expect(update.values).toMatchObject({ status: "sent", error: null });
      expect(typeof update.values.sent_at).toBe("string");
    }
    expect(subscriptionUpdates).toHaveLength(0);
  });

  it("永久失败（410）→ 停订该订阅 + 投递不再重试（next_attempt_at=null）", async () => {
    sendFailures = [410];
    claimedFixture = [{ ...DELIVERY_BASE, delivery_id: "delivery-gone", attempt_count: 3 }];
    const result = await callPost("test-cron-secret");
    expect(result.body).toMatchObject({ claimed: 1, sent: 0, failed: 1 });
    expect(subscriptionUpdates).toHaveLength(1);
    expect(subscriptionUpdates[0].id).toBe("sub-1");
    expect(typeof subscriptionUpdates[0].values.disabled_at).toBe("string");
    expect(deliveryUpdates[0].values).toMatchObject({ status: "failed", next_attempt_at: null });
  });

  it("瞬时失败（500）→ 按 attempt_count 指数退避安排下次重试", async () => {
    sendFailures = [500];
    claimedFixture = [{ ...DELIVERY_BASE, delivery_id: "delivery-retry", attempt_count: 2 }];
    const before = Date.now();
    const result = await callPost("test-cron-secret");
    expect(result.body).toMatchObject({ failed: 1 });
    // nextRetryDelayMinutes(2) = min(60, 2^2) = 4 分钟
    const retryAt = deliveryUpdates[0].values.next_attempt_at as string;
    expect(Number.isFinite(Date.parse(retryAt))).toBe(true);
    const deltaMinutes = (Date.parse(retryAt) - before) / 60_000;
    expect(deltaMinutes).toBeGreaterThan(3.5);
    expect(deltaMinutes).toBeLessThan(4.5);
    expect(subscriptionUpdates).toHaveLength(0);
  });
});
