import { describe, expect, it } from "vitest";
import { THEME_COLORS } from "./use-theme-color";

// C02 品牌安全文本 token 契约：use-theme-color.ts 里每个品牌的
// primaryText / primaryFg（含 dark 侧）必须满足 WCAG AA 小字文本 ≥4.5:1。
// 背景取值镜像 app/globals.css 的 --primary/--background token；
// bg-primary/10 类 tint 按浏览器 sRGB 逐通道 alpha 合成模拟。
// 调整任何品牌色值前先看此测试，避免回归 axe color-contrast 违规。

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as [number, number, number];
}

// 解析 THEME_COLORS 里的 "H S% L%" 形态
function parseHsl(value: string): [number, number, number] {
  const m = value.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!m) throw new Error(`无法解析 HSL: ${value}`);
  return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
}

function relativeLuminance(rgb: [number, number, number]): number {
  const lin = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// bg-primary/10 在浏览器中的合成：sRGB 逐通道 alpha 混合
function tintOver(rgb: [number, number, number], base: [number, number, number], alpha = 0.1): [number, number, number] {
  return rgb.map((c, i) => Math.round(c * alpha + base[i] * (1 - alpha))) as [number, number, number];
}

// 镜像 app/globals.css 的 --background（改动时两边同步）
const PAGE_LIGHT = hslToRgb(45, 22, 96);
const PAGE_DARK = hslToRgb(120, 3, 10);
const WHITE = hslToRgb(0, 0, 100);

describe("品牌安全文本 token 对比度契约", () => {
  const brands = Object.entries(THEME_COLORS);

  it("覆盖全部五个品牌", () => {
    expect(brands.map(([name]) => name)).toEqual(["orange", "blue", "green", "purple", "pink"]);
  });

  it.each(brands)("%s：light 模式 primaryText 对白底/页面底/primary tint 底 ≥4.5", (_name, c) => {
    const text = parseHsl(c.primaryText);
    const primary = parseHsl(c.primary);
    expect(contrast(text, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, PAGE_LIGHT)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text, tintOver(primary, PAGE_LIGHT))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(brands)("%s：light 模式 primaryFg 对 primary 底 ≥4.5（resting 态契约）", (_name, c) => {
    const fg = parseHsl(c.primaryFg);
    const primary = parseHsl(c.primary);
    // 不含 hover:bg-primary/90 变亮组合：purple/white 在该瞬态下 4.46:1，
    // 背景亮度死区内无解（见 use-theme-color.ts pink 段注释与账本 C02 行）
    expect(contrast(fg, primary)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(brands)("%s：dark 模式 primaryTextDark 对暗页面底/暗 tint 底 ≥4.5", (_name, c) => {
    const textDark = parseHsl(c.primaryTextDark);
    const primaryDark = parseHsl(c.primaryDark);
    expect(contrast(textDark, PAGE_DARK)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(textDark, tintOver(primaryDark, PAGE_DARK))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(brands)("%s：dark 模式 primaryFgDark 对 primaryDark 底 ≥4.5", (_name, c) => {
    const fgDark = parseHsl(c.primaryFgDark);
    const primaryDark = parseHsl(c.primaryDark);
    expect(contrast(fgDark, primaryDark)).toBeGreaterThanOrEqual(4.5);
  });
});
