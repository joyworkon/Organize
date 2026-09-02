import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * TaskItem 勾选守卫（Track B 072）：启用后拦截**本端**对 taskItem checked 的变更，
 * 匿名编辑者不能改任务勾选（任务属主与 sync_version 归属主账号，匿名改动无法落账）；
 * 远端同步事务（y-sync$ meta）照常应用，别人的勾选状态仍能看到。
 *
 * 实现：对比事务前后文档里 taskItem 的 checked 序列（文档序）——输入文字、改样式
 * 都不动这个序列，只有勾选会改；结构增删（序列长度变化）放行。
 */
export interface TaskItemToggleGuardOptions {
  enabled: boolean;
}

function checkedSequence(doc: ProseMirrorNode): boolean[] {
  const seq: boolean[] = [];
  doc.descendants((node) => {
    if (node.type.name === "taskItem") seq.push(!!node.attrs.checked);
  });
  return seq;
}

export const TaskItemToggleGuard = Extension.create<TaskItemToggleGuardOptions>({
  name: "taskItemToggleGuard",

  addOptions() {
    return { enabled: false };
  },

  addProseMirrorPlugins() {
    if (!this.options.enabled) {
      return [];
    }
    return [
      new Plugin({
        key: new PluginKey("taskItemToggleGuard"),
        filterTransaction: (transaction, state) => {
          if (!transaction.docChanged) return true;
          // 远端推送的勾选变更要正常显示，只拦本端发起的事务
          if (transaction.getMeta("y-sync$") !== undefined) return true;
          const before = checkedSequence(state.doc);
          const after = checkedSequence(transaction.doc);
          if (before.length !== after.length) return true;
          for (let i = 0; i < before.length; i++) {
            if (before[i] !== after[i]) {
              return false;
            }
          }
          return true;
        },
      }),
    ];
  },
});
