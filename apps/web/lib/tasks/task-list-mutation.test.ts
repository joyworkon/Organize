import { describe, expect, it, vi } from "vitest";
import { deleteTaskListRemote, updateTaskListRemote } from "./task-list-mutation";

type Reply = { data?: unknown; error?: unknown };

/** 仿 supabase 链式调用：tasks.update().eq() 直接可 await；task_lists.update().eq().select() 可 await */
function fakeSupabase({
  moveTasks,
  mutateList,
}: {
  moveTasks: () => Promise<Reply>;
  mutateList: () => Promise<Reply>;
}) {
  const selectList = vi.fn(mutateList);
  const eqList = vi.fn(() => ({ select: selectList }));
  const updateListFn = vi.fn(() => ({ eq: eqList }));
  const eqTasks = vi.fn(moveTasks);
  const updateTasks = vi.fn(() => ({ eq: eqTasks }));
  const from = vi.fn((table: string) => ({
    update: table === "tasks" ? updateTasks : updateListFn,
  }));
  return {
    supabase: { from } as never,
    spies: { from, updateTasks, eqTasks, updateListFn, eqList, selectList },
  };
}

describe("deleteTaskListRemote", () => {
  it("两步都成功时返回 ok", async () => {
    const { supabase, spies } = fakeSupabase({
      moveTasks: async () => ({ error: null }),
      mutateList: async () => ({ data: [{ id: "list-1" }], error: null }),
    });

    await expect(deleteTaskListRemote(supabase, "list-1")).resolves.toEqual({ ok: true });
    expect(spies.eqTasks).toHaveBeenCalledWith("list_id", "list-1");
    expect(spies.eqList).toHaveBeenCalledWith("id", "list-1");
    expect(spies.selectList).toHaveBeenCalledWith("id");
  });

  it("空清单（第一步 0 行、error=null）仍视为成功", async () => {
    const { supabase, spies } = fakeSupabase({
      moveTasks: async () => ({ data: null, error: null }),
      mutateList: async () => ({ data: [{ id: "list-1" }], error: null }),
    });

    await expect(deleteTaskListRemote(supabase, "list-1")).resolves.toEqual({ ok: true });
    expect(spies.selectList).toHaveBeenCalledOnce();
  });

  it("第一步返回 error 时报 move-tasks，且不再执行第二步", async () => {
    const { supabase, spies } = fakeSupabase({
      moveTasks: async () => ({ error: { message: "move boom" } }),
      mutateList: async () => ({ data: [{ id: "list-1" }], error: null }),
    });

    await expect(deleteTaskListRemote(supabase, "list-1")).resolves.toEqual({
      ok: false,
      stage: "move-tasks",
    });
    expect(spies.updateListFn).not.toHaveBeenCalled();
  });

  it("第一步抛异常时报 move-tasks，且不向外抛出", async () => {
    const { supabase, spies } = fakeSupabase({
      moveTasks: async () => {
        throw new Error("network down");
      },
      mutateList: async () => ({ data: [{ id: "list-1" }], error: null }),
    });

    await expect(deleteTaskListRemote(supabase, "list-1")).resolves.toEqual({
      ok: false,
      stage: "move-tasks",
    });
    expect(spies.updateListFn).not.toHaveBeenCalled();
  });

  it("第二步返回 error 时报 delete-list", async () => {
    const { supabase } = fakeSupabase({
      moveTasks: async () => ({ error: null }),
      mutateList: async () => ({ data: null, error: { message: "delete boom" } }),
    });

    await expect(deleteTaskListRemote(supabase, "list-1")).resolves.toEqual({
      ok: false,
      stage: "delete-list",
    });
  });

  it("第二步 0 行（RLS 拒绝、error=null）时报 delete-list", async () => {
    const { supabase } = fakeSupabase({
      moveTasks: async () => ({ error: null }),
      mutateList: async () => ({ data: [], error: null }),
    });

    await expect(deleteTaskListRemote(supabase, "list-1")).resolves.toEqual({
      ok: false,
      stage: "delete-list",
    });
  });

  it("第二步 data=null 且无 error 时报 delete-list", async () => {
    const { supabase } = fakeSupabase({
      moveTasks: async () => ({ error: null }),
      mutateList: async () => ({ data: null, error: null }),
    });

    await expect(deleteTaskListRemote(supabase, "list-1")).resolves.toEqual({
      ok: false,
      stage: "delete-list",
    });
  });

  it("第二步抛异常时报 delete-list，且不向外抛出", async () => {
    const { supabase } = fakeSupabase({
      moveTasks: async () => ({ error: null }),
      mutateList: async () => {
        throw new Error("network down");
      },
    });

    await expect(deleteTaskListRemote(supabase, "list-1")).resolves.toEqual({
      ok: false,
      stage: "delete-list",
    });
  });
});

describe("updateTaskListRemote", () => {
  it("成功时返回 ok", async () => {
    const { supabase, spies } = fakeSupabase({
      moveTasks: async () => ({ error: null }),
      mutateList: async () => ({ data: [{ id: "list-1" }], error: null }),
    });

    await expect(updateTaskListRemote(supabase, "list-1", { name: "新名字" })).resolves.toEqual({ ok: true });
    expect(spies.updateListFn).toHaveBeenCalledWith({ name: "新名字" });
    expect(spies.selectList).toHaveBeenCalledWith("id");
  });

  it("返回 error 时视为失败", async () => {
    const { supabase } = fakeSupabase({
      moveTasks: async () => ({ error: null }),
      mutateList: async () => ({ data: null, error: { message: "update boom" } }),
    });

    await expect(updateTaskListRemote(supabase, "list-1", { name: "x" })).resolves.toEqual({ ok: false });
  });

  it("0 行（RLS 拒绝、error=null）时视为失败", async () => {
    const { supabase } = fakeSupabase({
      moveTasks: async () => ({ error: null }),
      mutateList: async () => ({ data: [], error: null }),
    });

    await expect(updateTaskListRemote(supabase, "list-1", { name: "x" })).resolves.toEqual({ ok: false });
  });

  it("抛异常时视为失败，且不向外抛出", async () => {
    const { supabase } = fakeSupabase({
      moveTasks: async () => ({ error: null }),
      mutateList: async () => {
        throw new Error("network down");
      },
    });

    await expect(updateTaskListRemote(supabase, "list-1", { name: "x" })).resolves.toEqual({ ok: false });
  });
});
