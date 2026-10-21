import { describe, expect, it } from "vitest";
import type { TaskWithTags } from "@organize/shared";
import {
  MAX_SPAN_LANES,
  allDayRowTasksOnDay,
  isAllDayRowTask,
  isSingleDayTimedSpan,
  layoutSpanSegments,
} from "./calendar-allday-layout";

function mkTask(id: string, start: Date, end: Date | null, extra: Partial<TaskWithTags> = {}): TaskWithTags {
  return {
    id, user_id: "u1", title: `task-${id}`, description: null, status: "todo",
    priority: "medium", category: "work", due_date: start.toISOString(),
    estimated_minutes: null, actual_minutes: null, reading_item_id: null,
    note_id: null, is_pinned: false, sort_order: 0, completed_at: null,
    created_at: start.toISOString(), updated_at: start.toISOString(),
    schedule_start_at: start.toISOString(),
    schedule_end_at: end ? end.toISOString() : null,
    ...extra,
  };
}

// 2026-10-19 是周一；该周 10/19（一）~ 10/25（日）
const week = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 19 + i));
const weekdayWeek = week.slice(0, 5); // 隐藏周末（周一~周五）
const D = (day: number, hour = 9, minute = 0) => new Date(2026, 9, day, hour, minute);

describe("isSingleDayTimedSpan / isAllDayRowTask", () => {
  it("同日定时是单日；全天与跨天定时都进全天行", () => {
    expect(isSingleDayTimedSpan(D(20, 9), D(20, 11))).toBe(true);
    // 结束恰在次日 00:00 = 当日 24:00 右开，仍是单日
    expect(isSingleDayTimedSpan(D(20, 22), new Date(2026, 9, 21, 0, 0, 0))).toBe(true);
    expect(isSingleDayTimedSpan(D(20, 22), D(21, 2))).toBe(false);

    expect(isAllDayRowTask(mkTask("a", D(20), D(20), { all_day: true }), D(20), D(20))).toBe(true);
    expect(isAllDayRowTask(mkTask("b", D(20, 9), D(20, 11)), D(20, 9), D(20, 11))).toBe(false);
    expect(isAllDayRowTask(mkTask("c", D(19, 22), D(21, 2)), D(19, 22), D(21, 2))).toBe(true);
  });
});

