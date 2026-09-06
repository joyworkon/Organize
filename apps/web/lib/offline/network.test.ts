import { afterEach, describe, expect, it, vi } from "vitest";
import { isOnline } from "./network";

/**
 * F06 回归：Node 22 下全局 navigator 存在但 onLine 为 undefined，
 * isOnline 必须仍然返回布尔值（SSR 与浏览器首帧一致按在线处理），
 * 否则离线状态节点在首屏产生水合不一致。
 */
describe("isOnline（F06 Node 22 水合）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Node 22 语义：navigator 存在但 onLine 为 undefined 时按在线处理且返回 boolean", () => {
    // vitest node 环境本身就是 Node 22：navigator 为对象、onLine 为 undefined
    expect(typeof navigator).toBe("object");
    expect((globalThis.navigator as unknown as { onLine?: unknown }).onLine).toBeUndefined();
    const result = isOnline();
    expect(result).toBe(true);
    expect(typeof result).toBe("boolean");
  });

  it("navigator 整体缺失（旧 Node / 非 DOM 运行时）时按在线处理", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isOnline()).toBe(true);
  });

  it("浏览器语义：镜像 navigator.onLine 的布尔值", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(isOnline()).toBe(false);

    vi.stubGlobal("navigator", { onLine: true });
    expect(isOnline()).toBe(true);
  });

  it("onLine 为非布尔脏值时不透传（返回在线快照）", () => {
    vi.stubGlobal("navigator", { onLine: undefined });
    expect(isOnline()).toBe(true);
  });
});
