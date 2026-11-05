import { beforeEach, describe, expect, it, vi } from "vitest";

// 命令面板「最近搜索」按账号隔离（C02 同类候选登记项）：
// 存储按属主分 key，会话桥（session-owner-bridge）绑定/解绑属主。
// 节点环境无 localStorage，用内存 map 顶替，验证属主语义与容量/判定不变。

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
});

// 升级前全局固定 key 的真实名字，钉住旧数据清理契约
const LEGACY_KEY = "organize:recent-searches";

const {
  bindRecentSearchesOwner,
  unbindRecentSearchesOwner,
  getRecentSearches,
  saveRecentSearch,
  clearRecentSearches,
} = await import("./recent-searches");

beforeEach(() => {
  storage.clear();
  unbindRecentSearchesOwner();
});

describe("recent-searches 账号属主绑定", () => {
  it("属主未绑定（会话未就绪/已登出）时不读不写", () => {
    expect(getRecentSearches()).toEqual([]);

    saveRecentSearch("supabase");
    expect(getRecentSearches()).toEqual([]);
    expect(storage.size).toBe(0);
  });

  it("同账号重复绑定幂等：最近搜索保留", () => {
    bindRecentSearchesOwner("user-a");
    saveRecentSearch("supabase");
    saveRecentSearch("vitest");

    bindRecentSearchesOwner("user-a");
    expect(getRecentSearches()).toEqual(["vitest", "supabase"]);
  });

  it("换账号绑定：列表清空，不露出前一账号的关键词", () => {
    bindRecentSearchesOwner("user-a");
    saveRecentSearch("supabase");
    saveRecentSearch("vitest");

    bindRecentSearchesOwner("user-b");
    expect(getRecentSearches()).toEqual([]);

    // user-a 的记录仍归属其自己的 key，user-b 侧读不到
    const userAKey = [...storage.keys()].find(
      (key) => key.startsWith("organize:recent-searches:") && key.endsWith("user-a")
    );
    expect(userAKey).toBeDefined();
    expect(JSON.parse(storage.get(userAKey!)!)).toEqual(["vitest", "supabase"]);
  });

  it("登出清空当前列表；同一账号再登录，自己的最近搜索还在", () => {
    bindRecentSearchesOwner("user-a");
    saveRecentSearch("supabase");
    saveRecentSearch("vitest");

    unbindRecentSearchesOwner();
    expect(getRecentSearches()).toEqual([]);

    bindRecentSearchesOwner("user-a");
    expect(getRecentSearches()).toEqual(["vitest", "supabase"]);
  });

  it("会话变更时清掉升级前无属主的全局旧数据（登录时）", () => {
    storage.set(LEGACY_KEY, JSON.stringify(["前账号关键词"]));

    bindRecentSearchesOwner("user-a");
    expect(storage.has(LEGACY_KEY)).toBe(false);
    expect(getRecentSearches()).toEqual([]);
  });

  it("会话变更时清掉升级前无属主的全局旧数据（登出时）", () => {
    storage.set(LEGACY_KEY, JSON.stringify(["残留"]));

    unbindRecentSearchesOwner();
    expect(storage.has(LEGACY_KEY)).toBe(false);
  });

  it("最多保留 5 条，重复搜索去重并置顶", () => {
    bindRecentSearchesOwner("user-a");
    for (const query of ["一", "二", "三", "四", "五", "六"]) {
      saveRecentSearch(query);
    }
    expect(getRecentSearches()).toEqual(["六", "五", "四", "三", "二"]);

    saveRecentSearch("三");
    expect(getRecentSearches()).toEqual(["三", "六", "五", "四", "二"]);
  });

  it("可搜索判定保持不变：空串/单字母不记录，单个汉字记录，写入前 trim", () => {
    bindRecentSearchesOwner("user-a");
    saveRecentSearch("");
    saveRecentSearch("   ");
    saveRecentSearch("a");
    expect(getRecentSearches()).toEqual([]);

    saveRecentSearch("中");
    saveRecentSearch("  supabase  ");
    expect(getRecentSearches()).toEqual(["supabase", "中"]);
  });

  it("清除最近搜索只清当前属主的记录", () => {
    bindRecentSearchesOwner("user-a");
    saveRecentSearch("supabase");
    bindRecentSearchesOwner("user-b");
    saveRecentSearch("vitest");

    clearRecentSearches();
    expect(getRecentSearches()).toEqual([]);

    bindRecentSearchesOwner("user-a");
    expect(getRecentSearches()).toEqual(["supabase"]);
  });
});
