// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasTextMeasurer } from "./text-measurer";

const style = { fontSizePx: 28, lineHeight: 1.3, bold: true, align: "left" as const, colorKey: "" };

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("画布测量缓存与最后一行", () => {
  it("同长文只修改中段换行也必须重测，不能复用旧高度", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return { height: (this.textContent!.split("\n").length) * 36.4 } as DOMRect;
    });
    const measurer = new CanvasTextMeasurer();
    const prefix = "前".repeat(32);
    const suffix = "后".repeat(32);
    expect(measurer.measure(prefix + "中".repeat(32) + suffix, "title", style, 500)).toBe(37);
    expect(measurer.measure(prefix + "\n".repeat(32) + suffix, "title", style, 500)).toBe(1202);
    expect(rect).toHaveBeenCalledTimes(2);
  });

  it("末尾换行保留光标所在空行，空大标题也有一行的高度", () => {
    const samples: string[] = [];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      samples.push(this.textContent!);
      return { height: this.textContent!.split("\n").length * 36.4 } as DOMRect;
    });
    const measurer = new CanvasTextMeasurer();
    expect(measurer.measure("", "title", style, 300)).toBe(37);
    expect(measurer.measure("标题\n", "title", style, 300)).toBe(73);
    expect(samples).toEqual(["\u200b", "标题\n\u200b"]);
  });

  it("临界宽度不量化缓存，完全相同的请求复用缓存", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 36.4 } as DOMRect);
    const measurer = new CanvasTextMeasurer();
    measurer.measure("一行文字", "title", style, 100.1);
    measurer.measure("一行文字", "title", style, 100.1);
    expect(rect).toHaveBeenCalledTimes(1);
    measurer.measure("一行文字", "title", style, 100.2);
    expect(rect).toHaveBeenCalledTimes(2);
  });
});
