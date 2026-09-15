"use client"

import { useEffect } from 'react';

export type ThemeColor = 'orange' | 'blue' | 'green' | 'purple' | 'pink';

interface ThemeColorConfig {
  primary: string;
  primaryFg: string;
  ring: string;
  accent: string;
  accentFg: string;
  /** 品牌安全文本色（light）：小字号正文用，须对页面底/primary/10 tint 底 ≥4.5:1 */
  primaryText: string;
  primaryDark: string;
  primaryFgDark: string;
  /** 品牌安全文本色（dark）：对暗色页面底/暗 tint 底 ≥4.5:1 */
  primaryTextDark: string;
  ringDark: string;
  accentDark: string;
  accentFgDark: string;
}

const COLORS: Record<ThemeColor, ThemeColorConfig> = {
  // D02：默认 orange 采用「安静的知识工作台」陶土橙（#A4472B / 暗 #E39B7F）；
  // 其余四色仍只影响品牌/焦点（导航选中保持中性，规格 §4）。
  // C02：primaryText/primaryFg 为 WCAG AA 派生值（小字文本 ≥4.5:1），
  // 契约由 hooks/use-theme-color.test.ts 用对比度断言钉住——改任何值先跑该测试。
  orange: {
    primary: '14 58% 41%',
    primaryFg: '0 0% 98%',
    ring: '14 58% 41%',
    accent: '16 40% 94%',
    accentFg: '14 58% 30%',
    primaryText: '14 58% 41%',
    primaryDark: '17 64% 69%',
    primaryFgDark: '24 18% 11%',
    primaryTextDark: '17 64% 69%',
    ringDark: '17 64% 69%',
    accentDark: '14 20% 22%',
    accentFgDark: '17 64% 85%',
  },
  blue: {
    primary: '220 85% 50%',
    primaryFg: '0 0% 98%',
    ring: '220 85% 50%',
    accent: '220 70% 95%',
    accentFg: '220 80% 25%',
    primaryText: '220 85% 50%',
    primaryDark: '220 85% 60%',
    primaryFgDark: '220 15% 10%',
    primaryTextDark: '220 85% 64%',
    ringDark: '220 85% 60%',
    accentDark: '220 30% 22%',
    accentFgDark: '220 70% 85%',
  },
  green: {
    primary: '145 65% 40%',
    // 光模式 primary(#24A85B) 对白仅 3.07:1，文本与 fg 均降亮度：
    // primaryText 145/65/28 → tint 底 5.1:1；primaryFg 近黑绿 → primary 底 5.4:1
    primaryFg: '145 30% 10%',
    ring: '145 65% 40%',
    accent: '145 50% 94%',
    accentFg: '145 70% 20%',
    primaryText: '145 65% 28%',
    primaryDark: '145 65% 45%',
    primaryFgDark: '145 15% 8%',
    primaryTextDark: '145 65% 45%',
    ringDark: '145 65% 45%',
    accentDark: '145 30% 20%',
    accentFgDark: '145 60% 85%',
  },
  purple: {
    primary: '270 70% 55%',
    primaryFg: '0 0% 98%',
    ring: '270 70% 55%',
    accent: '270 60% 96%',
    accentFg: '270 70% 30%',
    primaryText: '270 70% 52%',
    primaryDark: '270 70% 60%',
    // 暗模式 primaryDark(#9952E0) 亮度上限使近黑 tint 也只能到 ~4.4:1，取纯黑（4.6:1）
    primaryFgDark: '0 0% 0%',
    primaryTextDark: '270 70% 70%',
    ringDark: '270 70% 60%',
    accentDark: '270 30% 22%',
    accentFgDark: '270 70% 85%',
  },
  pink: {
    primary: '340 75% 55%',
    // 光模式 primary(#E23670) 对白 4.2:1 不达 AA 小字，文本与 fg 均降亮度：
    // primaryText 340/75/40 → tint 底 5.8:1；primaryFg 近黑玫 → primary 底 4.7:1。
    // 已知边界：hover:bg-primary/90 变亮后白字降至 ~4.46:1（紫/粉品牌背景死区，
    // 瞬态态 axe 不可扫；需背景色本身调整才能消除，见账本 C02 行）
    primaryFg: '340 25% 4%',
    ring: '340 75% 55%',
    accent: '340 70% 96%',
    accentFg: '340 80% 30%',
    primaryText: '340 75% 40%',
    primaryDark: '340 75% 60%',
    primaryFgDark: '340 15% 10%',
    primaryTextDark: '340 75% 66%',
    ringDark: '340 75% 60%',
    accentDark: '340 30% 22%',
    accentFgDark: '340 70% 85%',
  },
};

const STORAGE_KEY = 'organize:theme-color';

export function applyThemeColor(color: ThemeColor) {
  const c = COLORS[color];
  if (!c) return;
  const root = document.documentElement;
  const isDark = root.classList.contains('dark');
  root.style.setProperty('--primary', isDark ? c.primaryDark : c.primary);
  root.style.setProperty('--primary-foreground', isDark ? c.primaryFgDark : c.primaryFg);
  root.style.setProperty('--primary-text', isDark ? c.primaryTextDark : c.primaryText);
  root.style.setProperty('--ring', isDark ? c.ringDark : c.ring);
  // D02 规格 §4：hover/选中底色一律中性（globals 的 --accent 保持中性值，
  // 不再随品牌覆盖）；品牌色只作用于主动作（primary）与焦点（ring）。
  localStorage.setItem(STORAGE_KEY, color);
}

export function getThemeColor(): ThemeColor {
  if (typeof window === 'undefined') return 'orange';
  return (localStorage.getItem(STORAGE_KEY) as ThemeColor) || 'orange';
}

export function useThemeColor() {
  useEffect(() => {
    const saved = getThemeColor();
    applyThemeColor(saved);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'class'
        ) {
          const currentColor = getThemeColor();
          applyThemeColor(currentColor);
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);
}

export { COLORS as THEME_COLORS };
