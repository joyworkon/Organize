import { afterEach, describe, expect, it, vi } from "vitest";
import { retryPendingAsset } from "./assets";
import { putBlob } from "./draft";

/** Node 环境没有 Image/createObjectURL 的真实实现，mock 模式下补一个最小假实现。 */
function stubImageGlobals() {
  class FakeImage {
    naturalWidth = 100;
    naturalHeight = 50;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", FakeImage);
  if (typeof URL.createObjectURL !== "function") {
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: () => "blob:fake",
      revokeObjectURL: () => undefined,
    }));
  }
}

describe("retryPendingAsset（A6 原位重试）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_MOCK_BACKEND;
  });

  it("本机有原图：重新上传成功，返回 saved 资产", async () => {
    stubImageGlobals();
    process.env.NEXT_PUBLIC_MOCK_BACKEND = "true";
    await putBlob("u1", "k1", new Blob(["pixels"], { type: "image/png" }));
    const asset = {
      url: "",
      naturalWidth: 100,
      naturalHeight: 50,
      name: "a.png",
      uploadStatus: "pending" as const,
      localKey: "k1",
    };
    const outcome = await retryPendingAsset(asset, "k1", "u1");
    expect(outcome).not.toBeNull();
    expect(outcome!.asset.uploadStatus).toBe("saved");
    expect(outcome!.asset.url.startsWith("mock-image:")).toBe(true);
    expect(outcome!.asset.naturalWidth).toBe(100);
  });

  it("已持久化（saved）资产：跳过，返回 null", async () => {
    process.env.NEXT_PUBLIC_MOCK_BACKEND = "true";
    const saved = {
      url: "mock-image:k1",
      naturalWidth: 100,
      naturalHeight: 50,
      uploadStatus: "saved" as const,
    };
    expect(await retryPendingAsset(saved, "k1", "u1")).toBeNull();
  });

  it("本机原图缺失：返回 null（UI 提示重新选择）", async () => {
    process.env.NEXT_PUBLIC_MOCK_BACKEND = "true";
    const asset = {
      url: "",
      naturalWidth: 100,
      naturalHeight: 50,
      uploadStatus: "pending" as const,
      localKey: "missing",
    };
    expect(await retryPendingAsset(asset, "missing", "u1")).toBeNull();
  });
});
