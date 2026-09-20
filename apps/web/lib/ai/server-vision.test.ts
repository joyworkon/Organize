import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatCompletion } from "./server";
import { safeAIRequest } from "./safe-request";

vi.mock("./safe-request", async (importOriginal) => ({ ...await importOriginal<typeof import("./safe-request")>(), safeAIRequest: vi.fn() }));
const config = { baseUrl: "https://ai.example.com/v1", apiKey: "secret", textModel: "vision" };
beforeEach(() => vi.clearAllMocks());

describe("multimodal chatCompletion", () => {
  it("uses the safe transport with configured model and typed image content", async () => {
    vi.mocked(safeAIRequest).mockResolvedValue({ status: 200, headers: {}, buffer: Buffer.alloc(0), text: () => JSON.stringify({ choices: [{ message: { content: "识别结果" }, finish_reason: "stop" }] }) });
    const content = [{ type: "image_url" as const, image_url: { url: "data:image/png;base64,abc" } }];
    expect(await chatCompletion(config, "识别文字", content)).toBe("识别结果");
    const [url, init] = vi.mocked(safeAIRequest).mock.calls[0];
    expect(url).toBe("https://ai.example.com/v1/chat/completions");
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("vision");
    expect(body.messages[1].content).toEqual(content);
  });

  it("does not accept truncated output or echo provider credentials", async () => {
    vi.mocked(safeAIRequest).mockResolvedValueOnce({ status: 200, headers: {}, buffer: Buffer.alloc(0), text: () => JSON.stringify({ choices: [{ message: { content: "部分文字" }, finish_reason: "length" }] }) });
    await expect(chatCompletion(config, "识别文字", "text")).rejects.toThrow("长度限制");
    vi.mocked(safeAIRequest).mockResolvedValueOnce({ status: 400, headers: {}, buffer: Buffer.alloc(0), text: () => "unsupported vision; Bearer secret" });
    await expect(chatCompletion(config, "识别文字", "text")).rejects.toThrow("unsupported vision; ***");
  });
});
