// @vitest-environment jsdom
/**
 * createQuickTask 语义冻结：轻量待办创建的四个出口（created / queued /
 * unauthenticated / failed）与「离线入队复用同一客户端 id」的幂等约定。
 * 刘海面板与任务工作台共用这条链路，回放语义变了要在这里先失配。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { createClient } from "@/lib/supabase/client";
import { readTaskOps, taskOpsCount, type PendingTaskCreate } from "@/lib/offline/task-queue";

const isOnlineMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/offline/network", () => ({ isOnline: isOnlineMock }));

import { createQuickTask, type QuickTaskCreateResult } from "./quick-create";

const USER_ID = "user-quick-create";

type SupabaseClient = ReturnType<typeof createClient>;

interface StubOptions {
  session?: { user: { id: string } } | null;
  insertError?: { message: string; code?: string } | null;
}

/**
 * 断言出口并收窄判别联合。注意 created 与 queued 共用一个联合臂
 * （status: "created" | "queued"），按 status 字面量 Extract 会得到 never，
 * 只能按结构字段收窄。
 */
function expectTaskResult(result: QuickTaskCreateResult, status: "created" | "queued") {
  expect(result.status).toBe(status);
  return result as Extract<QuickTaskCreateResult, { task: unknown }>;
}

function expectFailed(result: QuickTaskCreateResult) {
  expect(result.status).toBe("failed");
  return result as Extract<QuickTaskCreateResult, { message: string }>;
}

/** supabase-js 插入链路的最小 stub：只覆盖 createQuickTask 用到的 from().insert() */
function createStubClient(opts: StubOptions = {}) {
  const inserted: Record<string, unknown>[] = [];
  const session = opts.session === undefined ? { user: { id: USER_ID } } : opts.session;

  const client = {
    auth: {
      getSession: async () => ({ data: { session } }),
    },
    from: (table: string) => {
      if (table !== "tasks") throw new Error(`unexpected table: ${table}`);
      let payload: Record<string, unknown> | null = null;
      const builder = {
        insert: (next: Record<string, unknown>) => {
          payload = next;
          return builder;
        },
        then: (resolve: (v: unknown) => void) =>
          Promise.resolve().then(() => {
            if (opts.insertError) {
              resolve({ data: null, error: opts.insertError });
              return;
            }
            inserted.push(payload as Record<string, unknown>);
            resolve({ data: null, error: null });
          }),
      } as unknown as Record<string, unknown> & PromiseLike<unknown>;
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, inserted };
}

beforeEach(() => {
  isOnlineMock.mockReset();
  isOnlineMock.mockReturnValue(true);
  localStorage.clear();
});

describe("createQuickTask 在线创建", () => {
  it("写入 tasks 且载荷字段冻结，不入离线队列", async () => {
    const { client, inserted } = createStubClient();

    const created = expectTaskResult(
      await createQuickTask(client, {
        title: " 买牛奶 ",
        dueDate: "2026-09-02T16:00:00.000Z",
        listId: "list-1",
      }),
      "created"
    );

    expect(inserted).toHaveLength(1);
    expect(Object.keys(inserted[0]).sort()).toEqual(
      ["category", "due_date", "id", "list_id", "priority", "status", "title", "user_id"].sort()
    );
    expect(inserted[0]).toEqual({
      id: created.task.id,
      user_id: USER_ID,
      title: "买牛奶",
      status: "todo",
      priority: "medium",
      category: "work",
      list_id: "list-1",
      due_date: "2026-09-02T16:00:00.000Z",
    });
    expect(taskOpsCount(localStorage, USER_ID)).toBe(0);
  });

  it("返回的 task 用客户端生成的 uuid，id 与写入载荷一致", async () => {
    const { client, inserted } = createStubClient();

    const created = expectTaskResult(
      await createQuickTask(client, { title: "写周报" }),
      "created"
    );

    expect(created.task.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted[0].id).toBe(created.task.id);
    expect(created.task.status).toBe("todo");
    expect(created.task.due_date).toBeNull();
  });
});

describe("createQuickTask 离线降级", () => {
  it("系统离线 → queued：不入网、入队且载荷 id 与返回 task 一致（回放幂等）", async () => {
    isOnlineMock.mockReturnValue(false);
    const { client, inserted } = createStubClient();

    const queued = expectTaskResult(
      await createQuickTask(client, { title: "断网记一笔" }),
      "queued"
    );

    expect(queued.persisted).toBe(true);
    expect(inserted).toHaveLength(0);
    const ops = readTaskOps(localStorage, USER_ID) as PendingTaskCreate[];
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("create");
    expect(ops[0].task).toEqual({
      id: queued.task.id,
      user_id: USER_ID,
      title: "断网记一笔",
      status: "todo",
      priority: "medium",
      category: "work",
      list_id: null,
      due_date: null,
    });
  });

  it("在线但请求断网（无错误码的 fetch 失败）→ queued 入队", async () => {
    const { client, inserted } = createStubClient({
      insertError: { message: "Failed to fetch" },
    });

    const queued = expectTaskResult(
      await createQuickTask(client, { title: "服务端不可达" }),
      "queued"
    );

    expect(queued.task.title).toBe("服务端不可达");
    expect(inserted).toHaveLength(0);
    expect(taskOpsCount(localStorage, USER_ID)).toBe(1);
  });
});

describe("createQuickTask 失败不假成功", () => {
  it("服务端错误（带错误码）→ failed 并透传消息，不入队", async () => {
    const { client } = createStubClient({
      insertError: { code: "42501", message: "permission denied for table tasks" },
    });

    const failed = expectFailed(await createQuickTask(client, { title: "越权写入" }));

    expect(failed.message).toBe("permission denied for table tasks");
    expect(taskOpsCount(localStorage, USER_ID)).toBe(0);
  });

  it("未登录 → unauthenticated，不写入不入队", async () => {
    const { client, inserted } = createStubClient({ session: null });

    expect(await createQuickTask(client, { title: "匿名待办" })).toEqual({
      status: "unauthenticated",
    });

    expect(inserted).toHaveLength(0);
    expect(taskOpsCount(localStorage, USER_ID)).toBe(0);
  });

  it("空白标题 → failed，且不触达客户端", async () => {
    const { client, inserted } = createStubClient();

    const failed = expectFailed(await createQuickTask(client, { title: "   " }));

    expect(failed.message).toBe("请输入待办内容");
    expect(inserted).toHaveLength(0);
    expect(localStorage.length).toBe(0);
  });
});
