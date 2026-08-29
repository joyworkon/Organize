import { describe, expect, it } from "vitest";
import { computeTodayCompletion, computeTaskStreak } from "@/lib/dashboard/workbench-stats";

// 固定时钟：2026-08-29（周六）15:00 本地时间。全部用例不依赖真实当前时间，
// 同一组输入永远得到同一输出（= 刷新与换设备一致的保证，因为结果只源于持久化数据）。
const NOW = new Date(2026, 7, 29, 15, 0, 0);

/** 用本地日历日构造 ISO 时刻（默认当天 10:00） */
const at = (y: number, m: number, d: number, hour = 10): string =>
  new Date(y, m - 1, d, hour, 0, 0).toISOString();

const task = (patch: {
  due_date?: string | null;
  status?: string;
  completed_at?: string | null;
}) => ({
  due_date: patch.due_date ?? null,
  status: patch.status ?? "todo",
  completed_at: patch.completed_at ?? null,
});

describe("computeTodayCompletion 同窗口完成率", () => {
  it("验收用例：4 项计划、2 项完成 = 50%", () => {
    const tasks = [
      task({ due_date: at(2026, 8, 29), status: "done", completed_at: at(2026, 8, 29, 11) }),
      task({ due_date: at(2026, 8, 29), status: "done", completed_at: at(2026, 8, 29, 14) }),
      task({ due_date: at(2026, 8, 29), status: "todo" }),
      task({ due_date: at(2026, 8, 29), status: "in_progress" }),
    ];
    expect(computeTodayCompletion(tasks, NOW)).toEqual({ planned: 4, completed: 2, rate: 50 });
  });

  it("逾期未完成计入计划；逾期但昨天已完成的任务不属于今天", () => {
    const tasks = [
      task({ due_date: at(2026, 8, 27), status: "todo" }), // 逾期未完成 → 计划
      task({ due_date: at(2026, 8, 28), status: "done", completed_at: at(2026, 8, 28, 18) }), // 昨天完成 → 不在今天窗口
      task({ due_date: at(2026, 8, 29), status: "done", completed_at: at(2026, 8, 29, 9) }), // 今天完成 → 计划+完成
    ];
    expect(computeTodayCompletion(tasks, NOW)).toEqual({ planned: 2, completed: 1, rate: 50 });
  });

  it("今天提前完成未来到期的任务也算今天的活动", () => {
    const tasks = [
      task({ due_date: at(2026, 9, 2), status: "done", completed_at: at(2026, 8, 29, 12) }),
      task({ due_date: null, status: "done", completed_at: at(2026, 8, 29, 13) }),
    ];
    expect(computeTodayCompletion(tasks, NOW)).toEqual({ planned: 2, completed: 2, rate: 100 });
  });

  it("已取消任务不进任何一侧；无到期日的未完成任务不进计划", () => {
    const tasks = [
      task({ due_date: at(2026, 8, 29), status: "cancelled" }),
      task({ due_date: null, status: "todo" }),
    ];
    expect(computeTodayCompletion(tasks, NOW)).toEqual({ planned: 0, completed: 0, rate: 0 });
  });

  it("窗口为空 → 0%（不是 NaN 或假数字）", () => {
    expect(computeTodayCompletion([], NOW)).toEqual({ planned: 0, completed: 0, rate: 0 });
  });

  it("同一输入重复计算结果一致（刷新/换设备等价）", () => {
    const tasks = [
      task({ due_date: at(2026, 8, 29), status: "done", completed_at: at(2026, 8, 29, 11) }),
      task({ due_date: at(2026, 8, 29), status: "todo" }),
    ];
    const a = computeTodayCompletion(tasks, NOW);
    const b = computeTodayCompletion(tasks, NOW);
    expect(a).toEqual(b);
  });
});

describe("computeTaskStreak 持久化活动连续天数", () => {
  it("今天、昨天、前天都有完成 → 连续 3 天", () => {
    const completions = [
      at(2026, 8, 29, 9),
      at(2026, 8, 28, 21),
      at(2026, 8, 27, 8),
      at(2026, 8, 27, 20), // 同一天多次只算一天
    ];
    expect(computeTaskStreak(completions, NOW)).toBe(3);
  });

  it("今天还没有完成不断签：从昨天起数", () => {
    const completions = [at(2026, 8, 28, 21), at(2026, 8, 27, 8)];
    expect(computeTaskStreak(completions, NOW)).toBe(2);
  });

  it("中间断一天则截断", () => {
    const completions = [
      at(2026, 8, 29, 9),
      at(2026, 8, 28, 9),
      at(2026, 8, 26, 9), // 27 号断档
      at(2026, 8, 25, 9),
    ];
    expect(computeTaskStreak(completions, NOW)).toBe(2);
  });

  it("昨天和今天都没有活动 → 0；空数据 → 0", () => {
    expect(computeTaskStreak([at(2026, 8, 20, 9)], NOW)).toBe(0);
    expect(computeTaskStreak([], NOW)).toBe(0);
    expect(computeTaskStreak([null, undefined], NOW)).toBe(0);
  });
});
