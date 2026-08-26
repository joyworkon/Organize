import { describe, expect, it } from "vitest";
import { detectPlatform } from "./detect";

describe("detectPlatform", () => {
  it("空环境判定为 web", () => {
    expect(detectPlatform({})).toBe("web");
  });

  it("带 __TAURI_INTERNALS__ 标记判定为 tauri", () => {
    expect(detectPlatform({ __TAURI_INTERNALS__: { invoke: () => {} } })).toBe("tauri");
  });

  it("Capacitor.isNativePlatform() 为 true 判定为 capacitor", () => {
    expect(detectPlatform({ Capacitor: { isNativePlatform: () => true } })).toBe("capacitor");
  });

  it("Capacitor.isNativePlatform() 为 false（浏览器里的 Capacitor）判定为 web", () => {
    expect(detectPlatform({ Capacitor: { isNativePlatform: () => false } })).toBe("web");
  });

  it("Capacitor 对象异常时按 web 处理", () => {
    expect(
      detectPlatform({
        Capacitor: {
          isNativePlatform: () => {
            throw new Error("broken bridge");
          },
        },
      })
    ).toBe("web");
  });

  it("tauri 标记优先于 capacitor（两标记共存不可能，但语义上桌面壳优先）", () => {
    expect(
      detectPlatform({
        __TAURI_INTERNALS__: {},
        Capacitor: { isNativePlatform: () => true },
      })
    ).toBe("tauri");
  });
});
