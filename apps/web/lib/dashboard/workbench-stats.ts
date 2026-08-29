/**
 * 工作台（今日视图）统计的纯函数（P1-02）。
 *
 * 全部基于持久化数据（tasks.due_date / status / completed_at）计算，不读
 * localStorage：同一份数据在任何设备、任何刷新后结果一致。时钟由调用方
 * 注入（now），测试用固定时钟冻结语义。
 */

export interface WorkbenchTaskLike {
  due_date: string | null;
  status: string;
  completed_at: string | null;
}

export interface TodayCompletion {
  /** 今日窗口内的计划任务数（含已完成项） */
  planned: number;
  /** 窗口内已完成数（= 今日完成的任务） */
  completed: number;
  /** 完成率百分比（四舍五入；窗口为空时为 0） */
  rate: number;
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * 今日完成率——分母与分子基于**同一时间窗口**（今天这个日历日）：
 * - 窗口内的「计划」：未取消且（今日到期 或 逾期未完成）的任务，
 *   加上**今日完成**的任务（不论到期日——今天完成任何事都是今天的活动；
 *   历史天完成的任务不计入今天的计划）。
 * - 「完成」= 窗口内 status=done 的任务（即今日完成的）。
 * - rate = planned === 0 ? 0 : round(completed / planned × 100)。
 *
 * 例：4 项计划、2 项完成 → 50%。修复前分母把已完成项过滤掉，完成率恒为 0。
 */
export function computeTodayCompletion<T extends WorkbenchTaskLike>(
  tasks: T[],
  now: Date
): TodayCompletion {
  const todayKey = localDayKey(now);
  let planned = 0;
  let completed = 0;

  for (const task of tasks) {
    if (task.status === "cancelled") continue;

    if (task.status === "done") {
      // 只有今天完成的才属于今天的窗口
      if (task.completed_at && localDayKey(new Date(task.completed_at)) === todayKey) {
        planned += 1;
        completed += 1;
      }
      continue;
    }

    // 未完成任务：今日到期或逾期（到期日非空且 <= 今天）算今天的计划
    if (task.due_date) {
      const due = new Date(task.due_date);
      if (localDayKey(due) === todayKey || due.getTime() <= now.getTime()) {
        // 到期时刻早于 now 即「今日或逾期」；同日不同时刻也命中（按日历日）
        planned += 1;
      }
    }
  }

  return {
    planned,
    completed,
    rate: planned === 0 ? 0 : Math.round((completed / planned) * 100),
  };
}

/**
 * 连续完成天数（streak）——基于持久化的 tasks.completed_at，按本地日历日：
 * - 活动日 = 当天完成 ≥ 1 个任务。
 * - 从今天往回数连续活动日；今天还没有完成时从昨天起数（当天尚未结束，不断签）。
 * 修复前只读 localStorage 的 organize-streak（且从不写入），刷新/换设备即失真。
 */
export function computeTaskStreak(completedAtList: Array<string | null | undefined>, now: Date): number {
  const activeDays = new Set<string>();
  for (const completedAt of completedAtList) {
    if (!completedAt) continue;
    activeDays.add(localDayKey(new Date(completedAt)));
  }

  const dayMs = 24 * 60 * 60 * 1000;
  // 从「今天」或「今天无活动时的昨天」开始往回数
  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!activeDays.has(localDayKey(cursor))) {
    cursor = new Date(cursor.getTime() - dayMs);
    if (!activeDays.has(localDayKey(cursor))) return 0;
  }

  let streak = 0;
  while (activeDays.has(localDayKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - dayMs);
  }
  return streak;
}
