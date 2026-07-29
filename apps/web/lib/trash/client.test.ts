import { describe, expect, it, vi } from "vitest";
import { listTrash, mutateTrash } from "./client";

const id = "10000000-0000-4000-8000-000000000001";

describe("trash client", () => {
  it("lists validated trash rows", async () => {
    const fetcher = vi.fn(async () =>
      Response.json([
        {
          resource_type: "note",
          id,
          title: "测试笔记",
          deleted_at: "2026-07-29T12:00:00.000Z",
        },
      ])
    );

    await expect(listTrash(fetcher)).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith("/api/trash", {
      cache: "no-store",
    });
  });

  it("sends a typed mutation and returns the affected count", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ success: true, affected: 2 })
    );

    await expect(
      mutateTrash("task", [id], "soft_delete", fetcher)
    ).resolves.toBe(2);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/trash",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "soft_delete",
          resource_type: "task",
          ids: [id],
        }),
      })
    );
  });

  it("surfaces the API error without accepting malformed success data", async () => {
    const apiError = vi.fn(async () =>
      Response.json({ error: "无权操作" }, { status: 403 })
    );
    const malformed = vi.fn(async () => Response.json({ success: true }));

    await expect(
      mutateTrash("note", [id], "restore", apiError)
    ).rejects.toThrow("无权操作");
    await expect(listTrash(malformed)).rejects.toThrow("无效数据");
  });
});
