// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NoteGroup } from "@organize/shared";
import { NOTE_DRAG_MIME, NoteGroupsBar } from "./note-groups-bar";
import { UNGROUPED_KEY } from "@/lib/notes/groups";

const groupA: NoteGroup = {
  id: "g1",
  user_id: "u1",
  name: "读书笔记",
  sort_order: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const baseProps = {
  counts: new Map<string, number>([
    ["all", 2],
    ["g1", 1],
    [UNGROUPED_KEY, 1],
  ]),
  active: "all",
  onActiveChange: () => {},
  onCreate: () => {},
  onRename: () => {},
  onDelete: () => {},
  onDropNote: () => {},
  onAutoGroup: () => {},
};

/** jsdom 没有 DragEvent/DataTransfer 实现：用普通 Event 挂上 dataTransfer 形状 */
function fireDocumentDrag(type: "dragstart" | "dragend", types: string[] = [NOTE_DRAG_MIME]) {
  const event = new Event(type);
  Object.defineProperty(event, "dataTransfer", { value: { types } });
  act(() => {
    document.dispatchEvent(event);
  });
}

describe("NoteGroupsBar 拖组可发现性", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (groups: NoteGroup[]) => {
    act(() => {
      root.render(createElement(NoteGroupsBar, { ...baseProps, groups }));
    });
  };

  it("有分组时显示「拖动笔记到分组上可归类」提示，无分组时不显示", () => {
    render([groupA]);
    expect(container.textContent).toContain("拖动笔记到分组上可归类");

    render([]);
    expect(container.textContent).not.toContain("拖动笔记到分组上可归类");
  });

  it("拖笔记进行中：分组与「未分组」chip 预亮虚线，「全部」不预亮；dragend 后复原", () => {
    render([groupA]);
    const groupChip = container.querySelector('[data-group-chip="g1"]')!;
    const ungroupedChip = container.querySelector(`[data-group-chip="${UNGROUPED_KEY}"]`)!;
    const allChip = container.querySelector('[data-group-chip="all"]')!;
    expect(groupChip).not.toBeNull();
    expect(ungroupedChip).not.toBeNull();
    expect(groupChip.className).not.toContain("border-dashed");

    fireDocumentDrag("dragstart");
    expect(groupChip.className).toContain("border-dashed");
    expect(ungroupedChip.className).toContain("border-dashed");
    expect(allChip.className).not.toContain("border-dashed");

    fireDocumentDrag("dragend");
    expect(groupChip.className).not.toContain("border-dashed");
    expect(ungroupedChip.className).not.toContain("border-dashed");
  });

  it("其他 MIME 的拖拽不触发预亮", () => {
    render([groupA]);
    const groupChip = container.querySelector('[data-group-chip="g1"]')!;
    fireDocumentDrag("dragstart", ["text/plain"]);
    expect(groupChip.className).not.toContain("border-dashed");
    fireDocumentDrag("dragend");
    expect(groupChip.className).not.toContain("border-dashed");
  });
});
