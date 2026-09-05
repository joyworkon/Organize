"use client"

import { useEffect } from 'react';

export type ThemeColor = 'orange' | 'blue' | 'green' | 'purple' | 'pink';

interface ThemeColorConfig {
  primary: string;
  primaryFg: string;
  ring: string;
  accent: string;
  accentFg: string;
  primaryDark: string;
  primaryFgDark: string;
  ringDark: string;
  accentDark: string;
  accentFgDark: string;
}

const COLORS: Record<ThemeColor, ThemeColorConfig> = {
  // D02：默认 orange 采用「安静的知识工作台」陶土橙（#A4472B / 暗 #E39B7F）；
  // 其余四色仍只影响品牌/焦点（导航选中保持中性，规格 §4）
  orange: {
    primary: '14 58% 41%',
    primaryFg: '0 0% 98%',
    ring: '14 58% 41%',
    accent: '16 40% 94%',
    accentFg: '14 58% 30%',
    primaryDark: '17 64% 69%',
    primaryFgDark: '24 18% 11%',
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
    primaryDark: '220 85% 60%',
    primaryFgDark: '220 15% 10%',
    ringDark: '220 85% 60%',
    accentDark: '220 30% 22%',
    accentFgDark: '220 70% 85%',
  },
  green: {
    primary: '145 65% 40%',
    primaryFg: '0 0% 98%',
    ring: '145 65% 40%',
    accent: '145 50% 94%',
    accentFg: '145 70% 20%',
    primaryDark: '145 65% 45%',
    primaryFgDark: '145 15% 8%',
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
    primaryDark: '270 70% 60%',
    primaryFgDark: '270 15% 10%',
    ringDark: '270 70% 60%',
    accentDark: '270 30% 22%',
    accentFgDark: '270 70% 85%',
  },
  pink: {
    primary: '340 75% 55%',
    primaryFg: '0 0% 98%',
    ring: '340 75% 55%',
    accent: '340 70% 96%',
    accentFg: '340 80% 30%',
    primaryDark: '340 75% 60%',
    primaryFgDark: '340 15% 10%',
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
