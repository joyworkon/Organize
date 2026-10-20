import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDoc } from "@/lib/canvas/model";
import { canvasListDto } from "@/lib/canvas/list-summary";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.auth }, from: mocks.from }) }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ data: { user: { id: "owner" } } });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ order: mocks.order });
  mocks.order.mockReturnValue({ limit: mocks.limit });
});

describe("GET canvases compact summaries", () => {
  it("只返回用户的 metadata + summary，不泄漏原始 content", async () => {
    const row = { id: "a", title: "画布", created_at: "a", updated_at: "b", content: emptyDoc(), user_id: "owner", revision: 100 };
    mocks.limit.mockResolvedValue({ data: [row], error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ canvases: [canvasListDto(row)] });
    expect(mocks.eq).toHaveBeenCalledWith("user_id", "owner");
    expect(mocks.limit).toHaveBeenCalledWith(200);
    expect(mocks.select).toHaveBeenCalledWith("id, title, created_at, updated_at, content");
  });
  it("未登录不查询，数据库失败不伪装空库", async () => {
    mocks.auth.mockResolvedValueOnce({ data: { user: null } });
    expect((await GET()).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    mocks.limit.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    expect((await GET()).status).toBe(500);
  });
});
