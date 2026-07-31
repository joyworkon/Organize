/**
 * task-item-linked —— 扩展官方 TaskItem，增加 taskId 属性（G2 第一步）。
 *
 * taskId 指向 tasks 表的行 id；空表示 legacy 项（尚未激活成任务）。
 * 本扩展只加属性 + HTML 序列化，不改任何渲染/勾选行为；
 * 双向同步逻辑在 G3 验收后才启用（见 docs/g0-protocol.md）。
 *
 * 默认行为：taskId 为空时与官方 TaskItem 完全等价（向后兼容历史笔记）。
 */
import TaskItem from "@tiptap/extension-task-item";

export const TaskItemLinked = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      taskId: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-task-id") || null,
        renderHTML: (attrs) => (attrs.taskId ? { "data-task-id": String(attrs.taskId) } : {}),
      },
    };
  },
});

export default TaskItemLinked;
