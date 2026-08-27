import { describe, expect, it } from "vitest";
import {
  MAX_TIMEOUT_MS,
  buildDueReminders,
  buildOverdueSummary,
  effectiveDueDate,
  pruneNotifiedKeys,
} from "./notifications";

const NOW = new Date(2026, 7, 19, 10, 0, 0); // 2026-08-19 10:00 本地
// 测试夹具统一用本地时间构造，避免 CI/本机时区差异
const LOCAL_TODAY_NOON = new Date(2026, 7, 19, 12, 0, 0).toISOString();
const LOCAL_TODAY_8AM = new Date(2026, 7, 19, 8, 0, 0).toISOString();
const LOCAL_TODAY_MIDNIGHT = new Date(2026, 7, 19, 0, 0, 0).toISOString();

describe("effectiveDueDate", () => {
  it("全天任务按当天 23:59:59 计，早晨不误报过期", () => {
    const due = effectiveDueDate({ due_date: LOCAL_TODAY_MIDNIGHT, all_day: true })!;
    expect(due.getHours()).toBe(23);
    expect(due.getMinutes()).toBe(59);
    expect(due.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("非全天任务按原时刻计", () => {
    const due = effectiveDueDate({ due_date: LOCAL_TODAY_NOON, all_day: false })!;
    expect(due.getTime()).toBe(new Date(2026, 7, 19, 12, 0, 0).getTime());
  });

  it("无日期 / 非法日期返回 null", () => {
    expect(effectiveDueDate({ due_date: null })).toBeNull();
    expect(effectiveDueDate({ due_date: "not-a-date" })).toBeNull();
  });
});

describe("buildDueReminders", () => {
  it("幂等 key 包含到期时刻：改期后产生新 key（旧 key 不再阻挡提醒）", () => {
    const base = { id: "t1", title: "任务", status: "todo", all_day: false };
    const a = buildDueReminders({ ...base, due_date: "2026-08-20T02:00:00.000Z" }, NOW);
    const b = buildDueReminders({ ...base, due_date: "2026-08-21T02:00:00.000Z" }, NOW);
    const keysA = a.map((r) => r.key);
    const keysB = b.map((r) => r.key);
    expect(keysA.length).toBeGreaterThan(0);
    expect(keysB.some((k) => keysA.includes(k))).toBe(false);
  });

  it("已完成/已取消任务不产生提醒", () => {
    expect(buildDueReminders({ id: "t", title: "x", status: "done", due_date: "2026-08-19T12:00:00.000Z" }, NOW)).toEqual([]);
    expect(buildDueReminders({ id: "t", title: "x", status: "cancelled", due_date: "2026-08-19T12:00:00.000Z" }, NOW)).toEqual([]);
  });

  it("今天到期的任务产生立即提醒（fireAt=now）", () => {
    const reminders = buildDueReminders(
      { id: "t1", title: "今天任务", status: "todo", all_day: false, due_date: LOCAL_TODAY_NOON },
      NOW
    );
    const today = reminders.find((r) => r.key.endsWith(":today"));
    expect(today).toBeDefined();
    expect(today!.fireAt).toBe(NOW.getTime());
    expect(today!.title).toBe("任务到期提醒");
  });

  it("已过期的今天任务标题为已过期", () => {
    const reminders = buildDueReminders(
      { id: "t1", title: "过期任务", status: "todo", all_day: false, due_date: LOCAL_TODAY_8AM },
      NOW
    );
    const today = reminders.find((r) => r.key.endsWith(":today"));
    expect(today!.title).toBe("任务已过期");
  });

  it("宽限期内（15 分钟内）到期的任务不当场报「已过期」", () => {
    // 到期 10 分钟：仍在 OVERDUE_IMMEDIATE_GRACE_MS 内，措辞保持"即将到期"
    const tenMinAgo = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
    const reminders = buildDueReminders(
      { id: "t1", title: "刚到期任务", status: "todo", all_day: false, due_date: tenMinAgo },
      NOW
    );
    const today = reminders.find((r) => r.key.endsWith(":today"));
    expect(today).toBeDefined();
    expect(today!.title).toBe("任务到期提醒");
  });

  it("未来任务产生 15 分钟前与到期两条提醒", () => {
    const reminders = buildDueReminders(
      { id: "t1", title: "未来任务", status: "todo", all_day: false, due_date: LOCAL_TODAY_NOON },
      NOW
    );
    const kinds = reminders.map((r) => r.key.split(":").pop());
    expect(kinds).toContain("15min");
    expect(kinds).toContain("due");
  });

  it("远期任务（>24.8 天）的 delay 会超 setTimeout 上限，调用方须凭 MAX_TIMEOUT_MS 跳过", () => {
    const reminders = buildDueReminders(
      { id: "t1", title: "远期任务", status: "todo", all_day: false, due_date: "2026-10-01T02:00:00.000Z" },
      NOW
    );
    const due = reminders.find((r) => r.key.endsWith(":due"))!;
    expect(due.fireAt - NOW.getTime()).toBeGreaterThan(MAX_TIMEOUT_MS);
  });
});

describe("pruneNotifiedKeys", () => {
  it("删除/完成任务的旧 key 被清掉", () => {
    const keys = new Set(["t1:100:today", "t2:200:due"]);
    const current = new Map([["t1", 100]]);
    expect(Array.from(pruneNotifiedKeys(keys, current))).toEqual(["t1:100:today"]);
  });

  it("改期后旧到期时刻的 key 被清掉，新 key 保留", () => {
    const keys = new Set(["t1:100:due", "t1:300:due"]);
    const current = new Map([["t1", 300]]);
    expect(Array.from(pruneNotifiedKeys(keys, current))).toEqual(["t1:300:due"]);
  });
});

describe("buildOverdueSummary", () => {
  const base = { all_day: false, deleted_at: null };

  it("统计昨天及以前到期的未完成任务", () => {
    const summary = buildOverdueSummary([
      { ...base, title: "昨天到期", status: "todo", due_date: new Date(2026, 7, 18, 12, 0, 0).toISOString() },
      { ...base, title: "上周到期", status: "in_progress", due_date: new Date(2026, 7, 15, 12, 0, 0).toISOString() },
    ], NOW);
    expect(summary).not.toBeNull();
    expect(summary!.count).toBe(2);
    expect(summary!.title).toBe("你有 2 个任务已逾期");
    expect(summary!.body).toBe("昨天到期、上周到期");
  });

  it("当天到期的不计入（由即时提醒覆盖）", () => {
    const summary = buildOverdueSummary([
      { ...base, title: "今早到期", status: "todo", due_date: LOCAL_TODAY_8AM },
    ], NOW);
    expect(summary).toBeNull();
  });

  it("已完成/已取消/已删除的不计入", () => {
    const yesterday = new Date(2026, 7, 18, 12, 0, 0).toISOString();
    const summary = buildOverdueSummary([
      { ...base, title: "done", status: "done", due_date: yesterday },
      { ...base, title: "cancelled", status: "cancelled", due_date: yesterday },
      { ...base, title: "deleted", status: "todo", due_date: yesterday, deleted_at: yesterday },
    ], NOW);
    expect(summary).toBeNull();
  });

  it("无日期与非法日期不计入", () => {
    const summary = buildOverdueSummary([
      { ...base, title: "无日期", status: "todo", due_date: null },
      { ...base, title: "坏日期", status: "todo", due_date: "bad" },
    ], NOW);
    expect(summary).toBeNull();
  });

  it("超过 3 个时 body 省略为「等 N 个任务」", () => {
    const yesterday = new Date(2026, 7, 18, 12, 0, 0).toISOString();
    const tasks = ["甲", "乙", "丙", "丁"].map((title) => ({
      ...base, title, status: "todo", due_date: yesterday,
    }));
    const summary = buildOverdueSummary(tasks, NOW);
    expect(summary!.count).toBe(4);
    expect(summary!.body).toBe("甲、乙、丙 等 4 个任务");
  });

  it("全天任务的逾期按当天 23:59:59 判定：昨天全天的任务今天算逾期", () => {
    const summary = buildOverdueSummary([
      { ...base, title: "昨天全天", status: "todo", all_day: true, due_date: new Date(2026, 7, 18, 0, 0, 0).toISOString() },
    ], NOW);
    expect(summary!.count).toBe(1);
  });
});
