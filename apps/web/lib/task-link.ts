/**
 * 任务↔笔记双链的纯函数工具（G2）。
 * 从 page.tsx 抽出，便于单测。
 */

export interface TaskMutation {
  task_id: string;
  title: string;
  status: string;
}

/**
 * 从笔记 content 递归提取所有「绑定块」（有 taskId 的 taskItem），
 * 转成 save_note_with_tasks RPC 所需的 task_mutations。
 * 标题取 taskItem 内首段纯文本；checked=true → status="done"。
 * G0 §3 状态机：此函数只读 content，不改动它。
 */
export function extractTaskMutations(doc: Record<string, unknown> | null): {
  mutations: TaskMutation[];
  revisions: Record<string, number>;
} {
  if (!doc) return { mutations: [], revisions: {} };
  const mutations: TaskMutation[] = [];
  const revisions: Record<string, number> = {};
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "taskItem" && node.attrs?.taskId) {
      const tid = String(node.attrs.taskId);
      // 标题：内联首段纯文本
      let title = "";
      const content = Array.isArray(node.content) ? node.content : [];
      for (const child of content) {
        if (child?.type === "paragraph" && Array.isArray(child.content)) {
          title = child.content.map((t: any) => (typeof t.text === "string" ? t.text : "")).join("");
          break;
        }
      }
      mutations.push({
        task_id: tid,
        title: title || "未命名任务",
        status: node.attrs.checked === true ? "done" : "todo",
      });
      revisions[tid] = 0;
      return; // taskItem 内部段落已处理，不再下钻
    }
    const children = Array.isArray(node.content) ? node.content : [];
    for (const c of children) walk(c);
  };
  walk(doc);
  return { mutations, revisions };
}
