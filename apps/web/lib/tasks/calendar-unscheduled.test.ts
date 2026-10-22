// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  compareUnscheduledTasks,
  filterUnscheduledTasks,
  isUnscheduledTask,
  loadUnscheduledTrayOpen,
  resolveMonthDropTarget,
  resolveTimeGridDropTarget,
  saveUnscheduledTrayOpen,
  scheduleChangeLabel,
  scheduleUndoSnapshot,
  unscheduledDropLabel,
  unscheduledDropPatch,
  unscheduledTrayStorageKey,
} from "@/lib/tasks/calendar-unscheduled";
import type { TaskWithTags } from "@organize/shared";

function makeTask(overrides: Partial<TaskWithTags> = {}): TaskWithTags {
  return {
    id: "task-1",
    user_id: "u1",
    title: "写周报",
    description: null,
    status: "todo",
    priority: "medium",
    category: "work",
    due_date: null,
    estimated_minutes: null,
    actual_minutes: null,
    reading_item_id: null,
    note_id: null,
    is_pinned: false,
    sort_order: 0,
    completed_at: null,
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
    schedule_start_at: null,
    schedule_end_at: null,
    deleted_at: null,
    recurrence_rule: null,
    tags: [],
    ...overrides,
  };
}

describe("isUnscheduledTask / filterUnscheduledTasks", () => {
  it("只留未删除、未完成、无排期且非重复的任务", () => {
    const tasks = [
      makeTask({ id: "ok" }),
      makeTask({ id: "done", status: "done" }),
      makeTask({ id: "cancelled", status: "cancelled" }),
      makeTask({ id: "deleted", deleted_at: "2026-10-20T00:00:00.000Z" }),
      makeTask({ id: "scheduled", schedule_start_at: "2026-10-24T02:00:00.000Z" }),
      makeTask({ id: "due", due_date: "2026-10-24T02:00:00.000Z" }),
      makeTask({ id: "recurring", recurrence_rule: { frequency: "weekly", interval: 1 } }),
    ];
    const filtered = filterUnscheduledTasks(tasks);
    expect(filtered.map((task) => task.id)).toEqual(["ok"]);
    expect(isUnscheduledTask(tasks[0])).toBe(true);
    expect(isUnscheduledTask(tasks[4])).toBe(false);
  });

  it("排序沿用工作台规则：置顶优先、sort_order 升序、创建时间倒序", () => {
    const tasks = [
      makeTask({ id: "b", created_at: "2026-10-02T00:00:00.000Z" }),
      makeTask({ id: "a", created_at: "2026-10-03T00:00:00.000Z" }),
      makeTask({ id: "pinned", is_pinned: true, created_at: "2026-09-01T00:00:00.000Z" }),
      makeTask({ id: "order-1", sort_order: 1 }),
      makeTask({ id: "order-0", sort_order: 0 }),
    ];
    expect(filterUnscheduledTasks(tasks).map((task) => task.id)).toEqual([
      "pinned",
      "a",
      "b",
      "order-0",
      "order-1",
    ]);
    // 同一字段比较的稳定返回
    expect(compareUnscheduledTasks(makeTask(), makeTask())).toBe(0);
  });

  it("按标题过滤（大小写不敏感、trim），空查询恢复全部", () => {
    const tasks = [
      makeTask({ id: "1", title: "写周报" }),
      makeTask({ id: "2", title: "Weekly Report" }),
    ];
    expect(filterUnscheduledTasks(tasks, " 周报 ").map((task) => task.id)).toEqual(["1"]);
    expect(filterUnscheduledTasks(tasks, "weekly").map((task) => task.id)).toEqual(["2"]);
    expect(filterUnscheduledTasks(tasks, "不存在")).toEqual([]);
    expect(filterUnscheduledTasks(tasks, "")).toHaveLength(2);
  });
});

describe("unscheduledDropPatch / unscheduledDropLabel", () => {
  it("全天落点：start 当日零点、end 置空、all_day=true、due_date 跟随", () => {
    const patch = unscheduledDropPatch({ zone: "all-day", date: new Date(2026, 9, 24, 15, 30) });
    expect(patch.schedule_start_at).toBe(new Date(2026, 9, 24).toISOString());
    expect(patch.schedule_end_at).toBeNull();
    expect(patch.due_date).toBe(new Date(2026, 9, 24).toISOString());
    expect(patch.all_day).toBe(true);
    expect(unscheduledDropLabel({ zone: "all-day", date: new Date(2026, 9, 24) })).toBe("已排到 10月24日");
  });

  it("定时落点：吸附槽位开始、默认 60 分钟、all_day=false", () => {
    const patch = unscheduledDropPatch({ zone: "timed", date: new Date(2026, 9, 24), slotMin: 14 * 60 });
    expect(patch.schedule_start_at).toBe(new Date(2026, 9, 24, 14, 0).toISOString());
    expect(patch.schedule_end_at).toBe(new Date(2026, 9, 24, 15, 0).toISOString());
    expect(patch.due_date).toBe(new Date(2026, 9, 24, 15, 0).toISOString());
    expect(patch.all_day).toBe(false);
    expect(unscheduledDropLabel({ zone: "timed", date: new Date(2026, 9, 24), slotMin: 14 * 60 })).toBe(
      "已排到 10月24日 14:00"
    );
  });
});

