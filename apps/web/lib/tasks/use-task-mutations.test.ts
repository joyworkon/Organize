// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import { applyTaskUpdate } from "@/lib/tasks/atomic-update";
import { requestNextRecurringTask } from "@/lib/tasks/recurring";
import { readTaskOps } from "@/lib/offline/task-queue";
import { appEvents } from "@/lib/plugin/events";
import { toast } from "@/hooks/use-toast";
import { useTaskMutations } from "./use-task-mutations";

const online = vi.hoisted(() => ({ current: true }));

vi.mock("@/lib/offline/network", () => ({ isOnline: () => online.current }));
vi.mock("@/lib/tasks/atomic-update", () => ({ applyTaskUpdate: vi.fn() }));
vi.mock("@/lib/tasks/recurring", () => ({ requestNextRecurringTask: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(() => ({ dismiss: vi.fn() })) }));
vi.mock("@/lib/plugin/events", () => ({ appEvents: { emit: vi.fn() } }));

function task(patch: Partial<TaskWithTags> = {}): TaskWithTags {
  return {
    id: "t1",
    user_id: "u1",
    title: "旧标题",
    description: null,
    status: "todo",
    priority: "medium",
    category: "work",
    due_date: "2026-10-19T01:00:00.000Z",
    estimated_minutes: null,
    actual_minutes: null,
    reading_item_id: null,
    note_id: null,
    is_pinned: false,
    sort_order: 0,
    completed_at: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    sync_version: 3,
    schedule_start_at: "2026-10-19T01:00:00.000Z",
    schedule_end_at: "2026-10-19T02:00:00.000Z",
    tags: [],
    ...patch,
  };
}

