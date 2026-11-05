// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskRepository } from "./repository";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/trash/client", () => ({ mutateTrash: vi.fn() }));
vi.mock("@/lib/tasks/atomic-update", () => ({ applyTaskUpdate: vi.fn() }));
vi.mock("@/lib/offline/note-sync", () => ({ isNetworkSaveError: vi.fn(() => false) }));
vi.mock("@/lib/offline/task-queue", () => ({
  enqueueTaskOp: vi.fn(),
  makeTaskUpdateOp: vi.fn(),
}));
vi.mock("@/lib/offline/task-dead-letter", () => ({ addTaskDeadLetterEntry: vi.fn() }));
vi.mock("@/lib/tasks/task-list-mutation", () => ({
  deleteTaskListRemote: vi.fn(),
  updateTaskListRemote: vi.fn(),
}));

function queryRows(table: string): unknown[] {
  if (table === "tasks") return [{ id: "t1", user_id: "u1", title: "任务甲" }];
  return [];
}

/** fetchAll 里 await 的查询链：builder 方法链式返回自身，await 落到预置响应 */
function makeQuery(data: unknown) {
  const response = { data, error: null };
  const promise = Promise.resolve(response);
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    is: () => builder,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return builder;
}

function renderRepository(initialEnabled?: boolean) {
  const api: { current: ReturnType<typeof useTaskRepository> } = {
    current: null as unknown as ReturnType<typeof useTaskRepository>,
  };
  let enabled = initialEnabled;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  // Harness 类型保持稳定，setEnabled 复用同一实例重渲染（模拟门开/关）
  function Harness() {
    api.current = useTaskRepository(enabled === undefined ? undefined : { enabled });
    return null;
  }
  act(() => {
    root.render(createElement(Harness));
  });
  return {
    api,
    setEnabled(next: boolean) {
      enabled = next;
      act(() => {
        root.render(createElement(Harness));
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

describe("useTaskRepository enabled 门控", () => {
  beforeEach(() => {
    mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } } });
    mocks.from.mockReset().mockImplementation((table: string) => makeQuery(queryRows(table)));
    mocks.rpc.mockReset().mockResolvedValue({ data: [] });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("默认自动拉取全量仓库（task-navigation-menu 等现有调用方合同不变）", async () => {
    const view = renderRepository();
    await flush();

    expect(mocks.getUser).toHaveBeenCalled();
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(
      expect.arrayContaining(["tasks", "task_lists", "task_tags", "tags"])
    );
    expect(mocks.rpc).toHaveBeenCalledWith("list_trashed_tasks");
    expect(view.api.current.tasks).toEqual([{ id: "t1", user_id: "u1", title: "任务甲", tags: [] }]);
    expect(view.api.current.loadError).toBeNull();
    expect(view.api.current.loading).toBe(false);
    view.unmount();
  });

  it("enabled=false 时不自动拉取，refetch 为 no-op", async () => {
    const view = renderRepository(false);
    await flush();

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(view.api.current.loading).toBe(false);
    await act(async () => {
      await view.api.current.refetch();
    });
    expect(mocks.from).not.toHaveBeenCalled();
    view.unmount();
  });

  it("enabled 从 false 变 true 后开始拉取（对应侧栏展开态恢复）", async () => {
    const view = renderRepository(false);
    await flush();
    expect(mocks.from).not.toHaveBeenCalled();

    view.setEnabled(true);
    await flush();

    expect(mocks.from.mock.calls.map(([table]) => table)).toContain("tasks");
    expect(view.api.current.tasks).toHaveLength(1);
    expect(view.api.current.loading).toBe(false);
    view.unmount();
  });

  it("enabled 从 true 变 false 后 refetch 不再触发查询", async () => {
    const view = renderRepository(true);
    await flush();
    const callsAfterEnabled = mocks.from.mock.calls.length;
    expect(callsAfterEnabled).toBeGreaterThan(0);

    view.setEnabled(false);
    await act(async () => {
      await view.api.current.refetch();
    });
    expect(mocks.from.mock.calls.length).toBe(callsAfterEnabled);
    view.unmount();
  });
});
