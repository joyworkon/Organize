import type { ReadingStatus } from "@organize/shared";

/** 阅读状态三态循环：unread → reading → read → unread */
export function cycleStatus(current: ReadingStatus): ReadingStatus {
  const order: ReadingStatus[] = ["unread", "reading", "read"];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length];
}

/** 从 URL 提取主机名（去掉 www. 前缀），非法 URL 返回空串 */
export function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