function renderMutations(initial: TaskWithTags[] = [task()]) {
  const seen = { tasks: initial };
  const refreshTasks = vi.fn(async () => undefined);
  const pushDeadLetter = vi.fn(() => true);
  const setPendingOps = vi.fn();
  const onDeleted = vi.fn();
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const supabase = { rpc };
  const api: { current: ReturnType<typeof useTaskMutations> } = {
    current: null as unknown as ReturnType<typeof useTaskMutations>,
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  function Harness() {
    const [tasks, setTasks] = useState(initial);
    seen.tasks = tasks;
    api.current = useTaskMutations({
      supabase: supabase as never,
      userId: "u1",
      tasks,
      setTasks,
      refreshTasks,
      onDeleted,
      setPendingOps,
      pushDeadLetter,
    });
    return null;
  }
  act(() => { root.render(createElement(Harness)); });
  return {
    seen,
    api,
    refreshTasks,
    pushDeadLetter,
    setPendingOps,
    onDeleted,
    rpc,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useTaskMutations", () => {
  beforeEach(() => {
    online.current = true;
    localStorage.clear();
    vi.mocked(applyTaskUpdate).mockReset();
    vi.mocked(requestNextRecurringTask).mockReset();
    vi.mocked(requestNextRecurringTask).mockResolvedValue({ status: "none" });
    vi.mocked(toast).mockClear();
    vi.mocked(appEvents.emit).mockClear();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("applied：乐观改标题，带回 sync_version，并带上期望版本", async () => {
    vi.mocked(applyTaskUpdate).mockResolvedValue({ status: "applied", syncVersion: 4 });
    const events: Event[] = [];
    const listener = (event: Event) => events.push(event);
    window.addEventListener("organize:tasks-changed", listener);
    const view = renderMutations();
    await act(async () => {
      await view.api.current.updateTask("t1", { title: "新标题" });
    });
    expect(view.seen.tasks[0]).toMatchObject({ title: "新标题", sync_version: 4 });
    expect(applyTaskUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "t1",
      { title: "新标题" },
      3,
      expect.any(String),
    );
    expect(events.map((event) => event.type)).toEqual(["organize:tasks-changed"]);
    window.removeEventListener("organize:tasks-changed", listener);
    view.unmount();
  });

  it("改期补上 due_date，失败时回滚到更新前的那一行", async () => {
    let resolveUpdate: (value: { status: "error"; error: Error }) => void = () => {};
    vi.mocked(applyTaskUpdate).mockReturnValue(new Promise((resolve) => {
      resolveUpdate = resolve;
    }) as ReturnType<typeof applyTaskUpdate>);
    const view = renderMutations();
    const pending = view.api.current.updateTask("t1", {
      schedule_start_at: "2026-10-20T01:00:00.000Z",
      schedule_end_at: "2026-10-20T03:00:00.000Z",
    });
    await flush();
    expect(view.seen.tasks[0]).toMatchObject({
      schedule_start_at: "2026-10-20T01:00:00.000Z",
      due_date: "2026-10-20T03:00:00.000Z",
    });
    await act(async () => {
      resolveUpdate({ status: "error", error: new Error("db down") });
      await pending;
    });
    expect(view.seen.tasks[0]).toMatchObject({
      title: "旧标题",
      schedule_start_at: "2026-10-19T01:00:00.000Z",
      due_date: "2026-10-19T01:00:00.000Z",
    });
    expect(toast).toHaveBeenCalledWith({ title: "保存失败，已回滚", variant: "destructive" });
    view.unmount();
  });

  it("conflict：回滚、刷新，并把本次更改写入 dead-letter", async () => {
    vi.mocked(applyTaskUpdate).mockResolvedValue({ status: "conflict", currentSyncVersion: 9 });
    const view = renderMutations();
    await act(async () => {
      await view.api.current.updateTask("t1", { title: "冲突标题" });
    });
    expect(view.seen.tasks[0].title).toBe("旧标题");
    expect(view.refreshTasks).toHaveBeenCalledWith({ silent: true });
    expect(view.pushDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "update",
        id: "t1",
        patch: { title: "冲突标题" },
        expected_sync_version: 3,
      }),
      expect.objectContaining({ code: "TASK_SYNC_CONFLICT" }),
    );
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "任务已在其他设备被修改，本次更改已存入待处理列表" }));
    view.unmount();
  });

  it("offline：不打 RPC，乐观结果留在列表里并入队", async () => {
    online.current = false;
    const view = renderMutations();
    await act(async () => {
      await view.api.current.updateTask("t1", { title: "离线标题" });
    });
    expect(applyTaskUpdate).not.toHaveBeenCalled();
    expect(view.seen.tasks[0].title).toBe("离线标题");
    expect(readTaskOps(localStorage, "u1")).toEqual([
      expect.objectContaining({
        type: "update",
        id: "t1",
        patch: { title: "离线标题" },
        expected_sync_version: 3,
      }),
    ]);
    expect(view.setPendingOps).toHaveBeenCalledWith(1);
    expect(toast).toHaveBeenCalledWith({ title: "已离线保存，联网后自动同步" });
    view.unmount();
  });

  it("网络错误按离线入队，不回滚", async () => {
    vi.mocked(applyTaskUpdate).mockResolvedValue({ status: "error", error: { message: "Failed to fetch" } });
    const view = renderMutations();
    await act(async () => {
      await view.api.current.updateTask("t1", { priority: "high" });
    });
    expect(view.seen.tasks[0].priority).toBe("high");
    expect(readTaskOps(localStorage, "u1")[0]).toMatchObject({
      type: "update",
      patch: { priority: "high" },
      expected_sync_version: 3,
    });
    expect(toast).toHaveBeenCalledWith({ title: "网络异常，已离线保存，联网后自动同步" });
    view.unmount();
  });

  it("同任务连续更新使用上一笔返回的 sync_version", async () => {
    vi.mocked(applyTaskUpdate)
      .mockResolvedValueOnce({ status: "applied", syncVersion: 4 })
      .mockResolvedValueOnce({ status: "applied", syncVersion: 5 });
    const view = renderMutations();
    await act(async () => {
      await view.api.current.updateTask("t1", { title: "第一笔" });
    });
    await act(async () => {
      await view.api.current.updateTask("t1", { title: "第二笔" });
    });
    expect(vi.mocked(applyTaskUpdate).mock.calls[1]?.[3]).toBe(4);
    expect(view.seen.tasks[0]).toMatchObject({ title: "第二笔", sync_version: 5 });
    view.unmount();
  });

  it("标记完成后请求下一次重复任务", async () => {
    vi.mocked(applyTaskUpdate).mockResolvedValue({ status: "applied", syncVersion: 4 });
    vi.mocked(requestNextRecurringTask).mockResolvedValue({ status: "created", id: "t2" });
    const view = renderMutations();
    await act(async () => {
      await view.api.current.updateTask("t1", { status: "done", completed_at: "2026-10-20T00:00:00.000Z" });
    });
    expect(requestNextRecurringTask).toHaveBeenCalledWith(expect.anything(), "t1");
    expect(appEvents.emit).toHaveBeenCalledWith("task:completed", { taskId: "t1", title: "旧标题" });
    expect(toast).toHaveBeenCalledWith({ title: "已生成下一次重复任务" });
    view.unmount();
  });

  it("在线删除走 mutate_trash，并请页面清掉选中任务", async () => {
    const view = renderMutations();
    await act(async () => {
      await view.api.current.deleteTask("t1");
    });
    expect(view.rpc).toHaveBeenCalledWith("mutate_trash", {
      p_action: "soft_delete",
      p_resource_type: "task",
      p_ids: ["t1"],
    });
    expect(view.onDeleted).toHaveBeenCalled();
    expect(view.refreshTasks).toHaveBeenCalledWith({ silent: true });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "任务已移入垃圾箱" }));
    view.unmount();
  });
});
