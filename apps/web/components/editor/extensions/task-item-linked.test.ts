// @vitest-environment jsdom
// TaskItemLinked + extractTaskMutations 全链路集成测试
// 覆盖：勾选不丢 taskId、勾选→mutations 产出 done、legacy 跳过、插入新 taskItem 无 id 无 taskId
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import { TaskItemLinked } from "./task-item-linked";
import { extractTaskMutations } from "@/lib/task-link";

function createEditor(content: any) {
  return new Editor({
    extensions: [StarterKit, TaskList, TaskItemLinked.configure({ nested: true })],
    content,
  });
}

const TID = "11111111-1111-4111-8111-111111111111";

/** 模拟官方 TaskItem 勾选：遍历收集 pos，再 setNodeMarkup 改 checked（不在遍历回调里改 doc）。 */
function toggleFirstTaskItem(editor: Editor, checked: boolean) {
  let targetPos: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (targetPos === null && node.type.name === "taskItem") {
      targetPos = pos;
      return false;
    }
    return true;
  });
  if (targetPos === null) return;
  const node = editor.state.doc.nodeAt(targetPos)!;
  const tr = editor.state.tr.setNodeMarkup(targetPos, undefined, { ...node.attrs, checked });
  editor.view.dispatch(tr);
}

describe("TaskItemLinked 全链路", () => {
  it("TaskItemLinked 注册后 taskItem 支持 taskId 属性", () => {
    const editor = createEditor({
      type: "doc",
      content: [{
        type: "taskList",
        content: [{
          type: "taskItem",
          attrs: { id: "blk1", checked: false, taskId: TID },
          content: [{ type: "paragraph", content: [{ type: "text", text: "买菜" }] }],
        }],
      }],
    });
    const json = editor.getJSON();
    const item = (json.content as any[]).flatMap((n) => n.content || []).find((n) => n.type === "taskItem");
    expect(item.attrs.taskId).toBe(TID);
    expect(item.attrs.checked).toBe(false);
    editor.destroy();
  });

  it("勾选 taskItem：checked 变 true 且 taskId 保留（不丢）", () => {
    const editor = createEditor({
      type: "doc",
      content: [{
        type: "taskList",
        content: [{
          type: "taskItem",
          attrs: { id: "blk1", checked: false, taskId: TID },
          content: [{ type: "paragraph", content: [{ type: "text", text: "买菜" }] }],
        }],
      }],
    });
    toggleFirstTaskItem(editor, true);
    const item = (editor.getJSON().content as any[]).flatMap((n) => n.content || []).find((n) => n.type === "taskItem");
    expect(item.attrs.checked).toBe(true);
    expect(item.attrs.taskId).toBe(TID); // 关键：勾选不能丢 taskId
    editor.destroy();
  });

  it("勾选后的 JSON → extractTaskMutations 产出 status=done", () => {
    const editor = createEditor({
      type: "doc",
      content: [{
        type: "taskList",
        content: [{
          type: "taskItem",
          attrs: { id: "blk1", checked: false, taskId: TID },
          content: [{ type: "paragraph", content: [{ type: "text", text: "买菜" }] }],
        }],
      }],
    });
    toggleFirstTaskItem(editor, true);
    const { mutations } = extractTaskMutations(editor.getJSON());
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({ task_id: TID, title: "买菜", status: "done" });
    editor.destroy();
  });

  it("legacy taskItem（无 taskId）勾选后不进 mutations（不会被当成绑定块同步）", () => {
    const editor = createEditor({
      type: "doc",
      content: [{
        type: "taskList",
        content: [{
          type: "taskItem",
          attrs: { id: "blk_legacy", checked: false },
          content: [{ type: "paragraph", content: [{ type: "text", text: "老待办" }] }],
        }],
      }],
    });
    toggleFirstTaskItem(editor, true);
    const { mutations } = extractTaskMutations(editor.getJSON());
    expect(mutations).toHaveLength(0);
    editor.destroy();
  });

  it("斜杠菜单新插入的 taskItem（无 id 无 taskId）→ extractTaskMutations 跳过（#61 场景）", () => {
    // 模拟 block-commands.ts 插入的结构：attrs 只有 {checked:false}，无 id 无 taskId
    const editor = createEditor({
      type: "doc",
      content: [{
        type: "taskList",
        content: [{
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph", content: [{ type: "text", text: "新待办" }] }],
        }],
      }],
    });
    const { mutations } = extractTaskMutations(editor.getJSON());
    expect(mutations).toHaveLength(0); // 无 taskId，不该进同步
    editor.destroy();
  });

  it("HTML 序列化：taskId 持久化到 data-task-id 并能解析回来", () => {
    const editor = createEditor(
      "<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-task-id=\"" + TID + "\" data-checked=\"false\"><p>买菜</p></li></ul>"
    );
    const item = (editor.getJSON().content as any[]).flatMap((n) => n.content || []).find((n) => n.type === "taskItem");
    expect(item?.attrs?.taskId).toBe(TID);
    editor.destroy();
  });
});