describe("scheduleUndoSnapshot / scheduleChangeLabel", () => {
  it("快照保留四个可撤销字段，空值归一为 null", () => {
    const task = makeTask({
      schedule_start_at: "2026-10-24T02:00:00.000Z",
      schedule_end_at: "2026-10-24T03:00:00.000Z",
      due_date: "2026-10-24T03:00:00.000Z",
      all_day: false,
    });
    expect(scheduleUndoSnapshot(task)).toEqual({
      schedule_start_at: "2026-10-24T02:00:00.000Z",
      schedule_end_at: "2026-10-24T03:00:00.000Z",
      due_date: "2026-10-24T03:00:00.000Z",
      all_day: false,
    });
    expect(scheduleUndoSnapshot(makeTask())).toEqual({
      schedule_start_at: null,
      schedule_end_at: null,
      due_date: null,
      all_day: false,
    });
  });

  it("all_day 翻转 → 转全天/转定时；清除 start → 从日历移除", () => {
    const timed = { schedule_start_at: "2026-10-24T02:00:00.000Z", schedule_end_at: "2026-10-24T03:00:00.000Z", all_day: false };
    expect(scheduleChangeLabel(timed, { ...timed, all_day: true })).toBe("已转为全天任务");
    const allDay = { schedule_start_at: "2026-10-24T00:00:00.000Z", schedule_end_at: null, all_day: true };
    expect(scheduleChangeLabel(allDay, { schedule_start_at: "2026-10-24T14:00:00.000Z", schedule_end_at: "2026-10-24T15:00:00.000Z", all_day: false })).toBe("已转为定时任务");
    expect(scheduleChangeLabel(timed, { schedule_start_at: null, schedule_end_at: null, all_day: false })).toBe("已从日历移除");
  });

  it("日期变化 → 已改期到（定时补时刻）；同日改时刻 / 只改时长 → 各自文案", () => {
    const timed = { schedule_start_at: new Date(2026, 9, 24, 9, 0).toISOString(), schedule_end_at: new Date(2026, 9, 24, 10, 0).toISOString(), all_day: false };
    expect(scheduleChangeLabel(timed, {
      schedule_start_at: new Date(2026, 9, 25, 9, 0).toISOString(),
      schedule_end_at: new Date(2026, 9, 25, 10, 0).toISOString(),
      all_day: false,
    })).toBe("已改期到 10月25日 09:00");
    expect(scheduleChangeLabel(timed, {
      schedule_start_at: new Date(2026, 9, 24, 14, 0).toISOString(),
      schedule_end_at: new Date(2026, 9, 24, 15, 0).toISOString(),
      all_day: false,
    })).toBe("已改期到 10月24日 14:00");
    expect(scheduleChangeLabel(timed, {
      schedule_start_at: timed.schedule_start_at,
      schedule_end_at: new Date(2026, 9, 24, 12, 0).toISOString(),
      all_day: false,
    })).toBe("已调整时长");
    const allDay = { schedule_start_at: new Date(2026, 9, 24).toISOString(), schedule_end_at: null, all_day: true };
    expect(scheduleChangeLabel(allDay, { schedule_start_at: new Date(2026, 9, 25).toISOString(), schedule_end_at: null, all_day: true })).toBe("已改期到 10月25日");
    // 无可见变化不弹 toast
    expect(scheduleChangeLabel(timed, timed)).toBeNull();
  });

  it("原来未排期（before 无 start）→ 已排到目标日", () => {
    expect(
      scheduleChangeLabel({ schedule_start_at: null, schedule_end_at: null, all_day: false }, {
        schedule_start_at: new Date(2026, 9, 24).toISOString(),
        all_day: true,
      })
    ).toBe("已排到 10月24日");
  });
});

