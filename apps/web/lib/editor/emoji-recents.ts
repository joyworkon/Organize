/**
 * emoji 建议「最近使用」：按浏览器本地保存最近插入过的 emoji（最多 8 个，最近在前）。
 * 只是偏好记忆，不参与文档保存；存储不可用（隐私模式 / 配额满）时静默降级为无记录。
 */
export const EMOJI_RECENTS_STORAGE_KEY = "organize:emoji-recents:v1";
export const EMOJI_RECENTS_LIMIT = 8;

export function readRecentEmojis(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(EMOJI_RECENTS_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    const emojis: string[] = [];
    for (const entry of value) {
      if (typeof entry === "string" && entry && !emojis.includes(entry)) emojis.push(entry);
      if (emojis.length >= EMOJI_RECENTS_LIMIT) break;
    }
    return emojis;
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string): void {
  if (!emoji) return;
  try {
    const next = [emoji, ...readRecentEmojis().filter((entry) => entry !== emoji)].slice(0, EMOJI_RECENTS_LIMIT);
    localStorage.setItem(EMOJI_RECENTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存储被禁用或已满：最近使用只是便利功能，不阻断插入
  }
}
