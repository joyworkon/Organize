// @vitest-environment jsdom

import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotePageMenu } from "./note-page-menu";
import type { NoteFont } from "@organize/shared";

// jsdom 没有 PointerEvent，用 MouseEvent 做最小 polyfill
if (typeof globalThis.PointerEvent === "undefined") {
  (globalThis as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}

type MenuProps = React.ComponentProps<typeof NotePageMenu>;

// 辅助：创建默认 props
function createProps(overrides: Partial<MenuProps> = {}): MenuProps {
  return {
    fullWidth: false,
    font: "default",
    smallFont: false,
    onToggleFullWidth: vi.fn(),
    onFontChange: vi.fn(),
    onToggleSmallFont: vi.fn(),
    onCopyLink: vi.fn(),
    onCopyContent: vi.fn(),
    onDuplicate: vi.fn(),
    ...overrides,
  };
}

/** 等待 React 状态更新和 Portal 渲染 */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 用鼠标事件序列打开 Radix DropdownMenu */
function openMenu(container: HTMLElement) {
  const trigger = container.querySelector("button")!;
  act(() => {
    // Radix 监听 pointerdown；jsdom 中我们用 MouseEvent 替代（已 polyfill）
    trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
  });
}

/** 在搜索框输入文字（直接操作 React state 通过事件） */
function typeInSearch(text: string) {
  const input = document.querySelector('input[aria-label="搜索菜单命令"]') as HTMLInputElement | null;
  if (!input) return;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 获取搜索框 */
function getSearchInput(): HTMLInputElement | null {
  return document.querySelector('input[aria-label="搜索菜单命令"]');
}

/** 获取所有可见的选项 */
function getVisibleOptions(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[role="option"]')) as HTMLElement[];
}

/** 获取 aria-selected=true 的选项 */
function getActiveOption(): HTMLElement | null {
  return document.querySelector('[role="option"][aria-selected="true"]');
}

/** 触发键盘事件 */
function dispatchKey(key: string, options: KeyboardEventInit = {}) {
  const input = getSearchInput();
  if (!input) return;
  act(() => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
  });
}

describe("NotePageMenu", () => {
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
    // 清理 portal 内容
    document.body.querySelectorAll("[data-radix-popper-content-wrapper]").forEach((el) => el.remove());
    document.body.querySelectorAll("[data-radix-dropdown-menu-content]").forEach((el) => el.remove());
    document.body.querySelectorAll('[role="option"]').forEach((el) => el.remove());
    document.body.querySelectorAll('input[aria-label="搜索菜单命令"]').forEach((el) => el.remove());
    vi.clearAllMocks();
  });

  describe("初始渲染", () => {
    it("渲染更多按钮（trigger）", () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      const button = container.querySelector("button");
      expect(button).toBeTruthy();
      expect(button!.getAttribute("title")).toBe("更多");
    });
  });

  describe("菜单打开与搜索", () => {
    it("打开后显示搜索输入框和原分组顺序的所有选项", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const input = getSearchInput();
      expect(input).toBeTruthy();
      expect(input!.placeholder).toBe("搜索命令...");

      // 空查询显示所有选项（2 显示开关 + 3 字体 + 1 小字号 + 3 操作 = 9 项，无 onToggleToc 时为 8 项）
      const options = getVisibleOptions();
      expect(options).toHaveLength(8);

      // 验证原分组顺序（页面显示 → 字体 → 小字号 → 操作）
      expect(options[0].textContent).toContain("固定宽度");
      expect(options[1].textContent).toContain("默认");
      expect(options[2].textContent).toContain("衬线体");
      expect(options[3].textContent).toContain("等宽体");
      expect(options[4].textContent).toContain("小字号");
      expect(options[5].textContent).toContain("拷贝链接");
      expect(options[6].textContent).toContain("拷贝页面内容");
      expect(options[7].textContent).toContain("创建副本");
    });

    it("搜索框自动获得焦点", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      expect(document.activeElement).toBe(getSearchInput());
    });

    it("分组标签显示正确（字体分组）", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      expect(document.body.textContent).toContain("字体");
    });
  });

  describe("搜索过滤", () => {
    it("输入关键词后过滤匹配项", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();
      typeInSearch("链接");
      await flush();

      const options = getVisibleOptions();
      expect(options.length).toBeGreaterThanOrEqual(1);
      expect(options.some((o) => o.textContent!.includes("拷贝链接"))).toBe(true);
      expect(options.some((o) => o.textContent!.includes("衬线体"))).toBe(false);
    });

    it("搜索多个匹配项时保留分组", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();
      typeInSearch("拷");
      await flush();

      const options = getVisibleOptions();
      expect(options.some((o) => o.textContent!.includes("拷贝链接"))).toBe(true);
      expect(options.some((o) => o.textContent!.includes("拷贝页面内容"))).toBe(true);
      expect(options.some((o) => o.textContent!.includes("默认"))).toBe(false);
    });

    it("无匹配结果时显示空状态", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();
      typeInSearch("zzzz不存在的内容");
      await flush();

      const options = getVisibleOptions();
      expect(options).toHaveLength(0);
      expect(document.body.textContent).toContain("没有匹配的命令");
    });

    it("搜索不区分大小写", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();
      typeInSearch("COPY");
      await flush();

      const options = getVisibleOptions();
      expect(options.length).toBeGreaterThanOrEqual(2);
    });

    it("清空搜索后恢复显示所有项", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();
      typeInSearch("链接");
      await flush();
      expect(getVisibleOptions().length).toBe(1);

      typeInSearch("");
      await flush();
      expect(getVisibleOptions()).toHaveLength(8);
    });
  });

  describe("键盘导航", () => {
    it("默认第一项选中", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const active = getActiveOption();
      expect(active).toBeTruthy();
      expect(active!.textContent).toContain("固定宽度");
    });

    it("ArrowDown 向下移动选中项", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      dispatchKey("ArrowDown");
      expect(getActiveOption()!.textContent).toContain("默认");

      dispatchKey("ArrowDown");
      expect(getActiveOption()!.textContent).toContain("衬线体");
    });

    it("ArrowUp 向上移动选中项", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      dispatchKey("ArrowDown");
      dispatchKey("ArrowDown");
      expect(getActiveOption()!.textContent).toContain("衬线体");

      dispatchKey("ArrowUp");
      expect(getActiveOption()!.textContent).toContain("默认");
    });

    it("ArrowDown 在最后一项时不越界", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      for (let i = 0; i < 20; i++) {
        dispatchKey("ArrowDown");
      }
      const active = getActiveOption();
      expect(active).toBeTruthy();
      expect(active!.textContent).toContain("创建副本");
    });

    it("ArrowUp 在第一项时不越界", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      dispatchKey("ArrowUp");
      dispatchKey("ArrowUp");
      const active = getActiveOption();
      expect(active!.textContent).toContain("固定宽度");
    });

    it("搜索后 activeIndex 重置到第一项", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      dispatchKey("ArrowDown");
      dispatchKey("ArrowDown");
      dispatchKey("ArrowDown");
      expect(getActiveOption()!.textContent).toContain("等宽体");

      typeInSearch("副");
      await flush();
      const options = getVisibleOptions();
      expect(options).toHaveLength(1);
      expect(getActiveOption()!.textContent).toContain("创建副本");
    });
  });

  describe("Enter 执行", () => {
    it("Enter 执行当前选中项（action 类型）并关闭菜单", async () => {
      const onCopyLink = vi.fn();
      const props = createProps({ onCopyLink });
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      // "拷贝链接" 是第 6 项（索引 5，0-based）
      for (let i = 0; i < 5; i++) {
        dispatchKey("ArrowDown");
      }
      expect(getActiveOption()!.textContent).toContain("拷贝链接");

      dispatchKey("Enter");
      await flush();

      expect(onCopyLink).toHaveBeenCalledTimes(1);
      expect(getSearchInput()).toBeNull();
    });

    it("Enter 在 toggle 类型上执行回调但不关闭菜单", async () => {
      const onToggleSmallFont = vi.fn();
      const props = createProps({ onToggleSmallFont });
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      // "小字号" 是第 5 项（索引 4）
      for (let i = 0; i < 4; i++) {
        dispatchKey("ArrowDown");
      }
      expect(getActiveOption()!.textContent).toContain("小字号");

      dispatchKey("Enter");

      expect(onToggleSmallFont).toHaveBeenCalledTimes(1);
      expect(getSearchInput()).toBeTruthy();
    });

    it("Enter 在 radio 类型（字体）上执行回调但不关闭菜单", async () => {
      const onFontChange = vi.fn();
      const props = createProps({ onFontChange });
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      // "衬线体" 是第 3 项（索引 2）
      dispatchKey("ArrowDown");
      dispatchKey("ArrowDown");
      expect(getActiveOption()!.textContent).toContain("衬线体");

      dispatchKey("Enter");

      expect(onFontChange).toHaveBeenCalledTimes(1);
      expect(onFontChange).toHaveBeenCalledWith("serif");
      expect(getSearchInput()).toBeTruthy();
    });

    it("Enter 在空结果时不执行任何回调", async () => {
      const onCopyLink = vi.fn();
      const props = createProps({ onCopyLink });
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();
      typeInSearch("zzzzzzz");
      await flush();

      dispatchKey("Enter");
      expect(onCopyLink).not.toHaveBeenCalled();
    });
  });

  describe("鼠标交互", () => {
    it("点击 toggle 项执行回调但不关闭菜单", async () => {
      const onToggleFullWidth = vi.fn();
      const props = createProps({ onToggleFullWidth });
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const options = getVisibleOptions();
      const fullWidthOption = options.find((o) => o.textContent!.includes("固定宽度"))!;
      act(() => {
        fullWidthOption.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(onToggleFullWidth).toHaveBeenCalledTimes(1);
      expect(getSearchInput()).toBeTruthy();
    });

    it("点击 action 项执行回调并关闭菜单", async () => {
      const onDuplicate = vi.fn();
      const props = createProps({ onDuplicate });
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const options = getVisibleOptions();
      const dupOption = options.find((o) => o.textContent!.includes("创建副本"))!;
      act(() => {
        dupOption.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await flush();

      expect(onDuplicate).toHaveBeenCalledTimes(1);
      expect(getSearchInput()).toBeNull();
    });

    it("鼠标悬停改变选中项", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const options = getVisibleOptions();
      // 默认第一项高亮
      expect(getActiveOption()).toBe(options[0]);

      const copyContentOption = options.find((o) => o.textContent!.includes("拷贝页面内容"))!;
      act(() => {
        copyContentOption.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      });

      expect(getActiveOption()).toBe(copyContentOption);
    });
  });

  describe("开关状态显示", () => {
    it("当前选中的字体显示勾选标记", async () => {
      const props = createProps({ font: "serif" });
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const options = getVisibleOptions();
      const serifOption = options.find((o) => o.textContent!.includes("衬线体"))!;
      const checkArea = serifOption.querySelector("span.absolute");
      expect(checkArea).toBeTruthy();
      const checkSvg = checkArea!.querySelector("svg");
      expect(checkSvg).toBeTruthy();
    });

    it("固定宽度开启时显示勾选标记", async () => {
      const props = createProps({ fullWidth: true });
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const options = getVisibleOptions();
      const fullWidthOption = options.find((o) => o.textContent!.includes("固定宽度"))!;
      const checkArea = fullWidthOption.querySelector("span.absolute");
      expect(checkArea).toBeTruthy();
      const checkSvg = checkArea!.querySelector("svg");
      expect(checkSvg).toBeTruthy();
    });

    it("小字号开启时显示勾选标记", async () => {
      const props = createProps({ smallFont: true });
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const options = getVisibleOptions();
      const smallFontOption = options.find((o) => o.textContent!.includes("小字号"))!;
      const checkArea = smallFontOption.querySelector("span.absolute");
      expect(checkArea).toBeTruthy();
      const checkSvg = checkArea!.querySelector("svg");
      expect(checkSvg).toBeTruthy();
    });

    it("未选中项不显示勾选标记", async () => {
      const props = createProps({ font: "default" });
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const options = getVisibleOptions();
      const serifOption = options.find((o) => o.textContent!.includes("衬线体"))!;
      const checkArea = serifOption.querySelector("span.absolute");
      const checkSvg = checkArea!.querySelector("svg");
      expect(checkSvg).toBeNull();
    });
  });

  describe("快捷键显示", () => {
    // ⌘L/⌘D 曾是纯装饰标注（未绑定任何按键且与浏览器快捷键冲突），已移除
    it("拷贝链接不显示未绑定的假快捷键", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const options = getVisibleOptions();
      const copyLinkOption = options.find((o) => o.textContent!.includes("拷贝链接"))!;
      expect(copyLinkOption.textContent).not.toContain("⌘L");
    });

    it("创建副本不显示未绑定的假快捷键", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const options = getVisibleOptions();
      const dupOption = options.find((o) => o.textContent!.includes("创建副本"))!;
      expect(dupOption.textContent).not.toContain("⌘D");
    });
  });

  describe("回调复用", () => {
    it("radio/toggle 项直接调用传入的回调，不复制逻辑", async () => {
      const onFontChange = vi.fn();
      const onToggleSmallFont = vi.fn();
      const onToggleFullWidth = vi.fn();
      const props = createProps({
        onFontChange,
        onToggleSmallFont,
        onToggleFullWidth,
      });
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const options = getVisibleOptions();

      // 固定宽度 toggle - 点击后不关闭菜单
      act(() => { options[0].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(onToggleFullWidth).toHaveBeenCalledTimes(1);
      onToggleFullWidth.mockClear();

      act(() => { options[1].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(onFontChange).toHaveBeenCalledWith("default");
      onFontChange.mockClear();

      act(() => { options[2].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(onFontChange).toHaveBeenCalledWith("serif");
      onFontChange.mockClear();

      act(() => { options[3].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(onFontChange).toHaveBeenCalledWith("mono");
      onFontChange.mockClear();

      act(() => { options[4].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(onToggleSmallFont).toHaveBeenCalledTimes(1);
    });
  });

  describe("页面目录开关", () => {
    it("传入 onToggleToc 时显示目录开关项并响应点击", async () => {
      const onToggleToc = vi.fn();
      const props = createProps({ onToggleToc, tocOpen: false });
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const options = getVisibleOptions();
      expect(options).toHaveLength(9);
      const tocOption = options.find((o) => o.textContent!.includes("页面目录"))!;
      expect(tocOption).toBeTruthy();

      act(() => { tocOption.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(onToggleToc).toHaveBeenCalledTimes(1);
      // toggle 类型不关闭菜单
      expect(getSearchInput()).toBeTruthy();
    });

    it("不传 onToggleToc 时不显示目录开关项", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const options = getVisibleOptions();
      expect(options.some((o) => o.textContent!.includes("页面目录"))).toBe(false);
    });

    it("目录开启时显示勾选标记", async () => {
      const props = createProps({ onToggleToc: vi.fn(), tocOpen: true });
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      const options = getVisibleOptions();
      const tocOption = options.find((o) => o.textContent!.includes("页面目录"))!;
      const checkSvg = tocOption.querySelector("span.absolute svg");
      expect(checkSvg).toBeTruthy();
    });
  });

  describe("页面信息", () => {
    it("传入统计信息时在菜单底部展示", async () => {
      const props = createProps({
        wordCount: 160,
        blockCount: 6,
        lastEditedAt: new Date("2026-08-27T15:29:00"),
      });
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      expect(document.body.textContent).toContain("字数统计: 160");
      expect(document.body.textContent).toContain("块数统计: 6");
      expect(document.body.textContent).toContain("最后编辑于");
    });

    it("不传统计信息时不渲染底部区域", async () => {
      const props = createProps();
      act(() => root.render(createElement(NotePageMenu, props)));
      openMenu(container);
      await flush();

      expect(document.body.textContent).not.toContain("字数统计");
      expect(document.body.textContent).not.toContain("块数统计");
    });
  });
});
