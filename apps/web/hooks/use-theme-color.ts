"use client"

import { useEffect } from 'react';

/**
 * 单一中性主色，镜像 DESIGN.md 与 globals.css。
 * inline 仍负责明暗切换；不能让旧品牌色覆盖已接入的语义色。
 * 主动作、文字与焦点在明暗两套表面均须通过对比度契约。
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
  primary: '0 0% 12.55%',
  primaryFg: '0 0% 100%',
  ring: '0 0% 12.55%',
  primaryText: '0 0% 12.55%',
  primaryDark: '0 0% 93.33%',
  primaryFgDark: '0 0% 9.8%',
  primaryTextDark: '0 0% 93.33%',
  ringDark: '0 0% 93.33%',
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
