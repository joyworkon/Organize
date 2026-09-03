/**
 * /api/tasks/due-soon 的纯逻辑层：时间窗过滤条件与行归一化。
 * 桌面壳提醒轮询（components/desktop/reminder-poller.tsx）拉取未来
 * DUE_SOON_WINDOW_MINUTES 分钟内到期/开始的未完成任务，经系统通知兜底
 * （Web Push cron 之外的第二条投递路径，multi-platform-plan §3.2）。
 */

/** 提醒窗口：未来 N 分钟内到期/开始 */
export const DUE_SOON_WINDOW_MINUTES = 15;

/** 提醒锚点：与 task_reminders.anchor 语义一致（033） */
export type DueSoonAnchor = "start" | "end";

export interface DueSoonTask {
  task_id: string;
  title: string;
  anchor: DueSoonAnchor;
}

interface TaskScheduleRow {
  id?: unknown;
  title?: unknown;
  schedule_start_at?: unknown;
  schedule_end_at?: unknown;
}

/**
 * 构造 Supabase PostgREST .or() 过滤串：两个锚点各自落在
 * [from, to] 时间窗内（anchor=start → schedule_start_at，anchor=end → schedule_end_at）。
 */
export function buildDueSoonFilter(from: Date, to: Date): string {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  return [
    `and(schedule_start_at.gte.${fromIso},schedule_start_at.lte.${toIso})`,
    `and(schedule_end_at.gte.${fromIso},schedule_end_at.lte.${toIso})`,
  ].join(",");
}

/**
 * 行归一化：只输出 {task_id,title,anchor} 三字段；anchor 取命中窗口的
 * 锚点（start 优先），双锚点都命中窗口时产出两行（分别提醒开始与截止）。
 * 非法行（缺 id/title）静默丢弃。
 */
export function toDueSoonTasks(
  rows: TaskScheduleRow[],
  from: Date,
  to: Date
): DueSoonTask[] {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const result: DueSoonTask[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id) continue;
    if (typeof row.title !== "string" || !row.title) continue;
    const startMs = Date.parse(
      typeof row.schedule_start_at === "string" ? row.schedule_start_at : ""
    );
    const endMs = Date.parse(
      typeof row.schedule_end_at === "string" ? row.schedule_end_at : ""
    );
    if (Number.isFinite(startMs) && startMs >= fromMs && startMs <= toMs) {
      result.push({ task_id: row.id, title: row.title, anchor: "start" });
    }
    if (Number.isFinite(endMs) && endMs >= fromMs && endMs <= toMs) {
      result.push({ task_id: row.id, title: row.title, anchor: "end" });
    }
  }
  return result;
}
