import { describe, it, expect } from "vitest";
import {
  HISTORY_LOAD_ERROR_MESSAGE,
  nextVersionsAfterLoad,
  shouldShowHistoryEmpty,
} from "./note-history-load";

interface TestVersion {
  id: string;
  title: string | null;
  message: string | null;
  created_at: string;
}

const versionA: TestVersion = {
  id: "v1",
  title: "旧标题",
  message: null,
  created_at: "2026-10-15T08:00:00Z",
};

const versionB: TestVersion = {
  id: "v2",
  title: "新标题",
  message: "定稿",
  created_at: "2026-10-16T09:00:00Z",
};

describe("nextVersionsAfterLoad", () => {
  it("成功加载：用新数据整体替换并清错", () => {
    const plan = nextVersionsAfterLoad([versionA], { ok: true, versions: [versionB] });
    expect(plan.failed).toBe(false);
    expect(plan.keptPrevious).toBe(false);
    expect(plan.versions).toEqual([versionB]);
    expect(plan.loadError).toBeNull();
  });

  it("成功加载空列表（真的没有版本）：空且无错", () => {
    const plan = nextVersionsAfterLoad([versionA], { ok: true, versions: [] });
    expect(plan.failed).toBe(false);
    expect(plan.versions).toEqual([]);
    expect(plan.loadError).toBeNull();
  });

  it("刷新失败但此前成功过：保留旧 versions 并标记失败，不得清空伪装成「还没有历史版本」", () => {
    const previous = [versionA, versionB];
    const plan = nextVersionsAfterLoad(previous, { ok: false });
    expect(plan.failed).toBe(true);
    expect(plan.keptPrevious).toBe(true);
    // 同引用：保留旧数据本身，调用方重设 state 不会触发无谓重渲染
    expect(plan.versions).toBe(previous);
    expect(plan.loadError).toBe(HISTORY_LOAD_ERROR_MESSAGE);
  });

  it("从未成功过的失败：落到空列表但标记 failed，与「真的没有版本」区分", () => {
    const plan = nextVersionsAfterLoad(null, { ok: false });
    expect(plan.failed).toBe(true);
    expect(plan.keptPrevious).toBe(false);
    expect(plan.versions).toEqual([]);
    expect(plan.loadError).toBe(HISTORY_LOAD_ERROR_MESSAGE);
  });

  it("失败后再成功：替换为新数据并清除错误", () => {
    const failed = nextVersionsAfterLoad([versionA], { ok: false });
    const recovered = nextVersionsAfterLoad(failed.versions, { ok: true, versions: [versionB] });
    expect(recovered.failed).toBe(false);
    expect(recovered.versions).toEqual([versionB]);
    expect(recovered.loadError).toBeNull();
  });
});

describe("shouldShowHistoryEmpty", () => {
  it("无错、非加载中、列表为空：显示「还没有历史版本」空态", () => {
    expect(shouldShowHistoryEmpty([], null, false)).toBe(true);
  });

  it("有 loadError 时不显示空态——即使列表也是空的，失败不得谎报为「还没有历史版本」", () => {
    expect(shouldShowHistoryEmpty([], HISTORY_LOAD_ERROR_MESSAGE, false)).toBe(false);
  });

  it("加载中不显示空态（显示加载指示）", () => {
    expect(shouldShowHistoryEmpty([], null, true)).toBe(false);
  });

  it("有版本数据时不显示空态", () => {
    expect(shouldShowHistoryEmpty([versionA], null, false)).toBe(false);
    // 失败但保留了旧版本：同样不是空态
    expect(shouldShowHistoryEmpty([versionA], HISTORY_LOAD_ERROR_MESSAGE, false)).toBe(false);
  });
});
