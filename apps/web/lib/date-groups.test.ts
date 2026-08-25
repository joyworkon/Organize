import { describe, expect, it } from "vitest";
import {
  groupNotesByDate,
  groupTasksByDate,
  noteDateGroupKey,
  taskDateGroupKey,
} from "./date-groups";

// 固定“现在”，避免测试依赖真实时间：
// NOTE_NOW 取 2026-08-27（周四），让“本周”分组内有非今天/昨天的日期；
// TASK_NOW 取 2026-08-25（周二）。
const NOTE_NOW = new Date(2026, 7, 27, 15, 0, 0);
const TASK_NOW = new Date(2026, 7, 25, 15, 0, 0);

function iso(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month - 1, day, hour).toISOString();
}

describe("noteDateGroupKey", () => {
  it("今天更新归入 today", () => {
    expect(noteDateGroupKey(iso(2026, 8, 27, 9), NOTE_NOW)).toBe("today");
    expect(noteDateGroupKey(iso(2026, 8, 27, 23), NOTE_NOW)).toBe("today");
  });

  it("昨天更新归入 yesterday", () => {
    expect(noteDateGroupKey(iso(2026, 8, 26), NOTE_NOW)).toBe("yesterday");
  });

  it("周一到前天之间归入 week（自然周，周一起算）", () => {
    // NOTE_NOW 为周四，本周一 = 08-24
    expect(noteDateGroupKey(iso(2026, 8, 25), NOTE_NOW)).toBe("week");
    expect(noteDateGroupKey(iso(2026, 8, 24), NOTE_NOW)).toBe("week");
  });

  it("上周日及更早归入 earlier", () => {
    expect(noteDateGroupKey(iso(2026, 8, 23), NOTE_NOW)).toBe("earlier");
    expect(noteDateGroupKey(iso(2026, 7, 31), NOTE_NOW)).toBe("earlier");
  });

  it("非法日期归入 earlier，不抛异常", () => {
    expect(noteDateGroupKey("not-a-date", NOTE_NOW)).toBe("earlier");
  });
});

describe("groupNotesByDate", () => {
  it("按固定顺序输出非空分组，组内保持原顺序", () => {
    const notes = [
      { id: "a", updated_at: iso(2026, 8, 20) },
      { id: "b", updated_at: iso(2026, 8, 27, 10) },
      { id: "c", updated_at: iso(2026, 8, 26) },
      { id: "d", updated_at: iso(2026, 8, 27, 8) },
    ];
    const groups = groupNotesByDate(notes, NOTE_NOW);
    expect(groups.map((g) => g.key)).toEqual(["today", "yesterday", "earlier"]);
    expect(groups[0].items.map((n) => n.id)).toEqual(["b", "d"]);
    expect(groups[0].label).toBe("今天");
  });

  it("空数组返回空分组", () => {
    expect(groupNotesByDate([], NOTE_NOW)).toEqual([]);
  });
});

describe("taskDateGroupKey", () => {
  it("null / undefined / 非法日期归入 noDate", () => {
    expect(taskDateGroupKey(null, TASK_NOW)).toBe("noDate");
    expect(taskDateGroupKey(undefined, TASK_NOW)).toBe("noDate");
    expect(taskDateGroupKey("bad", TASK_NOW)).toBe("noDate");
  });

  it("昨天及以前归入 overdue", () => {
    expect(taskDateGroupKey(iso(2026, 8, 24, 23), TASK_NOW)).toBe("overdue");
    expect(taskDateGroupKey(iso(2026, 8, 1), TASK_NOW)).toBe("overdue");
  });

  it("今天任意时间归入 today", () => {
    expect(taskDateGroupKey(iso(2026, 8, 25, 0), TASK_NOW)).toBe("today");
    expect(taskDateGroupKey(iso(2026, 8, 25, 23), TASK_NOW)).toBe("today");
  });

  it("明天归入 tomorrow", () => {
    expect(taskDateGroupKey(iso(2026, 8, 26), TASK_NOW)).toBe("tomorrow");
  });

  it("后天到 7 天内归入 week，超出归入 later", () => {
    expect(taskDateGroupKey(iso(2026, 8, 27), TASK_NOW)).toBe("week");
    expect(taskDateGroupKey(iso(2026, 8, 31), TASK_NOW)).toBe("week");
    expect(taskDateGroupKey(iso(2026, 9, 1), TASK_NOW)).toBe("later");
  });
});

describe("groupTasksByDate", () => {
  it("按固定顺序输出非空分组", () => {
    const tasks = [
      { id: "a", date: null },
      { id: "b", date: iso(2026, 8, 26) },
      { id: "c", date: iso(2026, 8, 20) },
      { id: "d", date: iso(2026, 8, 25) },
    ];
    const groups = groupTasksByDate(tasks, (t) => t.date, TASK_NOW);
    expect(groups.map((g) => g.key)).toEqual(["overdue", "today", "tomorrow", "noDate"]);
    expect(groups.map((g) => g.label)).toEqual(["已逾期", "今天", "明天", "无日期"]);
  });
});
