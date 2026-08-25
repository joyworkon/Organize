import type { Task, TaskChecklist } from "@organize/shared";

interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
}

export interface TipTapDoc {
  type: "doc";
  content: TipTapNode[];
}

/**
 * 从任务生成便签初始内容：描述按行拆成段落，子任务清单转成编辑器 taskList。
 * 两者都没有时返回空文档（单个空段落），与新建笔记的默认内容一致。
 */
export function buildTaskNoteContent(
  task: Pick<Task, "description">,
  checklists: Pick<TaskChecklist, "content" | "is_completed">[]
): TipTapDoc {
  const blocks: TipTapNode[] = [];
  const description = task.description?.trim();
  if (description) {
    for (const line of description.split(/\n+/).map((row) => row.trim()).filter(Boolean)) {
      blocks.push({ type: "paragraph", content: [{ type: "text", text: line }] });
    }
  }
  if (checklists.length > 0) {
    blocks.push({
      type: "taskList",
      content: checklists.map((item) => ({
        type: "taskItem",
        attrs: { checked: item.is_completed },
        content: [{ type: "paragraph", content: [{ type: "text", text: item.content }] }],
      })),
    });
  }
  if (blocks.length === 0) blocks.push({ type: "paragraph" });
  return { type: "doc", content: blocks };
}
