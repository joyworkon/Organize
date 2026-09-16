// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readThemeMode,
  resolveDark,
  setThemeMode,
  systemPrefersDark,
} from "./use-theme-mode";

// 明暗模式契约：设置页「外观」分区与侧栏按钮共用这套状态。
// 关键点是存储语义——键不存在 = 跟随系统（沿用改版前 theme-toggle 的语义），
// 因此「选择跟随系统」必须删键而不是写 "system"，否则老版本读到未知值会当成亮色。

function mockPrefersDark(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  mockPrefersDark(false);
});

afterEach(() => {
  window.localStorage.clear();
});

describe("use-theme-mode 存储语义", () => {
  it("未写入过时是「跟随系统」档", () => {
    expect(readThemeMode()).toBe("system");
  });

  it("非法历史值当作跟随系统，不会卡在坏状态", () => {
    window.localStorage.setItem("organize-theme", "solarized");
    expect(readThemeMode()).toBe("system");
  });

  it("显式选择亮/暗写入原键，可被旧代码读懂", () => {
    setThemeMode("dark");
    expect(window.localStorage.getItem("organize-theme")).toBe("dark");
    expect(readThemeMode()).toBe("dark");

    setThemeMode("light");
    expect(window.localStorage.getItem("organize-theme")).toBe("light");
    expect(readThemeMode()).toBe("light");
  });

  it("选择「跟随系统」是删键，而不是写入 system 字面量", () => {
    setThemeMode("dark");
    setThemeMode("system");
    expect(window.localStorage.getItem("organize-theme")).toBeNull();
    expect(readThemeMode()).toBe("system");
  });

  it("写入后广播事件，侧栏按钮与设置页分区据此同步", () => {
    const seen = vi.fn();
    window.addEventListener("organize:theme-mode-change", seen);
    setThemeMode("dark");
    setThemeMode("system");
    window.removeEventListener("organize:theme-mode-change", seen);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe("use-theme-mode 明暗解析", () => {
  it("跟随系统档跟着系统偏好走", () => {
    mockPrefersDark(true);
    expect(systemPrefersDark()).toBe(true);
    expect(resolveDark("system")).toBe(true);

    mockPrefersDark(false);
    expect(resolveDark("system")).toBe(false);
  });

  it("显式档不受系统偏好影响", () => {
    mockPrefersDark(true);
    expect(resolveDark("light")).toBe(false);
    mockPrefersDark(false);
    expect(resolveDark("dark")).toBe(true);
  });
});
