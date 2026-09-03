import { beforeEach, describe, expect, it, vi } from "vitest";

// 路由级测试：mock 服务端 Supabase 客户端（cookies/RLS 不可在 node 单测内
// 真实运行），断言鉴权分支、查询结构与响应形状。
type QueryState = Record<string, unknown>;
const queryState: QueryState = {};
let rowsFixture: unknown[] = [];
let queryError: { code?: string; message: string } | null = null;
let userFixture: { id: string } | null = { id: "user-1" };

function makeBuilder() {
  const builder = {
    select(cols: string) {
      queryState.select = cols;
      return this;
    },
    not(col: string, op: string, val: string) {
      queryState.not = { col, op, val };
      return this;
    },
    is(col: string, val: null) {
      queryState.is = { col, val };
      return this;
    },
    or(filter: string) {
      queryState.or = filter;
      return this;
    },
    // supabase-js builder 是 thenable：await 直接落库
    then(
      resolve: (v: { data: unknown[]; error: typeof queryError }) => void,
      _reject: (e: unknown) => void
    ) {
      resolve({ data: rowsFixture, error: queryError });
    },
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: userFixture } }),
    },
    from: () => makeBuilder(),
  })),
}));

import { GET } from "./route";

const call = () =>
  GET(
    new Request("http://localhost:3000/api/tasks/due-soon") as never
  ).then(async (res: Response) => ({ status: res.status, body: await res.json() }));

beforeEach(() => {
  for (const key of Object.keys(queryState)) delete queryState[key];
  rowsFixture = [];
  queryError = null;
  userFixture = { id: "user-1" };
});

describe("GET /api/tasks/due-soon", () => {
  it("未登录返回 401", async () => {
    userFixture = null;
    const { status, body } = await call();
    expect(status).toBe(401);
    expect(body).toEqual({ error: "未授权" });
  });

  it("只查未完成任务、未删除、双锚点窗口过滤", async () => {
    await call();
    expect(queryState.select).toBe("id,title,schedule_start_at,schedule_end_at");
    expect(queryState.not).toEqual({
      col: "status",
      op: "in",
      val: "(done,cancelled)",
    });
    expect(queryState.is).toEqual({ col: "deleted_at", val: null });
    const or = queryState.or as string;
    // 两锚点各有一对 gte/lte，且各成 15 分钟窗口
    for (const part of [
      "schedule_start_at.gte.",
      "schedule_start_at.lte.",
      "schedule_end_at.gte.",
      "schedule_end_at.lte.",
    ]) {
      expect(or.match(new RegExp(part.replaceAll(".", "\\."), "g"))).toHaveLength(1);
    }
    const times = [...or.matchAll(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g)].map((m) =>
      Date.parse(m[0])
    );
    expect(times).toHaveLength(4);
    expect(times[1] - times[0]).toBe(15 * 60_000);
    expect(times[3] - times[2]).toBe(15 * 60_000);
    expect(times[2] - times[0]).toBe(0); // 两锚点共用同一 now
  });

  it("返回归一化后的 {task_id,title,anchor} 数组", async () => {
    // 路由内以真实 now 划窗，fixture 必须相对当前时刻构造
    const inWindow = new Date(Date.now() + 5 * 60_000).toISOString();
    rowsFixture = [
      {
        id: "task-1",
        title: "提交周报",
        status: "todo",
        schedule_start_at: inWindow,
        schedule_end_at: null,
        user_id: "someone",
      },
    ];
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body).toEqual([{ task_id: "task-1", title: "提交周报", anchor: "start" }]);
  });

  it("查询错误经 serverError 返回 5xx 通用文案", async () => {
    queryError = { code: "42501", message: "permission denied" };
    const { status, body } = await call();
    expect(status).toBeGreaterThanOrEqual(400);
    expect(body.error).toBeTruthy();
    expect(body.error).not.toContain("permission denied");
  });
});
