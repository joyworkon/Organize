import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { MAX_MATERIAL_BYTES } from "@/lib/materials/schema";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getAIConfig: vi.fn(), organize: vi.fn(), limit: vi.fn(), mock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/ai/server", () => ({ getAIConfig: mocks.getAIConfig, redactSecret: (s: string, secret: string) => secret ? s.split(secret).join("***") : s }));
vi.mock("@/lib/api/rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/materials/server", () => ({ organizeMaterials: mocks.organize }));
vi.mock("@/lib/env", () => ({ isMockBackend: mocks.mock }));

function request(mode = "organize") {
  const form = new FormData();
  form.append("mode", mode);
  form.append("files", new File(["项目记录"], "note.txt"));
  return new NextRequest("http://localhost/api/ai/materials", { method: "POST", body: form });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.mock.mockReturnValue(false);
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.limit.mockResolvedValue(true);
  mocks.getAIConfig.mockResolvedValue({ apiKey: "private-key" });
  mocks.organize.mockResolvedValue({ title: "结果" });
});

describe("POST /api/ai/materials", () => {
  it("requires auth and applies shared per-user rate limiting before reading files", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.getAIConfig).not.toHaveBeenCalled();
    mocks.limit.mockResolvedValueOnce(false);
    const limited = await POST(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(mocks.limit).toHaveBeenCalledWith("ai:materials:user-1", 5, 60_000);
  });

  it("checks input before calling AI and sends user-specific config", async () => {
    expect((await POST(request("invalid"))).status).toBe(400);
    expect(mocks.organize).not.toHaveBeenCalled();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.getAIConfig).toHaveBeenCalledWith(expect.anything(), "user-1");
    expect(mocks.organize).toHaveBeenCalledWith({ apiKey: "private-key" }, expect.objectContaining({ mode: "organize" }));
    expect(await mocks.organize.mock.calls[0][1].files[0].text()).toBe("项目记录");
  });

  it("limits actual bytes when Content-Length is missing", async () => {
    const response = await POST(new NextRequest("http://localhost/api/ai/materials", {
      method: "POST", body: new Uint8Array(MAX_MATERIAL_BYTES + 512 * 1024 + 1),
    }));
    expect(response.status).toBe(413);
    expect(mocks.organize).not.toHaveBeenCalled();
  });

  it("reports invalid multipart and empty input, redacts provider errors, and refuses mock AI", async () => {
    const bad = new NextRequest("http://localhost/api/ai/materials", { method: "POST", body: "invalid" });
    expect((await POST(bad)).status).toBe(400);
    mocks.organize.mockRejectedValueOnce(new Error("echo private-key"));
    const failed = await POST(request());
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "echo ***" });
    mocks.mock.mockReturnValueOnce(true);
    expect((await POST(request())).status).toBe(501);
  });
});
