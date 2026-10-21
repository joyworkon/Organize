import { describe, expect, it } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import { calendarDayKey } from "./calendar-agenda";
import { layoutDayTimedEvents, layoutDayTimedEventsWithOverflow, MAX_TIMED_LANES } from "./calendar-timed-layout";

const day = new Date(2026, 9, 19);
const at = (minutes: number) => new Date(2026, 9, 19, 0, minutes).toISOString();
function task(id: string, start = 540, end = 600): TaskWithTags {
  return {
    id, user_id: "u", title: id, description: null, status: "todo",
    priority: "medium", category: "work", due_date: null,
    schedule_start_at: at(start), schedule_end_at: at(end), all_day: false,
    estimated_minutes: null, actual_minutes: null, reading_item_id: null, note_id: null,
    is_pinned: false, sort_order: 0, completed_at: null, created_at: at(0), updated_at: at(0),
  };
}
const overlapping = (count: number, start = 540, end = 600) => Array.from({ length: count }, (_, i) => task(`t${i}`, start, end));

describe("定时重叠簇折叠", () => {
  it.each([0, 1, 2, 3])("%i 条：不折叠，原有布局和宽度不变", (count) => {
    const tasks = overlapping(count);
    expect(layoutDayTimedEventsWithOverflow(tasks, day)).toEqual({
      visible: layoutDayTimedEvents(tasks, day), overflowClusters: [],
    });
  });

  it.each([4, 5, 8])("%i 条：最多三列，+N 按隐藏任务计数，弹层包含全部", (count) => {
    const tasks = overlapping(count);
    const result = layoutDayTimedEventsWithOverflow(tasks, day);
    expect(result.visible.map((event) => [event.task.id, event.lane, event.lanes])).toEqual([
      ["t0", 0, MAX_TIMED_LANES], ["t1", 1, MAX_TIMED_LANES], ["t2", 2, MAX_TIMED_LANES],
    ]);
    expect(result.overflowClusters).toEqual([{
      dayKey: calendarDayKey(day), startMin: 540, endMin: 600, hiddenCount: count - 3, tasks,
    }]);
  });

  it("传递重叠属于同一簇，相接边界分簇；隐藏数按任务而非泳道数", () => {
    const tasks = [task("anchor", 540, 720), task("a", 540, 600), task("b", 540, 600),
      task("hidden1", 540, 600), task("c", 600, 660), task("d", 600, 660), task("hidden2", 600, 660),
      ...overlapping(4, 720, 780)];
    const result = layoutDayTimedEventsWithOverflow(tasks, day);
    expect(result.overflowClusters.map(({ startMin, endMin, hiddenCount, tasks }) => [startMin, endMin, hiddenCount, tasks.length]))
      .toEqual([[540, 720, 2, 7], [720, 780, 1, 4]]);
    expect(result.visible).toHaveLength(8);
  });

  it("createdId 交换整条泳道，只影响所属簇，恢复后正常折叠；不改输入", () => {
    const tasks = [task("anchor", 540, 720), task("a", 540, 600), task("b", 540, 600),
      task("hidden1", 540, 600), task("c", 600, 660), task("d", 600, 660), task("created", 600, 660),
      ...overlapping(4, 720, 780)];
    const before = structuredClone(tasks);
    const normal = layoutDayTimedEventsWithOverflow(tasks, day);
    const promoted = layoutDayTimedEventsWithOverflow(tasks, day, { createdId: "created" });
    expect(promoted.visible.find((event) => event.task.id === "created")?.lane).toBe(2);
    expect(promoted.visible.find((event) => event.task.id === "hidden1")?.lane).toBe(2);
    expect(promoted.visible.some((event) => ["b", "d"].includes(event.task.id))).toBe(false);
    expect(promoted.visible.filter((event) => event.startMin >= 720)).toEqual(normal.visible.filter((event) => event.startMin >= 720));
    expect(promoted.overflowClusters).toEqual(normal.overflowClusters);
    for (const a of promoted.visible) for (const b of promoted.visible) {
      if (a !== b && a.lane === b.lane) expect(a.endMin <= b.startMin || b.endMin <= a.startMin).toBe(true);
    }
    expect(layoutDayTimedEventsWithOverflow(tasks, day)).toEqual(normal);
    expect(tasks).toEqual(before);
  });

  it("缺失或本来可见的 createdId 不改变布局；允许自定义上限", () => {
    const tasks = overlapping(4);
    const normal = layoutDayTimedEventsWithOverflow(tasks, day);
    expect(layoutDayTimedEventsWithOverflow(tasks, day, { createdId: "absent" })).toEqual(normal);
    expect(layoutDayTimedEventsWithOverflow(tasks, day, { createdId: "t0" })).toEqual(normal);
    const result = layoutDayTimedEventsWithOverflow(tasks, day, { maxLanes: 2, createdId: "t3" });
    expect(result.visible.map((event) => [event.task.id, event.lane, event.lanes])).toEqual([["t0", 0, 2], ["t3", 1, 2]]);
    expect(result.overflowClusters[0].hiddenCount).toBe(2);
  });

  it("全天、跨天、其他日期不进入簇；次日零点仍是当天 24:00", () => {
    const tasks = [task("late", 1380, 1440), task("next", 1440, 1500),
      task("span", 540, 1500), { ...task("all"), all_day: true }, { ...task("undated"), schedule_start_at: null }];
    const result = layoutDayTimedEventsWithOverflow(tasks, day);
    expect(result.visible.map((event) => [event.task.id, event.startMin, event.endMin])).toEqual([["late", 1380, 1440]]);
    expect(result.overflowClusters).toEqual([]);
  });
});
