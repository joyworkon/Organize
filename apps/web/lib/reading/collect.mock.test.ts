import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// mock 后端分支的集成测试：不 stub 任何模块，
// NEXT_PUBLIC_MOCK_BACKEND=true 时走真实 mock 客户端 + mockDb，
// 验证统一收集服务在无 Supabase 的开发机上端到端可用（抓取样例文章 + 内存库去重）。

const ORIGINAL_READING_ITEMS = "reading_items";

async function importModules() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_MOCK_BACKEND = "true";
  const collect = await import("@/lib/reading/collect");
  const mockData = await import("@/lib/supabase/mock-data");
  return { collectReadingItem: collect.collectReadingItem, mockDb: mockData.mockDb, MOCK_USER: mockData.MOCK_USER };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_MOCK_BACKEND = "true";
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_MOCK_BACKEND;
  vi.restoreAllMocks();
});

describe("collectReadingItem mock 后端分支", () => {
  it("新 URL → 保存样例文章（unread/0 + mock 正文），重复提交 → duplicate 且不新增行", async () => {
    const { collectReadingItem, mockDb, MOCK_USER } = await importModules();
    const original = mockDb[ORIGINAL_READING_ITEMS];
    mockDb[ORIGINAL_READING_ITEMS] = [];
    try {
      const url = "https://example.com/mock-collect-check";

      const first = await collectReadingItem(url);
      expect(first.status).toBe("saved");
      expect(first.itemId).toBeTruthy();
      // mock 抓取生成的标题来自 slug，入库字段与真实分支同一冻结映射
      const rows = mockDb[ORIGINAL_READING_ITEMS] as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: first.itemId,
        user_id: MOCK_USER.id,
        url,
        title: "Mock collect check",
        reading_status: "unread",
        reading_progress: 0,
      });
      expect(rows[0].content).toContain("<p>");

      const second = await collectReadingItem(`再看一遍 ${url}`);
      expect(second.status).toBe("duplicate");
      expect(second.itemId).toBe(first.itemId);
      expect(mockDb[ORIGINAL_READING_ITEMS]).toHaveLength(1);
    } finally {
      mockDb[ORIGINAL_READING_ITEMS] = original;
    }
  });

  it("去重限定 user_id：他人同 URL 行不拦保存", async () => {
    const { collectReadingItem, mockDb, MOCK_USER } = await importModules();
    const original = mockDb[ORIGINAL_READING_ITEMS];
    const url = "https://example.com/other-users-link";
    mockDb[ORIGINAL_READING_ITEMS] = [
      {
        id: "other-user-row",
        user_id: "another-user",
        url,
        title: "别人的条目",
        reading_status: "unread",
        reading_progress: 0,
      },
    ];
    try {
      const result = await collectReadingItem(url);
      expect(result.status).toBe("saved");
      const rows = mockDb[ORIGINAL_READING_ITEMS] as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.user_id === MOCK_USER.id)?.url).toBe(url);
    } finally {
      mockDb[ORIGINAL_READING_ITEMS] = original;
    }
  });

  it("与存量 seed 数据去重：seed 中的活跃 URL 再次保存 → duplicate", async () => {
    const { collectReadingItem, mockDb } = await importModules();
    const original = mockDb[ORIGINAL_READING_ITEMS];
    try {
      const result = await collectReadingItem("https://www.paulgraham.com/greatwork.html");
      expect(result.status).toBe("duplicate");
      expect(result.itemId).toBe("item-2");
    } finally {
      mockDb[ORIGINAL_READING_ITEMS] = original;
    }
  });
});
