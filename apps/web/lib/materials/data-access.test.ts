import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWebDataAccess } from "@/lib/plugin/data-access";

const mockMode = vi.hoisted(() => vi.fn());
vi.mock("@/lib/env", () => ({ isMockBackend: mockMode }));
const result = { title: "资料", category: "其他", tags: [], blocks: [{ type: "paragraph", text: "原文" }] };
beforeEach(() => mockMode.mockReturnValue(false));

describe("material host facade", () => {
  it("sends multipart files, text, mode and cancellation signal without any API key", async () => {
    const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => Response.json(result));
    const controller = new AbortController();
    const data = createWebDataAccess(fetchImpl);
    expect(await data.organizeMaterials!({ files: [new File(["abc"], "a.txt")], text: "补充", mode: "extract", signal: controller.signal })).toEqual(result);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/ai/materials");
    expect(init?.headers).toBeUndefined();
    expect(init?.signal).toBe(controller.signal);
    const form = init?.body as FormData;
    expect(form.get("mode")).toBe("extract");
    expect(form.get("text")).toBe("补充");
    expect((form.get("files") as File).name).toBe("a.txt");
  });

  it("surfaces actionable server errors and rejects malformed successful responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json({ error: "请选择视觉模型" }, { status: 502 })).mockResolvedValueOnce(Response.json({ title: "incomplete" }));
    const data = createWebDataAccess(fetchImpl);
    await expect(data.organizeMaterials!({ files: [], text: "abc", mode: "organize" })).rejects.toThrow("视觉模型");
    await expect(data.organizeMaterials!({ files: [], text: "abc", mode: "organize" })).rejects.toThrow("格式不完整");
  });

  it("refuses mock calls explicitly rather than returning invented recognition", async () => {
    mockMode.mockReturnValue(true);
    const fetchImpl = vi.fn();
    await expect(createWebDataAccess(fetchImpl).organizeMaterials!({ files: [], text: "abc", mode: "organize" })).rejects.toThrow("演示模式");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