describe("layoutSpanSegments（allDayRowOnly：时间网格全天行）", () => {
  it("跨天任务整周只产生一条连续段，跨列正确、两端闭合", () => {
    const { segments } = layoutSpanSegments([mkTask("t1", D(20), D(22))], week, { allDayRowOnly: true });
    expect(segments).toHaveLength(1);
    expect(segments[0].startCol).toBe(1); // 周二
    expect(segments[0].endCol).toBe(3);   // 周四
    expect(segments[0].continuesBefore).toBe(false);
    expect(segments[0].continuesAfter).toBe(false);
  });

  it("单日定时任务被排除，全天单日任务保留", () => {
    const { segments } = layoutSpanSegments(
      [mkTask("timed", D(20, 9), D(20, 11)), mkTask("allday", D(20), D(20), { all_day: true })],
      week,
      { allDayRowOnly: true }
    );
    expect(segments.map((seg) => seg.task.id)).toEqual(["allday"]);
  });

  it("跨周边界：两端夹到可见周界并标记不闭合", () => {
    const { segments } = layoutSpanSegments([mkTask("t1", D(15), D(28))], week, { allDayRowOnly: true });
    expect(segments).toHaveLength(1);
    expect(segments[0].startCol).toBe(0);
    expect(segments[0].endCol).toBe(6);
    expect(segments[0].continuesBefore).toBe(true);
    expect(segments[0].continuesAfter).toBe(true);
  });

  it("单列日视图：跨天任务一条全宽段，延续端按前后日开合", () => {
    const friday = new Date(2026, 9, 23);
    const spanning = mkTask("t1", D(22), D(24));
    const { segments } = layoutSpanSegments([spanning], [friday], { allDayRowOnly: true });
    expect(segments).toHaveLength(1);
    expect(segments[0].startCol).toBe(0);
    expect(segments[0].endCol).toBe(0);
    expect(segments[0].continuesBefore).toBe(true);
    expect(segments[0].continuesAfter).toBe(true);

    const endsToday = mkTask("t2", D(22), D(23));
    const endSegs = layoutSpanSegments([endsToday], [friday], { allDayRowOnly: true }).segments;
    expect(endSegs[0].continuesBefore).toBe(true);
    expect(endSegs[0].continuesAfter).toBe(false);
  });

  it("隐藏周末按 5 列切段；只在周末的任务不可见", () => {
    // 周三 ~ 周六：可见周三~周五，右端延续（周六在可见范围外）
    const wedSat = layoutSpanSegments([mkTask("t1", D(21), D(24))], weekdayWeek, { allDayRowOnly: true }).segments;
    expect(wedSat[0].startCol).toBe(2);
    expect(wedSat[0].endCol).toBe(4);
    expect(wedSat[0].continuesAfter).toBe(true);
    // 周六单日任务：起点列 5 超出可见列，整条不可见
    const satOnly = layoutSpanSegments([mkTask("t2", D(24), D(24), { all_day: true })], weekdayWeek, { allDayRowOnly: true });
    expect(satOnly.segments).toHaveLength(0);
    expect(satOnly.hiddenByCol).toEqual([0, 0, 0, 0, 0]);
  });

  it("重叠任务贪心分泳道，超过上限的按列折叠为 +N", () => {
    const tasks = [
      mkTask("t1", D(20), D(22)),
      mkTask("t2", D(21), D(21), { all_day: true }),
      mkTask("t3", D(21, 8), D(21, 9)), // 单日定时：不进全天行
      mkTask("t4", D(21), D(23)),
      mkTask("t5", D(21), D(21), { all_day: true }),
    ];
    const { segments, hiddenByCol } = layoutSpanSegments(tasks, week, { allDayRowOnly: true });
    // t1 起点最早占 lane0；t2/t4/t5 同日起，按跨度降序 t4 > t2 = t5 依次 lane1/2/3
    expect(segments.map((seg) => seg.task.id).sort()).toEqual(["t1", "t2", "t4"]);
    expect(segments.find((seg) => seg.task.id === "t5")).toBeUndefined();
    expect(hiddenByCol).toEqual([0, 0, 1, 0, 0, 0, 0]); // t5 只盖周三，折叠在周三列
  });

  it("createdId 拥挤时换进可见泳道（新建反馈不藏进 +N）", () => {
    const tasks = Array.from({ length: 5 }, (_, i) => mkTask(String(i), D(20), D(20), { all_day: true }));
    const normal = layoutSpanSegments(tasks, week, { allDayRowOnly: true });
    expect(normal.segments.map((seg) => seg.task.id)).not.toContain("4");
    const feedback = layoutSpanSegments(tasks, week, { allDayRowOnly: true, createdId: "4" });
    expect(feedback.segments.map((seg) => seg.task.id)).toContain("4");
    expect(feedback.hiddenByCol).toEqual(normal.hiddenByCol);
  });

  it("与月视图口径（allDayRowOnly=false）互不干扰：单日定时只在月视图出现", () => {
    const tasks = [mkTask("timed", D(20, 9), D(20, 11))];
    expect(layoutSpanSegments(tasks, week).segments).toHaveLength(1);
    expect(layoutSpanSegments(tasks, week, { allDayRowOnly: true }).segments).toHaveLength(0);
  });
});

describe("allDayRowTasksOnDay（+N 弹层列表）", () => {
  it("返回覆盖当天的全天行任务（含折叠段），按开始时刻稳定排序", () => {
    const tasks = [
      mkTask("span", D(19), D(22)),
      mkTask("later", D(20, 14), D(20, 15)),
      mkTask("allday", D(20), D(20), { all_day: true, sort_order: 5 }),
      mkTask("early", D(20), D(20), { all_day: true, sort_order: 1 }),
    ];
    expect(allDayRowTasksOnDay(tasks, new Date(2026, 9, 20)).map((task) => task.id))
      .toEqual(["span", "early", "allday"]);
    expect(allDayRowTasksOnDay(tasks, new Date(2026, 9, 23))).toEqual([]);
  });

  it("该列「可见段 + 折叠数」与列表条数一致", () => {
    const tasks = Array.from({ length: 5 }, (_, i) => mkTask(String(i), D(20), D(20), { all_day: true }));
    const { segments, hiddenByCol } = layoutSpanSegments(tasks, week, { allDayRowOnly: true });
    const visibleOnCol = segments.filter((seg) => seg.startCol <= 1 && seg.endCol >= 1).length;
    expect(allDayRowTasksOnDay(tasks, new Date(2026, 9, 20))).toHaveLength(visibleOnCol + hiddenByCol[1]);
    expect(visibleOnCol + hiddenByCol[1]).toBe(5);
    expect(MAX_SPAN_LANES).toBe(3);
  });
});
