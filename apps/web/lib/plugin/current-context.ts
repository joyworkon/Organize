import type { ReadingItem } from "@organize/shared";

/**
 * 当前阅读条目 provider：阅读详情页在挂载时写入、卸载时清空，
 * 插件 ctx.getCurrentItem() 从这里读取。
 *
 * 模块级单状态即可——用户同一时刻只可能处于一个阅读详情页。
 * 纯 TS 实现，可单测。
 */

let currentItem: ReadingItem | null = null;

export function setCurrentReadingItem(item: ReadingItem | null): void {
  currentItem = item;
}

export function getCurrentReadingItem(): ReadingItem | null {
  return currentItem;
}
