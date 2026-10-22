import { describe, expect, it } from "vitest";
import type { Tag, TaskWithTags } from "@organize/shared";
import {
  DEFAULT_CALENDAR_TASK_FILTER,
  activeCalendarFilterCount,
  applyCalendarTaskFilter,
  calendarTaskFilterStorageKey,
  isCalendarFilterActive,
  loadCalendarTaskFilter,
  parseCalendarTaskFilter,
  pruneCalendarTaskFilterTags,
  saveCalendarTaskFilter,
  type CalendarTaskFilter,
} from "./calendar-filters";

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

function makeTag(id: string, name = id): Tag {
  return { id, user_id: "u1", name, color: "blue" };
}

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

function filter(patch: Partial<CalendarTaskFilter>): CalendarTaskFilter {
  return { ...DEFAULT_CALENDAR_TASK_FILTER, ...patch };
}

describe("日历筛选：状态判断", () => {
  it("默认全空 = 不筛选；任一条件生效即激活", () => {
    expect(isCalendarFilterActive(DEFAULT_CALENDAR_TASK_FILTER)).toBe(false);
    expect(isCalendarFilterActive(filter({ query: "   " }))).toBe(false);
    expect(isCalendarFilterActive(filter({ tagIds: ["t1"] }))).toBe(true);
    expect(isCalendarFilterActive(filter({ priorities: ["high"] }))).toBe(true);
    expect(isCalendarFilterActive(filter({ query: "周报" }))).toBe(true);
  });

  it("条件计数：标签/优先级逐条，关键词整体一条", () => {
    expect(activeCalendarFilterCount(DEFAULT_CALENDAR_TASK_FILTER)).toBe(0);
    expect(activeCalendarFilterCount(filter({ tagIds: ["a", "b"], priorities: ["high"], query: " x " }))).toBe(4);
  });
});

