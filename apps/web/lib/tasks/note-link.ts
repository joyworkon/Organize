/**
 * 「打开便签」防重入场券：创建请求在途期间同任务的再次点击直接忽略。
 * 服务端对 tasks.note_id 没有唯一约束，双击竞态会各自 insert 一条笔记，
 * 后写者覆盖前者的关联，前者成为无入口的孤儿便签。
 */
const pendingTaskNoteCreations = new Set<string>();

/** 领取该任务的便签创建权；已被占用（在途）返回 false */
export function claimTaskNoteCreation(taskId: string): boolean {
  if (pendingTaskNoteCreations.has(taskId)) return false;
  pendingTaskNoteCreations.add(taskId);
  return true;
}

export function releaseTaskNoteCreation(taskId: string): void {
  pendingTaskNoteCreations.delete(taskId);
}
