/**
 * 跨标签页单实例执行（P1-03）：离线队列回放同一时刻只应有一个标签页在做——
 * 两个标签页并发回放同一条队列会重复应用/互相踩掉 remaining。
 *
 * 浏览器端用 Web Locks API（navigator.locks，Chrome 69+/Safari 15.4+/Firefox 96+）：
 * 第二个标签页的回放会排队等锁，拿到锁后先重读队列（前一个大概率已清空）。
 * API 不可用（旧浏览器/非安全上下文/测试环境）时直接执行——单标签页是常见情形，
 * 双标签页并发回放在该环境下退化为既有行为（已知限制，见 BLOCKED.md）。
 */

export interface WebLocksLike {
  request<R>(name: string, callback: () => Promise<R>): Promise<R>;
}

export function getWebLocks(): WebLocksLike | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as { locks?: WebLocksLike }).locks;
  return locks ?? null;
}

export const TASK_REPLAY_LOCK_NAME = "organize:task-replay:v1";

export async function runSingleInstance<T>(
  locks: WebLocksLike | null,
  lockName: string,
  fn: () => Promise<T>
): Promise<T> {
  if (!locks) return fn();
  return locks.request(lockName, fn);
}
