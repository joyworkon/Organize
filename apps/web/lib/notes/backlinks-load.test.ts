import { describe, it, expect } from "vitest";
import {
  BACKLINKS_LOAD_ERROR_MESSAGE,
  nextBacklinksAfterLoad,
  shouldHideBacklinksPanel,
} from "./backlinks-load";

interface TestBacklink {
  id: string;
  title: string | null;
  created_at: string;
}

const backlinkA: TestBacklink = {
  id: "note-a",
  title: "来源笔记 A",
  created_at: "2026-10-15T08:00:00Z",
};

const backlinkB: TestBacklink = {
  id: "note-b",
  title: null,
  created_at: "2026-10-16T09:00:00Z",
};

describe("nextBacklinksAfterLoad", () => {
  it("成功加载：用新数据整体替换并清错", () => {
    const plan = nextBacklinksAfterLoad([backlinkA], { ok: true, rows: [backlinkB] });
    expect(plan.failed).toBe(false);
    expect(plan.keptPrevious).toBe(false);
    expect(plan.rows).toEqual([backlinkB]);
    expect(plan.loadError).toBeNull();
  });

  it("成功加载空列表（真的没有反链）：空且无错", () => {
    const plan = nextBacklinksAfterLoad([backlinkA], { ok: true, rows: [] });
    expect(plan.failed).toBe(false);
    expect(plan.rows).toEqual([]);
    expect(plan.loadError).toBeNull();
  });

  it("刷新失败但此前成功过：保留旧 backlinks 并标记失败，不得清空伪装成「没有反向链接」", () => {
    const previous = [backlinkA, backlinkB];
    const plan = nextBacklinksAfterLoad(previous, { ok: false });
    expect(plan.failed).toBe(true);
    expect(plan.keptPrevious).toBe(true);
    // 同引用：保留旧数据本身，调用方重设 state 不会触发无谓重渲染
    expect(plan.rows).toBe(previous);
    expect(plan.loadError).toBe(BACKLINKS_LOAD_ERROR_MESSAGE);
  });

  it("从未成功过的失败：落到空列表但标记 failed，与「真的没有反链」区分", () => {
    const plan = nextBacklinksAfterLoad(null, { ok: false });
    expect(plan.failed).toBe(true);
    expect(plan.keptPrevious).toBe(false);
    expect(plan.rows).toEqual([]);
    expect(plan.loadError).toBe(BACKLINKS_LOAD_ERROR_MESSAGE);
  });

  it("失败后再成功：替换为新数据并清除错误", () => {
    const failed = nextBacklinksAfterLoad([backlinkA], { ok: false });
    const recovered = nextBacklinksAfterLoad(failed.rows, { ok: true, rows: [backlinkB] });
    expect(recovered.failed).toBe(false);
    expect(recovered.rows).toEqual([backlinkB]);
    expect(recovered.loadError).toBeNull();
  });
});

describe("shouldHideBacklinksPanel", () => {
  const allEmpty = {
    loading: false,
    loadError: null,
    hasReading: false,
    hasUnavailableReading: false,
    hasBacklinks: false,
    hasLinkedTasks: false,
  };

  it("无错、非加载中、四类内容皆空：隐藏面板（真没有内容就不占位）", () => {
    expect(shouldHideBacklinksPanel(allEmpty)).toBe(true);
  });

  it("有 loadError 时不得隐藏——即使其余全空，失败不得谎报为「没有反链」", () => {
    expect(shouldHideBacklinksPanel({ ...allEmpty, loadError: BACKLINKS_LOAD_ERROR_MESSAGE })).toBe(
      false
    );
  });

  it("加载中不隐藏（显示加载指示）", () => {
    expect(shouldHideBacklinksPanel({ ...allEmpty, loading: true })).toBe(false);
  });

  it("任一类内容存在即不隐藏", () => {
    expect(shouldHideBacklinksPanel({ ...allEmpty, hasBacklinks: true })).toBe(false);
    expect(shouldHideBacklinksPanel({ ...allEmpty, hasReading: true })).toBe(false);
    expect(shouldHideBacklinksPanel({ ...allEmpty, hasUnavailableReading: true })).toBe(false);
    expect(shouldHideBacklinksPanel({ ...allEmpty, hasLinkedTasks: true })).toBe(false);
  });
});