describe("日历筛选：应用过滤", () => {
  const tech = makeTag("tag-tech", "技术");
  const product = makeTag("tag-product", "产品");

  it("空筛选恒等（同一引用，老用户首屏不变）", () => {
    const tasks = [makeTask(), makeTask({ id: "task-2" })];
    expect(applyCalendarTaskFilter(tasks, DEFAULT_CALENDAR_TASK_FILTER)).toBe(tasks);
    expect(applyCalendarTaskFilter(tasks, filter({ query: "  " }))).toBe(tasks);
  });

  it("标签为任一命中（OR）", () => {
    const tasks = [
      makeTask({ id: "a", tags: [tech] }),
      makeTask({ id: "b", tags: [product] }),
      makeTask({ id: "c", tags: [] }),
      makeTask({ id: "d", tags: [tech, product] }),
    ];
    expect(applyCalendarTaskFilter(tasks, filter({ tagIds: [tech.id, product.id] })).map((t) => t.id)).toEqual(["a", "b", "d"]);
    expect(applyCalendarTaskFilter(tasks, filter({ tagIds: [tech.id] })).map((t) => t.id)).toEqual(["a", "d"]);
  });

  it("tags 缺省（undefined）视为无标签", () => {
    const legacy = makeTask({ id: "a" });
    delete legacy.tags;
    expect(applyCalendarTaskFilter([legacy], filter({ tagIds: ["x"] }))).toEqual([]);
  });

  it("优先级为任一命中（OR）", () => {
    const tasks = [
      makeTask({ id: "a", priority: "high" }),
      makeTask({ id: "b", priority: "medium" }),
      makeTask({ id: "c", priority: "low" }),
    ];
    expect(applyCalendarTaskFilter(tasks, filter({ priorities: ["high", "low"] })).map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("关键词：标题与描述、大小写不敏感、去首尾空白", () => {
    const tasks = [
      makeTask({ id: "a", title: "Review OKR 进展" }),
      makeTask({ id: "b", title: "写周报", description: "包含 Review 会议结论" }),
      makeTask({ id: "c", title: "健身跑步" }),
    ];
    expect(applyCalendarTaskFilter(tasks, filter({ query: "  review " })).map((t) => t.id)).toEqual(["a", "b"]);
    expect(applyCalendarTaskFilter(tasks, filter({ query: "周报" })).map((t) => t.id)).toEqual(["b"]);
  });

  it("描述为 null 时只匹配标题", () => {
    const tasks = [makeTask({ id: "a", title: "写周报", description: null })];
    expect(applyCalendarTaskFilter(tasks, filter({ query: "周报" }))).toHaveLength(1);
    expect(applyCalendarTaskFilter(tasks, filter({ query: "不存在" }))).toHaveLength(0);
  });

  it("三类条件之间为 AND", () => {
    const tasks = [
      makeTask({ id: "a", title: "写周报", priority: "high", tags: [tech] }),
      makeTask({ id: "b", title: "写周报", priority: "high", tags: [product] }),
      makeTask({ id: "c", title: "写周报", priority: "low", tags: [tech] }),
      makeTask({ id: "d", title: "健身", priority: "high", tags: [tech] }),
    ];
    const result = applyCalendarTaskFilter(tasks, filter({ tagIds: [tech.id], priorities: ["high"], query: "周报" }));
    expect(result.map((t) => t.id)).toEqual(["a"]);
  });

  it("重复投影继承源任务的 tags / priority（展开自 ...task，口径一致）", () => {
    const source = makeTask({ id: "src", title: "每日站会", priority: "high", tags: [tech] });
    const projection: TaskWithTags = {
      ...source,
      id: "src:recurring:2026-10-22T01:00:00.000Z",
      schedule_start_at: "2026-10-22T01:00:00.000Z",
    };
    expect(applyCalendarTaskFilter([projection], filter({ tagIds: [tech.id] }))).toHaveLength(1);
    expect(applyCalendarTaskFilter([projection], filter({ priorities: ["high"] }))).toHaveLength(1);
    expect(applyCalendarTaskFilter([projection], filter({ priorities: ["low"] }))).toHaveLength(0);
    expect(applyCalendarTaskFilter([projection], filter({ query: "站会" }))).toHaveLength(1);
  });
});

describe("日历筛选：持久化", () => {
  it("按用户读写往返；关键词不持久化", () => {
    const store = storage();
    saveCalendarTaskFilter(store, "u1", filter({ tagIds: ["t1"], priorities: ["high"], query: "周报" }));
    expect(loadCalendarTaskFilter(store, "u1")).toEqual(filter({ tagIds: ["t1"], priorities: ["high"] }));
    expect(loadCalendarTaskFilter(store, "u2")).toEqual(DEFAULT_CALENDAR_TASK_FILTER);
    expect(calendarTaskFilterStorageKey("u1")).not.toBe(calendarTaskFilterStorageKey("u2"));
  });

  it("非法 JSON / 非法字段整体作废回落默认", () => {
    expect(parseCalendarTaskFilter("not json")).toBeNull();
    expect(parseCalendarTaskFilter('"str"')).toBeNull();
    expect(parseCalendarTaskFilter(JSON.stringify({ tagIds: "t1" }))).toBeNull();
    expect(parseCalendarTaskFilter(JSON.stringify({ tagIds: [1] }))).toBeNull();
    expect(parseCalendarTaskFilter(JSON.stringify({ priorities: ["urgent"] }))).toBeNull();
    const store = storage({ [calendarTaskFilterStorageKey("u1")]: "xx" });
    expect(loadCalendarTaskFilter(store, "u1")).toEqual(DEFAULT_CALENDAR_TASK_FILTER);
  });

  it("缺字段回落默认（前向兼容旧存储）", () => {
    expect(parseCalendarTaskFilter(JSON.stringify({ priorities: ["low"] }))).toEqual(filter({ priorities: ["low"] }));
    expect(parseCalendarTaskFilter(JSON.stringify({}))).toEqual(DEFAULT_CALENDAR_TASK_FILTER);
  });

  it("加载时剔除已删除的标签 id；无变化返回原对象", () => {
    const store = storage();
    saveCalendarTaskFilter(store, "u1", filter({ tagIds: ["keep", "gone"], priorities: ["high"] }));
    expect(loadCalendarTaskFilter(store, "u1", new Set(["keep"]))).toEqual(filter({ tagIds: ["keep"], priorities: ["high"] }));
    const current = filter({ tagIds: ["keep"] });
    expect(pruneCalendarTaskFilterTags(current, new Set(["keep"]))).toBe(current);
    expect(pruneCalendarTaskFilterTags(current, new Set())).toEqual(filter({ tagIds: [] }));
  });

  it("storage 抛异常不炸（隐私模式）", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadCalendarTaskFilter(broken, "u1")).toEqual(DEFAULT_CALENDAR_TASK_FILTER);
    expect(() => saveCalendarTaskFilter(broken, "u1", DEFAULT_CALENDAR_TASK_FILTER)).not.toThrow();
    expect(loadCalendarTaskFilter(null, "u1")).toEqual(DEFAULT_CALENDAR_TASK_FILTER);
  });
});