describe("resolveMonthDropTarget", () => {
  const weeks = [
    [new Date(2026, 9, 19), new Date(2026, 9, 20), new Date(2026, 9, 21), new Date(2026, 9, 22), new Date(2026, 9, 23), new Date(2026, 9, 24), new Date(2026, 9, 25)],
    [new Date(2026, 9, 26), new Date(2026, 9, 27), new Date(2026, 9, 28), new Date(2026, 9, 29), new Date(2026, 9, 30), new Date(2026, 10, 1), new Date(2026, 10, 2)],
  ];
  const gridRect = new DOMRect(100, 200, 700, 240);
  const rowRects = [new DOMRect(100, 200, 700, 120), new DOMRect(100, 320, 700, 120)];

  it("按周行与列换算目标日", () => {
    expect(resolveMonthDropTarget({ gridRect, rowRects, weeks, colCount: 7, clientX: 100, clientY: 260 })).toEqual(weeks[0][0]);
    expect(resolveMonthDropTarget({ gridRect, rowRects, weeks, colCount: 7, clientX: 500, clientY: 260 })).toEqual(weeks[0][4]);
    expect(resolveMonthDropTarget({ gridRect, rowRects, weeks, colCount: 7, clientX: 799, clientY: 340 })).toEqual(weeks[1][6]);
  });

  it("网格外（上下左右 / 零尺寸）返回 null", () => {
    const base = { gridRect, rowRects, weeks, colCount: 7 };
    expect(resolveMonthDropTarget({ ...base, clientX: 100, clientY: 199 })).toBeNull();
    expect(resolveMonthDropTarget({ ...base, clientX: 100, clientY: 441 })).toBeNull();
    expect(resolveMonthDropTarget({ ...base, clientX: 99, clientY: 260 })).toBeNull();
    expect(resolveMonthDropTarget({ ...base, clientX: 800, clientY: 260 })).toBeNull();
    expect(resolveMonthDropTarget({ ...base, gridRect: new DOMRect(0, 0, 0, 0), clientX: 100, clientY: 260 })).toBeNull();
    expect(resolveMonthDropTarget({ ...base, gridRect: null, clientX: 100, clientY: 260 })).toBeNull();
  });
});

describe("resolveTimeGridDropTarget", () => {
  const days = [new Date(2026, 9, 19), new Date(2026, 9, 20), new Date(2026, 9, 21), new Date(2026, 9, 22), new Date(2026, 9, 23), new Date(2026, 9, 24), new Date(2026, 9, 25)];
  const surfaceRect = new DOMRect(100, 50, 700, 1460);
  const allDayRect = new DOMRect(100, 100, 700, 60);
  const gridRect = new DOMRect(100, 160, 700, 1344);
  const base = { surfaceRect, allDayRect, gridRect, gutterWidth: 48, hourHeight: 56, days };

  it("全天行落点按列命中", () => {
    // 列宽 = (700-48)/7 ≈ 93.14；第 4 列中心 x = 148 + 3.5*93.14 ≈ 474
    expect(resolveTimeGridDropTarget({ ...base, clientX: 474, clientY: 130 })).toEqual({
      zone: "all-day",
      date: days[3],
    });
  });

  it("时间格落点按小时换算并吸附 30 分钟，含滚动偏移", () => {
    expect(resolveTimeGridDropTarget({ ...base, clientX: 474, clientY: 160 + 14 * 56 + 10 })).toEqual({
      zone: "timed",
      date: days[3],
      slotMin: 14 * 60,
    });
    // 14:10 → 就近吸附到 14:00（30 分钟粒度）
    expect(resolveTimeGridDropTarget({ ...base, clientX: 474, clientY: 160 + ((14 * 60 + 10) / 60) * 56 })).toEqual({
      zone: "timed",
      date: days[3],
      slotMin: 14 * 60,
    });
    // 滚出可视区 2 小时后，可视区顶部即内容 02:00
    expect(resolveTimeGridDropTarget({ ...base, gridScrollTop: 2 * 56, clientX: 474, clientY: 165 })).toEqual({
      zone: "timed",
      date: days[3],
      slotMin: 2 * 60,
    });
  });

  it("表头带（全天行之上）与表面外返回 null；末列贴边命中", () => {
    expect(resolveTimeGridDropTarget({ ...base, clientX: 474, clientY: 80 })).toBeNull();
    expect(resolveTimeGridDropTarget({ ...base, clientX: 474, clientY: 40 })).toBeNull();
    expect(resolveTimeGridDropTarget({ ...base, clientX: 800, clientY: 130 })).toBeNull();
    expect(resolveTimeGridDropTarget({ ...base, clientX: 799, clientY: 130 })).toEqual({
      zone: "all-day",
      date: days[6],
    });
    expect(resolveTimeGridDropTarget({ ...base, surfaceRect: new DOMRect(0, 0, 0, 0), clientX: 474, clientY: 130 })).toBeNull();
  });
});

describe("托盘开关持久化", () => {
  const memory = () => {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
  };

  it("默认关闭；按用户隔离读写；非法值回落关闭", () => {
    const storage = memory();
    expect(loadUnscheduledTrayOpen(storage, "u1")).toBe(false);
    expect(loadUnscheduledTrayOpen(null, "u1")).toBe(false);
    saveUnscheduledTrayOpen(storage, "u1", true);
    expect(loadUnscheduledTrayOpen(storage, "u1")).toBe(true);
    expect(loadUnscheduledTrayOpen(storage, "u2")).toBe(false);
    expect(unscheduledTrayStorageKey(null)).toBe("organize:calendar-unscheduled-tray:anonymous");
    storage.setItem(unscheduledTrayStorageKey("u3"), "garbage");
    expect(loadUnscheduledTrayOpen(storage, "u3")).toBe(false);
  });
});
