import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * N01 回归：笔记正文 Typography 变量映射到的语义 token，
 * 在亮色与暗色两套主题下都必须达到 WCAG AA 对比度
 * （普通文字 ≥ 4.5:1，参照 W3C contrast-minimum）。
 * token 值直接从 globals.css 解析，防止未来调色时无声跌破下限。
 */

const GLOBALS_PATH = path.join(__dirname, "../../app/globals.css");

function readTokens(): { light: Record<string, string>; dark: Record<string, string> } {
  const css = readFileSync(GLOBALS_PATH, "utf8");
  const darkStart = css.indexOf(".dark {");
  if (darkStart < 0) throw new Error("globals.css 中未找到 .dark 主题块");
  const lightCss = css.slice(0, darkStart);
  const darkCss = css.slice(darkStart);
  const pick = (source: string, name: string): string => {
    const m = source.match(new RegExp(`--${name}:\\s*([0-9.]+\\s+[0-9.]+%\\s+[0-9.]+%);`));
    if (!m) throw new Error(`globals.css 亮色区未找到 --${name}`);
    return m[1];
  };
  const pickDark = (name: string): string => {
    const m = darkCss.match(new RegExp(`--${name}:\\s*([0-9.]+\\s+[0-9.]+%\\s+[0-9.]+%);`));
    if (!m) throw new Error(`globals.css 暗色区未找到 --${name}`);
    return m[1];
  };
  return {
    light: {
      background: pick(lightCss, "background"),
      card: pick(lightCss, "card"),
      foreground: pick(lightCss, "foreground"),
      "muted-foreground": pick(lightCss, "muted-foreground"),
    },
    dark: {
      background: pickDark("background"),
      card: pickDark("card"),
      foreground: pickDark("foreground"),
      "muted-foreground": pickDark("muted-foreground"),
    },
  };
}

/** HSL("H S% L%") → sRGB [0..1]³ */
function hslToRgb(token: string): [number, number, number] {
  const [h, s, l] = token.trim().split(/\s+/).map((v) => parseFloat(v));
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    return c;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x 对比度 */
function contrast(a: string, b: string): number {
  const la = luminance(hslToRgb(a));
  const lb = luminance(hslToRgb(b));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe("正文排版对比度（N01）", () => {
  const tokens = readTokens();

  it.each([
    ["亮色", tokens.light],
    ["暗色", tokens.dark],
  ])("%s：正文/标题/加粗（foreground）在纸面上 ≥ 4.5:1", (_label, theme) => {
    expect(contrast(theme.foreground, theme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.foreground, theme.card)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["亮色", tokens.light],
    ["暗色", tokens.dark],
  ])("%s：辅助文本（muted-foreground：引用/题注/列表标记计数）≥ 4.5:1", (_label, theme) => {
    expect(contrast(theme["muted-foreground"], theme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme["muted-foreground"], theme.card)).toBeGreaterThanOrEqual(4.5);
  });

  it("globals.css 将 prose 变量映射到主题 token（而非固定灰）", () => {
    const css = readFileSync(GLOBALS_PATH, "utf8");
    expect(css).toContain("--tw-prose-body: hsl(var(--foreground))");
    expect(css).toContain("--tw-prose-headings: hsl(var(--foreground))");
    expect(css).toContain("--tw-prose-code: hsl(var(--foreground))");
    expect(css).toContain("--tw-prose-bullets: hsl(var(--muted-foreground))");
  });
});
