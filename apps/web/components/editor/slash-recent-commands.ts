/**
 * 斜杠菜单「最近使用」：按浏览器本地保存最近执行过的区块命令 id（最多 5 个，最近在前）。
 * 只是偏好记忆，不参与文档保存；存储不可用（隐私模式 / 配额满）时静默降级为无记录。
 */
export const SLASH_RECENT_STORAGE_KEY = "organize:slash-recent-commands:v1";
export const SLASH_RECENT_LIMIT = 5;

export function readRecentSlashCommands(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SLASH_RECENT_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    const ids: string[] = [];
    for (const entry of value) {
      if (typeof entry === "string" && entry && !ids.includes(entry)) ids.push(entry);
      if (ids.length >= SLASH_RECENT_LIMIT) break;
    }
    return ids;
  } catch {
    return [];
  }
}

export function rememberSlashCommand(id: string): void {
  if (!id) return;
  try {
    const next = [id, ...readRecentSlashCommands().filter((entry) => entry !== id)].slice(0, SLASH_RECENT_LIMIT);
    localStorage.setItem(SLASH_RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存储被禁用或已满：最近使用只是便利功能，不阻断命令执行
  }
}

/**
 * 按最近顺序从候选里挑出可展示的命令：候选已经是「当前上下文可用且未被 AI 配置置灰」的集合，
 * 不在候选里的 id（嵌套场景不支持 / AI 未配置 / 插件已停用）直接跳过。
 */
export function pickRecentCommands<T extends { id: string }>(recentIds: readonly string[], candidates: readonly T[], limit = SLASH_RECENT_LIMIT): T[] {
  const picked: T[] = [];
  for (const id of recentIds) {
    const command = candidates.find((candidate) => candidate.id === id);
    if (command && !picked.includes(command)) picked.push(command);
    if (picked.length >= limit) break;
  }
  return picked;
}
