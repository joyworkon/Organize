import { afterEach, describe, expect, it, vi } from "vitest";
import { mockDb, MOCK_USER } from "@/lib/supabase/mock-data";
import { createMockClient } from "@/lib/supabase/mock-client";

vi.mock("@/lib/supabase/client", async () => ({ createClient: (await import("@/lib/supabase/mock-client")).createMockClient }));
vi.mock("@/lib/scraper/client", () => ({ scrapeUrl: vi.fn(() => { throw new Error("material must not scrape"); }) }));
import { collectReadingItem } from "./collect";

const snapshots = { reading_items: [...mockDb.reading_items], tags: [...mockDb.tags], item_tags: [...mockDb.item_tags] };
afterEach(() => {
  mockDb.reading_items = [...snapshots.reading_items]; mockDb.tags = [...snapshots.tags]; mockDb.item_tags = [...snapshots.item_tags];
});

describe("物料保存 mock 真实查询链", () => {
  it("创建可阅读的未读条目与关联标签，重复导入复用同一行", async () => {
    const input = { kind: "material" as const, key: "b".repeat(64), sources: ["scan.png"], result: {
      title: "扫描资料", category: "扫描件", tags: ["导入测试"], blocks: [{ type: "paragraph" as const, text: "完整识别正文" }],
    } };
    const saved = await collectReadingItem(input, { expectedUserId: MOCK_USER.id });
    expect(saved).toMatchObject({ status: "saved" }); expect(saved.warning).toBeUndefined();
    const client = createMockClient();
    const { data } = await client.from("reading_items").select("*").eq("id", saved.itemId).single();
    expect(data.reading_status).toBe("unread"); expect(data.content).toContain("完整识别正文");
    const links = mockDb.item_tags.filter((link) => link.item_id === saved.itemId);
    expect(links).toHaveLength(2);
    const duplicate = await collectReadingItem(input, { expectedUserId: MOCK_USER.id });
    expect(duplicate).toMatchObject({ status: "duplicate", itemId: saved.itemId });
    expect(mockDb.item_tags.filter((link) => link.item_id === saved.itemId)).toHaveLength(2);
    expect(mockDb.reading_items.filter((row) => row.url === saved.url)).toHaveLength(1);
  });
});
