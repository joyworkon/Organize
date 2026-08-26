/**
 * 笔记保存的失败分类与重试策略（X1 离线同步协议，纯函数便于测试）：
 *
 * - 网络类错误：指数退避重试（1s 起步，60s 封顶），联网事件会立即触发一次重试；
 * - 冲突（409 语义）：不重试，交给冲突对话框（覆盖 / 保留 / 另存副本）；
 * - 其他服务端错误（4xx/5xx 非网络）：不重试，草稿保留在本地，提示用户。
 */

/** 最大自动重试次数（达到后停止自动重试，仍保留草稿与手动入口） */
export const MAX_SAVE_RETRIES = 10;

/** 退避基数与封顶（毫秒） */
export const RETRY_BASE_DELAY_MS = 1_000;
export const RETRY_MAX_DELAY_MS = 60_000;

/** 第 retries 次重试（从 0 计）的等待时长：1s, 2s, 4s, …, 封顶 60s */
export function nextRetryDelay(retries: number): number {
  if (!Number.isFinite(retries) || retries < 0) return RETRY_BASE_DELAY_MS;
  const delay = RETRY_BASE_DELAY_MS * 2 ** Math.floor(retries);
  return Math.min(delay, RETRY_MAX_DELAY_MS);
}

/**
 * 判断 RPC 错误是否属于「网络不可用」类（值得自动重试）。
 * PostgREST/fetch 网络失败通常没有 code，message 含 fetch/network；
 * 明确带 HTTP code 的（如 PGRST 业务错、4xx）不算网络错误。
 */
export function isNetworkSaveError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: unknown; message?: unknown };
  // 带 Postgres/PostgREST 错误码（如 23505 / PGRST116）的是服务端响应，不是断网
  if (typeof err.code === "string" && err.code.length > 0) return false;
  if (typeof err.message !== "string") return false;
  const message = err.message.toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("load failed") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("abort")
  );
}

/**
 * 一次保存失败后的下一步动作：
 * - retry：网络错误且未超上限 → 等待 nextRetryDelay 后重试
 * - wait-online：当前离线 → 不再定时重试，等 online 事件触发
 * - give-up：非网络错误或超上限 → 停止自动重试
 */
export type SaveFailureAction =
  | { type: "retry"; delayMs: number }
  | { type: "wait-online" }
  | { type: "give-up" };

export function planSaveFailure(input: {
  error: unknown;
  retries: number;
  online: boolean;
}): SaveFailureAction {
  if (!isNetworkSaveError(input.error)) return { type: "give-up" };
  if (!input.online) return { type: "wait-online" };
  if (input.retries >= MAX_SAVE_RETRIES) return { type: "give-up" };
  return { type: "retry", delayMs: nextRetryDelay(input.retries) };
}
