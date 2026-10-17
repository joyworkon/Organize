import { describe, it, expect } from "vitest";
import {
  LINKED_TASKS_LOAD_ERROR_MESSAGE,
  linkedTasksOverflowLabel,
  nextLinkedTasksAfterLoad,
  shouldHideLinkedTaskBanner,
  type LinkedTaskRow,
} from "./linked-task-banner-load";

const taskA: LinkedTaskRow = { id: "task-a", title: "写周报", status: "todo" };
const taskB: LinkedTaskRow = { id: "task-b", title: "修登录 bug", status: "done" };
const taskC: LinkedTaskRow = { id: "task-c", title: "评审方案", status: "doing" };

const noPrevious = { tasks: [], total: 0 };

describe("nextLinkedTasksAfterLoad", () => {
  it("成功加载：用新数据整体替换并清错，total 取 count（真实总数而非截断长度）", () => {
    const plan = nextLinkedTasksAfterLoad({
      previous: { tasks: [taskA], total: 1 },
      data: [taskA, taskB, taskC],
      error: null,
      count: 7,
    });
    expect(plan.tasks).toEqual([taskA, taskB, taskC]);
    expect(plan.total).toBe(7);
    expect(plan.loadError).toBeNull();
  });

  it("成功加载且 count 为 null：total 退回 data.length（与旧计数行为一致）", () => {
    const plan = nextLinkedTasksAfterLoad({
      previous: noPrevious,
      data: [taskA],
      error: null,
      count: null,
    });
    expect(plan.total).toBe(1);
    expect(plan.loadError).toBeNull();
  });

  it("成功且数据为空（真·没有关联任务）：空列表、total 0、无错", () => {
    const plan = nextLinkedTasksAfterLoad({ previous: noPrevious, data: [], error: null, count: 0 });
    expect(plan.tasks).toEqual([]);
    expect(plan.total).toBe(0);
    expect(plan.loadError).toBeNull();
  });

  it("无错但 data 为 null：按空列表处理，不得抛错", () => {
    const plan = nextLinkedTasksAfterLoad({
      previous: { tasks: [taskA], total: 1 },
      data: null,
      error: null,
      count: null,
    });
    expect(plan.tasks).toEqual([]);
    expect(plan.total).toBe(0);
  });

  it("刷新失败但此前成功过：保留旧 tasks/total 并设置 loadError，不得清空伪装成「没有关联任务」", () => {
    const previous = { tasks: [taskA, taskB], total: 5 };
    const plan = nextLinkedTasksAfterLoad({ previous, data: null, error: { code: "PGRST-500" }, count: null });
    expect(plan.tasks).toBe(previous.tasks);
    expect(plan.total).toBe(5);
    expect(plan.loadError).toBe(LINKED_TASKS_LOAD_ERROR_MESSAGE);
  });

  it("失败后再成功：替换为新数据并清除错误", () => {
    const failed = nextLinkedTasksAfterLoad({
      previous: { tasks: [taskA], total: 1 },
      data: null,
      error: new Error("network down"),
      count: null,
    });
    const recovered = nextLinkedTasksAfterLoad({
      previous: { tasks: failed.tasks, total: failed.total },
      data: [taskB],
      error: null,
      count: 1,
    });
    expect(recovered.tasks).toEqual([taskB]);
    expect(recovered.total).toBe(1);
    expect(recovered.loadError).toBeNull();
  });
});

describe("shouldHideLinkedTaskBanner", () => {
  it("成功且为空：隐藏横幅（真没有关联任务就不占位，保持原行为）", () => {
    expect(shouldHideLinkedTaskBanner({ tasks: [], loadError: null })).toBe(true);
  });

  it("有任务时不隐藏", () => {
    expect(shouldHideLinkedTaskBanner({ tasks: [taskA], loadError: null })).toBe(false);
  });

  it("首次失败（任务为空但有 loadError）：不得隐藏——失败必须展示错误提示与重试，不得 return null 谎报", () => {
    expect(
      shouldHideLinkedTaskBanner({ tasks: [], loadError: LINKED_TASKS_LOAD_ERROR_MESSAGE })
    ).toBe(false);
  });

  it("保留旧数据 + 失败提示时不隐藏", () => {
    expect(
      shouldHideLinkedTaskBanner({ tasks: [taskA], loadError: LINKED_TASKS_LOAD_ERROR_MESSAGE })
    ).toBe(false);
  });
});

describe("linkedTasksOverflowLabel", () => {
  it("总数超过已展示条数：如实报真实总数", () => {
    expect(linkedTasksOverflowLabel(7, 2)).toBe("等 7 个");
    expect(linkedTasksOverflowLabel(3, 2)).toBe("等 3 个");
  });

  it("总数不超过已展示条数：不显示（null）", () => {
    expect(linkedTasksOverflowLabel(2, 2)).toBeNull();
    expect(linkedTasksOverflowLabel(1, 2)).toBeNull();
    expect(linkedTasksOverflowLabel(0, 0)).toBeNull();
  });
});
