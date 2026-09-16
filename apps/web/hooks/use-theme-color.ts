"use client"

import { useEffect } from 'react';

/**
 * 品牌色配置（单色）。
 *
 * 2026-09-16 起取消设置页的 5 色切换（orange/blue/green/purple/pink），
 * 全站只有这一套品牌色：石墨中性外壳上的石板蓝（亮 ≈#4D7096 / 暗 ≈#7595BB）。
 * 原 D02 陶土橙（#A4472B / #E39B7F）已随「石墨中性」外壳一并替换。
 * 品牌色只作用于主动作（primary）与焦点（ring）；hover/选中底色一律中性
 * （globals.css 的 --accent 保持中性值，D02 规格 §4），故此处不再有 accent 成对值。
 *
 * C02 契约：primaryText / primaryFg（含 dark 侧）须满足 WCAG AA 小字文本 ≥4.5:1，
 * 由 hooks/use-theme-color.test.ts 的对比度断言钉住——改任何色值先跑该测试。
 */
export interface BrandColorConfig {
  primary: string;
  primaryFg: string;
  ring: string;
  /** 品牌安全文本色（light）：小字号正文用，须对页面底/primary/10 tint 底 ≥4.5:1 */
  primaryText: string;
  primaryDark: string;
  primaryFgDark: string;
  /** 品牌安全文本色（dark）：对暗色页面底/暗 tint 底 ≥4.5:1 */
  primaryTextDark: string;
  ringDark: string;
}

export const BRAND_COLOR: BrandColorConfig = {
  primary: '215 32% 44.5%',
  primaryFg: '0 0% 100%',
  ring: '215 32% 44.5%',
  primaryText: '215 32% 44.5%',
  primaryDark: '215 29% 58%',
  primaryFgDark: '220 10% 10%',
  primaryTextDark: '215 29% 58%',
  ringDark: '215 29% 58%',
};

/**
 * 把品牌色按当前明暗态写成 inline CSS 变量。
 * inline 覆盖优先于 globals.css 的 :root/.dark 值——只改 CSS 文件不生效。
 */
export function applyThemeColor() {
  const root = document.documentElement;
  const isDark = root.classList.contains('dark');
  const c = BRAND_COLOR;
  root.style.setProperty('--primary', isDark ? c.primaryDark : c.primary);
  root.style.setProperty('--primary-foreground', isDark ? c.primaryFgDark : c.primaryFg);
  root.style.setProperty('--primary-text', isDark ? c.primaryTextDark : c.primaryText);
  root.style.setProperty('--ring', isDark ? c.ringDark : c.ring);
}

export function useThemeColor() {
  useEffect(() => {
    applyThemeColor();

    // 明暗切换（html class 变化）后必须重放——否则暗色下仍是亮色品牌值。
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          mutation.attributeName === 'class'
        ) {
          applyThemeColor();
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
