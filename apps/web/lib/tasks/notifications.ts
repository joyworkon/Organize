/**
 * 到期提醒的纯函数部分（use-notifications 的逻辑内核，抽出便于测试）。
 *
 * 修复的三类误报/失效：
 * 1. setTimeout 上限 2^31-1ms（≈24.8 天），超过会溢出立即触发 →
 *    远期任务在页面加载瞬间误报"已到期"。buildDueReminders 只负责
 *    算时间，调用方对 delay > MAX_TIMEOUT_MS 的提醒跳过排程。
 * 2. 幂等 key 原来只含任务 id，任务改期后旧 key 已消费，新日期永远
 *    不再提醒 → key 内含到期时刻（dueMs），改期自然重新武装；
 *    pruneNotifiedKeys 负责清掉删除/完成/改期留下的旧 key。
 * 3. 全天任务归一到本地 00:00，早晨打开页面即报"已过期" →
 *    effectiveDueDate 把全天任务按当天 23:59:59 计。
 */

/** setTimeout 的最大安全延迟（2^31-1 ms ≈ 24.8 天），超过会溢出立即触发 */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export interface DueReminder {
  /** 幂等 key：任务 id + 到期时刻 + 类型（改期后自然失效旧 key） */
  key: string;
  /** 触发时间戳（ms）；<= now 表示应立即触发 */
  fireAt: number;
  title: string;
  body: string;
}

interface RemindableTask {
  id: string;
  title: string;
  due_date: string | null;
  all_day?: boolean | null;
  status: string;
}

/** 全天任务按当天结束（23:59:59.999 本地）计到期，避免早晨误报"已过期" */
export function effectiveDueDate(task: { due_date: string | null; all_day?: boolean | null }): Date | null {
  if (!task.due_date) return null;
  const date = new Date(task.due_date);
  if (Number.isNaN(date.getTime())) return null;
  if (task.all_day) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }
  return date;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * 为单个任务生成提醒计划（不过滤已通知状态，幂等判断由调用方做）。
 */
export function buildDueReminders(task: RemindableTask, now: Date): DueReminder[] {
  const due = effectiveDueDate(task);
  if (!due || task.status === "done" || task.status === "cancelled") return [];

  const dueMs = due.getTime();
  const nowMs = now.getTime();
  const keyBase = `${task.id}:${dueMs}`;
  const reminders: DueReminder[] = [];

  if (isSameDay(now, due)) {
    const overdue = dueMs <= nowMs;
    reminders.push({
      key: `${keyBase}:today`,
      fireAt: nowMs,
      title: overdue ? "任务已过期" : "任务到期提醒",
      body: overdue ? `任务已过期：${task.title}` : `任务即将到期：${task.title}`,
    });
  }

  const fifteenMinutesBefore = dueMs - 15 * 60 * 1000;
  if (fifteenMinutesBefore > nowMs) {
    reminders.push({
      key: `${keyBase}:15min`,
      fireAt: fifteenMinutesBefore,
      title: "任务即将到期",
      body: `任务即将到期：${task.title}（15分钟后）`,
    });
  }

  if (dueMs > nowMs) {
    reminders.push({
      key: `${keyBase}:due`,
      fireAt: dueMs,
      title: "任务到期提醒",
      body: `任务已到期：${task.title}`,
    });
  }

  return reminders;
}

/**
 * 清理幂等 key 集合：只保留"任务仍存在且到期时刻未变"的 key。
 * 删除/完成/改期的旧 key 全部移除，避免 localStorage 无限增长
 * 以及改期后不再提醒的问题。
 *
 * @param keys 已消费的幂等 key
 * @param current 当前可提醒任务的 taskId → 到期时刻（ms）
 */
export function pruneNotifiedKeys(keys: Set<string>, current: Map<string, number>): Set<string> {
  const kept = new Set<string>();
  keys.forEach((key) => {
    const [taskId, dueMs] = key.split(":");
    if (current.get(taskId) === Number(dueMs)) kept.add(key);
  });
  return kept;
}
