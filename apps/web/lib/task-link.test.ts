import { describe, it, expect } from "vitest";
import { extractTaskMutations } from "./task-link";

// 构造一个 taskItem 节点
const taskItem = (taskId: string | null, checked: boolean, text: string) => ({
  type: "taskItem",
  attrs: { id: "blk_" + (taskId || "none"), checked, ...(taskId ? { taskId } : {}) },
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const doc = (...items: any[]) => ({ type: "doc", content: [{ type: "taskList", content: items }] });

describe("extractTaskMutations", () => {
  it("勾选的绑定块 → status=done", () => {
    const { mutations } = extractTaskMutations(doc(taskItem("t1", true, "买菜")));
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({ task_id: "t1", title: "买菜", status: "done" });
  });

  it("未勾选的绑定块 → status=todo", () => {
    const { mutations } = extractTaskMutations(doc(taskItem("t1", false, "买菜")));
    expect(mutations[0]).toMatchObject({ task_id: "t1", status: "todo" });
  });

  it("多块：分别按勾选状态提取", () => {
    const { mutations } = extractTaskMutations(
      doc(taskItem("t1", true, "已完成"), taskItem("t2", false, "未完成"))
    );
    expect(mutations).toHaveLength(2);
    expect(mutations.find((m) => m.task_id === "t1")?.status).toBe("done");
    expect(mutations.find((m) => m.task_id === "t2")?.status).toBe("todo");
  });

  it("legacy 项（无 taskId）跳过，不进 mutations", () => {
    const { mutations } = extractTaskMutations(doc(taskItem(null, false, "老的待办")));
    expect(mutations).toHaveLength(0);
  });

  it("空标题 → '未命名任务'", () => {
    const { mutations } = extractTaskMutations(
      doc({ type: "taskItem", attrs: { id: "b1", checked: false, taskId: "t1" }, content: [{ type: "paragraph" }] })
    );
    expect(mutations[0].title).toBe("未命名任务");
  });

  it("空 doc / null → 空 mutations", () => {
    expect(extractTaskMutations(null).mutations).toEqual([]);
    expect(extractTaskMutations({ type: "doc", content: [] }).mutations).toEqual([]);
  });

  it("revisions 包含所有绑定块的 taskId（值 0，待调用方填）", () => {
    const { revisions } = extractTaskMutations(doc(taskItem("t1", false, "a"), taskItem("t2", true, "b")));
    expect(Object.keys(revisions)).toEqual(["t1", "t2"]);
    expect(revisions.t1).toBe(0);
  });
});
