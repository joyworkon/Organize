import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNewNote } from "./create-note";

/**
 * N02 回归：统一笔记创建服务的四态合同
 * （created / queued / unauthenticated / failed）。
 */

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

function fakeClient(opts: {
  user?: { id: string } | null;
  insertError?: unknown;
} = {}) {
  return {
    auth: {
      getSession: async () => ({
        data: {
          session: {
            user: opts.user === undefined ? { id: "u1" } : opts.user,
          },
        },
      }),
    },
    from: () => ({
      insert: () => ({ error: opts.insertError ?? null }),
    }),
  } as unknown as Parameters<typeof createNewNote>[0];
}

describe("createNewNote 四态合同（N02）", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  it("在线直写成功 → created，noteId 可直接跳转", async () => {
    const result = await createNewNote(fakeClient());
    expect(result.status).toBe("created");
    if (result.status === "created") expect(result.noteId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("无会话 → unauthenticated（不写库不入队）", async () => {
    const result = await createNewNote(fakeClient({ user: null }));
    expect(result.status).toBe("unauthenticated");
  });

  it("网络失败 → queued，客户端 id 入队（回放幂等）", async () => {
    const result = await createNewNote(
      fakeClient({ insertError: new TypeError("Failed to fetch") })
    );
    expect(result.status).toBe("queued");
    if (result.status === "queued") {
      expect(result.noteId).toMatch(/^[0-9a-f-]{36}$/);
      const raw = localStorage.getItem("organize:offline:note-creates:v1");
      expect(raw).toContain(result.noteId);
    }
  });

  it("断网（isOnline=false）→ queued", async () => {
    vi.resetModules();
    vi.doMock("@/lib/offline/network", () => ({ isOnline: () => false }));
    const { createNewNote: createOffline } = await import("./create-note");
    const result = await createOffline(fakeClient());
    expect(result.status).toBe("queued");
    vi.doUnmock("@/lib/offline/network");
    vi.resetModules();
  });

  it("服务端业务错误 → failed（不静默）", async () => {
    const result = await createNewNote(
      fakeClient({ insertError: { code: "42501", message: "permission denied" } })
    );
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.message).toContain("permission denied");
  });
});
