// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { mutateTrash } from "./client";

const id = "10000000-0000-4000-8000-000000000002";

function okFetcher() {
  return vi.fn(async () => Response.json({ success: true, affected: 1 }));
}

describe("mutateTrash 变更事件广播", () => {
  it("删除笔记后广播 organize:notes-changed（侧栏树刷新，不留幽灵节点）", async () => {
    const listener = vi.fn();
    window.addEventListener("organize:notes-changed", listener);
    await mutateTrash("note", [id], "soft_delete", okFetcher());
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("organize:notes-changed", listener);
  });

  it("删除任务后广播 organize:tasks-changed", async () => {
    const listener = vi.fn();
    window.addEventListener("organize:tasks-changed", listener);
    await mutateTrash("task", [id], "soft_delete", okFetcher());
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("organize:tasks-changed", listener);
  });

  it("恢复操作同样广播（恢复后侧栏应立即出现该笔记）", async () => {
    const listener = vi.fn();
    window.addEventListener("organize:notes-changed", listener);
    await mutateTrash("note", [id], "restore", okFetcher());
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("organize:notes-changed", listener);
  });

  it("无事件映射的资源类型（reading_item）不广播笔记/任务事件", async () => {
    const notesListener = vi.fn();
    const tasksListener = vi.fn();
    window.addEventListener("organize:notes-changed", notesListener);
    window.addEventListener("organize:tasks-changed", tasksListener);
    await mutateTrash("reading_item", [id], "soft_delete", okFetcher());
    expect(notesListener).not.toHaveBeenCalled();
    expect(tasksListener).not.toHaveBeenCalled();
    window.removeEventListener("organize:notes-changed", notesListener);
    window.removeEventListener("organize:tasks-changed", tasksListener);
  });

  it("操作失败（HTTP 错误）时不广播", async () => {
    const failing = vi.fn(async () =>
      Response.json({ error: "无权操作" }, { status: 403 })
    );
    const listener = vi.fn();
    window.addEventListener("organize:notes-changed", listener);
    await expect(mutateTrash("note", [id], "soft_delete", failing)).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("organize:notes-changed", listener);
  });
});
