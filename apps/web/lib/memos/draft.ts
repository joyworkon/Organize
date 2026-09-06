/**
 * F02：速记本机草稿（按 用户 + 入口 隔离的 localStorage 持久化）。
 *
 * - key 带 userId：退出账号后不会展示另一账号的草稿
 * - 入口（主页面 memos / 刘海 notch / 编辑中的某条速记）各自独立 key
 * - 纯函数 + StorageLike 注入，便于在 node 环境测试
 *
 * 写入策略：输入变化即写（速记 ≤5000 字，同步写开销可忽略）；
 * 清除策略：只在「确认保存的版本 == 当前输入」时清除（调用方比对），
 * 保存期间继续输入的新内容不会被迟到的成功响应清掉。
 */

export const MEMO_DRAFT_KEY_PREFIX = "organize:memo-draft:v1:";

export function memoDraftKey(userId: string, entry: string): string {
  return `${MEMO_DRAFT_KEY_PREFIX}${userId}:${entry}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadMemoDraft(storage: StorageLike, userId: string, entry: string): string {
  try {
    return storage.getItem(memoDraftKey(userId, entry)) ?? "";
  } catch {
    return "";
  }
}

export function saveMemoDraft(
  storage: StorageLike,
  userId: string,
  entry: string,
  content: string
): void {
  try {
    if (content) storage.setItem(memoDraftKey(userId, entry), content);
    else storage.removeItem(memoDraftKey(userId, entry));
  } catch {
    // 存储满/不可用：草稿降级为仅内存，不打断输入
  }
}

export function clearMemoDraft(storage: StorageLike, userId: string, entry: string): void {
  saveMemoDraft(storage, userId, entry, "");
}
