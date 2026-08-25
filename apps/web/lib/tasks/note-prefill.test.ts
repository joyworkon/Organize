import { describe, expect, it } from "vitest";
import { buildTaskNoteContent } from "./note-prefill";

describe("buildTaskNoteContent", () => {
  it("无描述无子任务时返回默认空文档", () => {
    expect(buildTaskNoteContent({ description: null }, [])).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("描述按行拆成多个段落，忽略空行", () => {
    const doc = buildTaskNoteContent({ description: "第一行\n\n  第二行  \n" }, []);
    expect(doc.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "第一行" }] },
      { type: "paragraph", content: [{ type: "text", text: "第二行" }] },
    ]);
  });

  it("子任务转成 taskList，保留完成状态", () => {
    const doc = buildTaskNoteContent({ description: null }, [
      { content: "买牛奶", is_completed: true },
      { content: "买面包", is_completed: false },
    ]);
    expect(doc.content).toHaveLength(1);
    const list = doc.content[0];
    expect(list.type).toBe("taskList");
    expect(list.content).toEqual([
      {
        type: "taskItem",
        attrs: { checked: true },
        content: [{ type: "paragraph", content: [{ type: "text", text: "买牛奶" }] }],
      },
      {
        type: "taskItem",
        attrs: { checked: false },
        content: [{ type: "paragraph", content: [{ type: "text", text: "买面包" }] }],
      },
    ]);
  });

  it("描述和子任务同时存在时段落在前、清单在后", () => {
    const doc = buildTaskNoteContent({ description: "备注" }, [
      { content: "步骤一", is_completed: false },
    ]);
    expect(doc.content.map((node) => node.type)).toEqual(["paragraph", "taskList"]);
  });
});
