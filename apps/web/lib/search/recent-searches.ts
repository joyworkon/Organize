// 命令面板「最近搜索」的账号隔离存储（C02 同类候选收口）。
// 旧版本写入全局固定 key organize:recent-searches，跨账号残留上一账号的搜索词；
// 现按属主分 key（organize:recent-searches:<userId>），由会话桥
// components/session-owner-bridge.tsx 在会话就绪/变更时绑定或解绑属主，
// 并在会话变更时清掉升级前的无属主旧数据。属主未绑定（会话未就绪/已登出）时不读不写，
// 各用户的历史记录只落在其自己的 key 下，换人/登出即不可见。

export const MAX_RECENT_SEARCHES = 5;

const KEY_PREFIX = "organize:recent-searches:";
const LEGACY_KEY = "organize:recent-searches";

let boundOwnerId: string | null = null;

/** 命令面板与最近搜索共用的可搜索判定（≥2 字符，或单个 CJK 字符） */
export function isSearchableQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (trimmed.length >= 2) return true;
  return /[\u3400-\u9fff]/.test(trimmed);
}

function keyFor(ownerId: string): string {
  return `${KEY_PREFIX}${ownerId}`;
}

function removeLegacyKey() {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
}

/** 会话桥在登录/会话就绪时调用：绑定属主并清掉升级前无属主旧数据；同一用户幂等 */
export function bindRecentSearchesOwner(userId: string): void {
  boundOwnerId = userId;
  removeLegacyKey();
}

/** 会话桥在登出时调用：解绑属主（列表即空）；各用户分属数据保留，等本人再登录取回 */
export function unbindRecentSearchesOwner(): void {
  boundOwnerId = null;
  removeLegacyKey();
}

export function getRecentSearches(): string[] {
  if (typeof localStorage === "undefined" || !boundOwnerId) return [];
  try {
    const stored = localStorage.getItem(keyFor(boundOwnerId));
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function saveRecentSearch(query: string): void {
  if (typeof localStorage === "undefined" || !boundOwnerId) return;
  const normalized = query.trim();
  if (!isSearchableQuery(normalized)) return;
  try {
    const recent = getRecentSearches().filter((s) => s !== normalized);
    recent.unshift(normalized);
    localStorage.setItem(
      keyFor(boundOwnerId),
      JSON.stringify(recent.slice(0, MAX_RECENT_SEARCHES))
    );
  } catch {
    // ignore
  }
}

export function clearRecentSearches(): void {
  if (typeof localStorage === "undefined" || !boundOwnerId) return;
  try {
    localStorage.removeItem(keyFor(boundOwnerId));
  } catch {
    // ignore
  }
}
