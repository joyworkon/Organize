import { describe, expect, it } from "vitest";
import {
  buildTaskNoteContent,
  resolveTaskNoteChecklistLoad,
  TASK_NOTE_CHECKLIST_LOAD_ERROR_MESSAGE,
} from "./note-prefill";

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

describe("resolveTaskNoteChecklistLoad", () => {
  it("成功带行时原样透传 rows", () => {
    const rows = [
      { content: "买牛奶", is_completed: true },
      { content: "买面包", is_completed: false },
    ];
    expect(resolveTaskNoteChecklistLoad({ data: rows, error: null })).toEqual({ ok: true, rows });
  });

  it("成功空数组仍 ok：任务本来就没有子任务时照常建便签", () => {
    expect(resolveTaskNoteChecklistLoad({ data: [], error: null })).toEqual({ ok: true, rows: [] });
  });

  it("有 error 时失败，message 为常量", () => {
    expect(resolveTaskNoteChecklistLoad({ data: null, error: new Error("network") })).toEqual({
      ok: false,
      message: TASK_NOTE_CHECKLIST_LOAD_ERROR_MESSAGE,
    });
  });

  it("data 为 null 且无 error 也算失败", () => {
    expect(resolveTaskNoteChecklistLoad({ data: null, error: null })).toEqual({
      ok: false,
      message: TASK_NOTE_CHECKLIST_LOAD_ERROR_MESSAGE,
    });
  });

  it("data 为 undefined 且无 error 同样失败", () => {
    expect(resolveTaskNoteChecklistLoad({ data: undefined, error: null })).toEqual({
      ok: false,
      message: TASK_NOTE_CHECKLIST_LOAD_ERROR_MESSAGE,
    });
  });
});
