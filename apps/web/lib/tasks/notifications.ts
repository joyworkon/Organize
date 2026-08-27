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

/** 即时「已过期」提醒的宽限期：到期后 15 分钟内不再当场弹过期通知 */
export const OVERDUE_IMMEDIATE_GRACE_MS = 15 * 60 * 1000;

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
    // 宽限期内的"过期"不当场报：任务刚创建/刚到期几分钟就查看列表时，
    // 立刻弹「已过期」只会是对用户自己刚做的操作的回声
    const overdue = dueMs <= nowMs - OVERDUE_IMMEDIATE_GRACE_MS;
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

export interface OverdueSummary {
  count: number;
  title: string;
  body: string;
}

interface OverdueCheckTask {
  title: string;
  due_date: string | null;
  all_day?: boolean | null;
  status: string;
  deleted_at?: string | null;
}

/**
 * 每日逾期摘要：统计"昨天及以前"到期且未完成的任务。
 * 当天到期的不计入——当天到期由 buildDueReminders 的即时提醒覆盖，
 * 避免同一任务在页面加载时重复打扰。无逾期时返回 null。
 */
export function buildOverdueSummary(tasks: OverdueCheckTask[], now: Date): OverdueSummary | null {
  const overdue = tasks.filter((task) => {
    if (task.status === "done" || task.status === "cancelled" || task.deleted_at) return false;
    const due = effectiveDueDate(task);
    return due !== null && due.getTime() < now.getTime() && !isSameDay(due, now);
  });
  if (overdue.length === 0) return null;
  const titles = overdue.slice(0, 3).map((task) => task.title).join("、");
  return {
    count: overdue.length,
    title: `你有 ${overdue.length} 个任务已逾期`,
    body: overdue.length <= 3 ? titles : `${titles} 等 ${overdue.length} 个任务`,
  };
}
