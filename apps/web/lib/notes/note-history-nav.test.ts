import { describe, expect, it } from "vitest";
import {
  historyEscapeAction,
  historyListMove,
  isCurrentPreviewRequest,
  nextUrlWithoutHistoryPanel,
  noteHistoryHref,
} from "./note-history-nav";

describe("historyListMove", () => {
  it("空列表不处理方向键", () => {
    expect(historyListMove("ArrowDown", -1, 0)).toBeNull();
    expect(historyListMove("a", 0, 3)).toBeNull();
  });

  it("↓/↑ 移动并预览；到边界后不再重复请求", () => {
    expect(historyListMove("ArrowDown", -1, 3)).toEqual({ index: 0, preview: true });
    expect(historyListMove("ArrowDown", 0, 3)).toEqual({ index: 1, preview: true });
    expect(historyListMove("ArrowDown", 2, 3)).toEqual({ index: 2, preview: false });
    expect(historyListMove("ArrowUp", -1, 3)).toEqual({ index: 2, preview: true });
    expect(historyListMove("ArrowUp", 0, 3)).toEqual({ index: 0, preview: false });
    expect(historyListMove("ArrowUp", 2, 3)).toEqual({ index: 1, preview: true });
  });

  it("Home 到最新，End 到最早，Enter/Space 预览当前项", () => {
    expect(historyListMove("Home", 2, 4)).toEqual({ index: 0, preview: true });
    expect(historyListMove("End", 0, 4)).toEqual({ index: 3, preview: true });
    expect(historyListMove("Home", 0, 4)).toEqual({ index: 0, preview: false });
    expect(historyListMove("Enter", 1, 4)).toEqual({ index: 1, preview: true });
    expect(historyListMove(" ", -1, 4)).toEqual({ index: 0, preview: true });
  });
});

describe("historyEscapeAction", () => {
  it("预览中先退出预览，否则关闭侧栏", () => {
    expect(historyEscapeAction(true)).toBe("exit-preview");
    expect(historyEscapeAction(false)).toBe("close");
  });
});

describe("isCurrentPreviewRequest", () => {
  it("只采纳最后一次请求", () => {
    expect(isCurrentPreviewRequest(2, 2)).toBe(true);
    expect(isCurrentPreviewRequest(1, 2)).toBe(false);
  });
});

describe("note history links", () => {
  it("卡片历史跳到笔记页并带 panel=history", () => {
    expect(noteHistoryHref("note-1")).toBe("/notes/note-1?panel=history");
  });

  it("用过 panel=history 后从 URL 去掉，保留其它参数", () => {
    expect(nextUrlWithoutHistoryPanel("/notes/note-1", "panel=history")).toBe("/notes/note-1");
    expect(nextUrlWithoutHistoryPanel("/notes/note-1", "?panel=history&x=1")).toBe("/notes/note-1?x=1");
    expect(nextUrlWithoutHistoryPanel("/notes/note-1", "panel=comments")).toBeNull();
    expect(nextUrlWithoutHistoryPanel("/notes/note-1", "")).toBeNull();
  });
});
