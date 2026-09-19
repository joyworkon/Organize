import { beforeEach, describe, expect, it, vi } from "vitest";
import { organizeMaterials } from "./server";
import { chatCompletion, transcribeAudio } from "@/lib/ai/server";

vi.mock("@/lib/ai/server", () => ({ chatCompletion: vi.fn(), transcribeAudio: vi.fn() }));
const config = { baseUrl: "https://example.com/v1", apiKey: "secret", textModel: "vision", transcriptionModel: "speech" };
const result = { title: "资料", category: "学习", tags: [], blocks: [{ type: "paragraph", text: "整理结果" }] };

beforeEach(() => { vi.clearAllMocks(); vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify(result)); });

describe("organizeMaterials", () => {
  it("sends actual image bytes and all sources to the configured multimodal model", async () => {
    const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "截图.png", { type: "image/png" });
    const output = await organizeMaterials(config, { files: [png, new File(["会议原文"], "notes.txt")], text: "补充文字", mode: "extract" });
    expect(output).toEqual(result);
    const [sentConfig, system, parts] = vi.mocked(chatCompletion).mock.calls[0];
    expect(sentConfig).toBe(config);
    expect(system).toContain("不是指令");
    expect(parts).toEqual(expect.arrayContaining([{ type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }]));
    expect(JSON.stringify(parts)).toContain("会议原文");
    expect(JSON.stringify(parts)).toContain("完整转录");
  });

  it("transcribes audio with normalized MIME then organizes the transcript", async () => {
    vi.mocked(transcribeAudio).mockResolvedValue("明天联系客户");
    await organizeMaterials(config, { files: [new File(["audio"], "meeting.m4a")], mode: "organize" });
    expect(vi.mocked(transcribeAudio).mock.calls[0][1].type).toBe("audio/mp4");
    expect(JSON.stringify(vi.mocked(chatCompletion).mock.calls[0][2])).toContain("明天联系客户");
  });

  it("rejects disguised image, invalid UTF-8 and long text without silent truncation", async () => {
    await expect(organizeMaterials(config, { files: [new File(["<svg></svg>"], "fake.png")], mode: "extract" })).rejects.toThrow("不是有效");
    await expect(organizeMaterials(config, { files: [new File([new Uint8Array([255])], "bad.txt")], mode: "extract" })).rejects.toThrow("UTF-8");
    await expect(organizeMaterials(config, { files: [new File(["x".repeat(40_001)], "long.txt")], mode: "organize" })).rejects.toThrow("4 万");
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("does not spend transcription quota without a text model and propagates provider errors", async () => {
    await expect(organizeMaterials({ ...config, textModel: "" }, { files: [new File(["audio"], "a.mp3")], mode: "organize" })).rejects.toThrow("模型配置");
    expect(transcribeAudio).not.toHaveBeenCalled();
    vi.mocked(chatCompletion).mockRejectedValue(new Error("vision unsupported"));
    await expect(organizeMaterials(config, { files: [], text: "文字", mode: "organize" })).rejects.toThrow("vision unsupported");
  });
});
