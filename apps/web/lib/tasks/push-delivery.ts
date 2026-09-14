/**
 * Web Push 投递的重试决策纯函数（/api/cron/task-reminders 的判断内核，
 * 抽出便于单测；语义与迁移 039 的 claim 约定对齐）。
 */

/** 推送端点 404/410 表示订阅永久失效（用户撤销/订阅过期），应停订而非重试 */
export function isPermanentlyGonePushStatus(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410;
}

/**
 * 第 attemptCount 次失败后的重试等待（分钟）：指数退避 2^n，封顶 60 分钟。
 * attempt_count < 6 的投递才会被 claim 领取（039），因此最长约 1+2+4+8+16+32
 * 分钟内重试 5 次后放弃，投递停留在 failed 态并保留 error 供日志定位。
 */
export function nextRetryDelayMinutes(attemptCount: number): number {
  return Math.min(60, 2 ** attemptCount);
}
