import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTaskUpdate } from "./atomic-update";
import { createTaskQueueWriter } from "./task-queue-writer";

vi.mock("./atomic-update", () => ({ applyTaskUpdate: vi.fn() }));

const meta = { expectedSyncVersion: 1, mutationId: "offline-op-1" };

function mockSupabase(rpcImpl: () => Promise<{ data: unknown; error: unknown }>) {
  const rpc = vi.fn(rpcImpl);
  return { supabase: { rpc } as never, rpc };
}

describe("task queue writer 补生成重复任务下一次实例", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(applyTaskUpdate).mockResolvedValue({ status: "applied", syncVersion: 2 });
  });

  it("完成已落库但补生成 RPC 报错时回调报告错误，op 仍成功", async () => {
    const { supabase, rpc } = mockSupabase(async () => ({
      data: null,
      error: { message: "生成实例失败" },
    }));
    const onRecurringNextError = vi.fn();
    const writer = createTaskQueueWriter(supabase, { onRecurringNextError });

    expect(await writer.updateTask("task-1", { status: "done" }, meta)).toEqual({ error: null });
    expect(applyTaskUpdate).toHaveBeenCalledWith(supabase, "task-1", { status: "done" }, 1, "offline-op-1");
    expect(rpc).toHaveBeenCalledWith("complete_recurring_task", { p_task_id: "task-1" });
    expect(onRecurringNextError).toHaveBeenCalledExactlyOnceWith("task-1", "生成实例失败");
  });

  it.each(["next-task-id", null])("RPC 返回 %s 时不报告错误", async (data) => {
    const { supabase, rpc } = mockSupabase(async () => ({ data, error: null }));
    const onRecurringNextError = vi.fn();
    const writer = createTaskQueueWriter(supabase, { onRecurringNextError });

    expect(await writer.updateTask("task-1", { status: "done" }, meta)).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith("complete_recurring_task", { p_task_id: "task-1" });
    expect(onRecurringNextError).not.toHaveBeenCalled();
  });

  it("already_applied 不再次调用补生成 RPC", async () => {
    vi.mocked(applyTaskUpdate).mockResolvedValue({ status: "already_applied" });
    const { supabase, rpc } = mockSupabase(async () => ({ data: null, error: null }));
    const onRecurringNextError = vi.fn();
    const writer = createTaskQueueWriter(supabase, { onRecurringNextError });

    expect(await writer.updateTask("task-1", { status: "done" }, meta)).toEqual({ error: null });
    expect(rpc).not.toHaveBeenCalled();
    expect(onRecurringNextError).not.toHaveBeenCalled();
  });

  it("不传 options 且补生成 RPC 报错时不抛错，op 仍成功", async () => {
    const { supabase } = mockSupabase(async () => ({
      data: null,
      error: { message: "生成实例失败" },
    }));

    await expect(createTaskQueueWriter(supabase).updateTask("task-1", { status: "done" }, meta))
      .resolves.toEqual({ error: null });
  });
});
