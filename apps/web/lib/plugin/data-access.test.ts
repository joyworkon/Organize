import { describe, expect, it, vi } from "vitest";
import { createWebDataAccess } from "./data-access";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createWebDataAccess", () => {
  it("askAI 成功：POST /api/ai/ask 并返回 text", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ text: "这是摘要" }));
    const data = createWebDataAccess(fetchImpl);

    const result = await data.askAI({ instruction: "总结", text: "正文" });

    expect(result).toBe("这是摘要");
    expect(fetchImpl).toHaveBeenCalledWith("/api/ai/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "总结", text: "正文" }),
    });
  });

  it("askAI HTTP 失败：抛错（插件自行 catch 并 notify）", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "boom" }, 500));
    const data = createWebDataAccess(fetchImpl);

    await expect(data.askAI({ instruction: "总结", text: "正文" })).rejects.toThrow("500");
  });

  it("askAI 响应无 text 字段：抛错", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const data = createWebDataAccess(fetchImpl);

    await expect(data.askAI({ instruction: "总结", text: "正文" })).rejects.toThrow();
  });

  it("askAI 网络异常：错误向上传播", async () => {
    const fetchImpl = vi.fn(async () => Promise.reject(new Error("network down")));
    const data = createWebDataAccess(fetchImpl);

    await expect(data.askAI({ instruction: "总结", text: "正文" })).rejects.toThrow("network down");
  });
});
