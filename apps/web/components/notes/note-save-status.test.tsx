// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NoteSaveUiState } from "@/lib/notes/note-save-session";
import { NoteSaveStatus } from "./note-save-status";

const cleanState = (overrides: Partial<NoteSaveUiState> = {}): NoteSaveUiState => ({
  phase: "clean",
  lastSavedAt: null,
  saveError: "",
  offlinePending: false,
  conflict: null,
  localPersistence: "ok",
  pendingChildBlocks: 0,
  ...overrides,
});

describe("NoteSaveStatus", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

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

  function render(state: NoteSaveUiState, online = true, isViewer = false) {
    act(() => root.render(createElement(NoteSaveStatus, {
      online,
      offlinePending: false,
      pendingSyncedBlocks: 0,
      saveError: "旧错误",
      saving: false,
      lastSaved: new Date("2026-01-01T00:00:00Z"),
      isViewer,
      saveState: state,
    })));
    return container.querySelector('[role="status"]')!;
  }

  it("dirty 状态不显示上一次的已保存时间", () => {
    const status = render(cleanState({ phase: "dirty", lastSavedAt: new Date("2026-01-01T00:00:00Z") }));
    expect(status.textContent).toContain("尚未保存");
    expect(status.textContent).not.toContain("已保存");
  });

  it("offline 状态在手机和桌面共用明确的待同步文案，并带 live region", () => {
    const status = render(cleanState({ phase: "local-only", offlinePending: true }), false);
    expect(status.textContent).toContain("离线");
    expect(status.textContent).toContain("尚未同步");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  it("error 和 conflict 保留就地失败/冲突说明", () => {
    const error = render(cleanState({ phase: "error", saveError: "保存失败，请重试" }));
    expect(error.textContent).toContain("保存失败，请重试");
    const conflict = render(cleanState({ phase: "conflict", saveError: "检测到其他位置的修改" }));
    expect(conflict.textContent).toContain("保存冲突");
    expect(conflict.textContent).toContain("检测到其他位置的修改");
  });

  it("clean 时只显示会话确认过的已保存状态，viewer 明确只读", () => {
    const saved = render(cleanState({ lastSavedAt: new Date("2026-01-01T00:00:00Z") }));
    expect(saved.textContent).toContain("已保存");
    const neverSaved = render(cleanState());
    expect(neverSaved.textContent).not.toContain("已保存");
    const offline = render(cleanState({ lastSavedAt: new Date("2026-01-01T00:00:00Z") }), false);
    expect(offline.textContent).toContain("离线");
    expect(offline.textContent).not.toContain("已保存");
    const viewer = render(cleanState({ phase: "dirty" }), true, true);
    expect(viewer.textContent).toBe("仅查看");
  });
});
