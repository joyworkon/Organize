// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// mock API shim 的路由级测试：在 jsdom 里安装补丁，逐条验证
// 版本 / 评论 / 建议路由的响应形状与真实 API 路由一致。
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const call = async (path: string, init?: RequestInit) => {
  const res = await (window as any).fetch(path, init);
  return { status: res.status, body: await res.json() };
};

let originalFetchRef: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  originalFetchRef = vi.fn(async () => new Response("{}", { status: 200 }));
  (window as any).fetch = originalFetchRef;
  delete (window as any).__organizeMockApiShimInstalled;
  const mod = await import("@/lib/mock/api-shim");
  mod.installMockApiShim();
});

describe("mock api shim", () => {
  it("GET /versions 列出种子版本（按时间倒序，元信息形状）", async () => {
    const { status, body } = await call("/api/notes/note-1/versions");
    expect(status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ message: "补充要点" });
    expect(body[1]).toMatchObject({ message: "初次保存" });
    for (const row of body) {
      expect(Object.keys(row).sort()).toEqual(["created_at", "id", "message", "title"]);
    }
  });

  it("GET /versions/[vid] 返回完整内容", async () => {
    const { status, body } = await call("/api/notes/note-1/versions/mock-version-1");
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: "mock-version-1", note_id: "note-1" });
    expect((body.content as { type: string }).type).toBe("doc");
  });

  it("POST /versions/[vid] 恢复：内容回写、revision 递增、当前内容自动备份", async () => {
    const { status, body } = await call("/api/notes/note-1/versions/mock-version-1", {
      method: "POST",
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, noteRevision: 1 });

    const { mockDb } = await import("@/lib/supabase/mock-data");
    const note = mockDb.notes.find((n: any) => n.id === "note-1");
    expect(note.title).toBe("读《useEffect 完全指南》的笔记");
    expect(note.content.type).toBe("doc");
    expect(note.content_revision).toBe(1);
    // 恢复前自动备份了一条
    expect(mockDb.note_versions).toHaveLength(3);
    expect(mockDb.note_versions.at(-1).message).toBe("恢复前自动备份");
  });

  it("DELETE /versions/[vid] 删除版本", async () => {
    const { status, body } = await call("/api/notes/note-1/versions/mock-version-1", {
      method: "DELETE",
    });
    expect(status).toBe(200);
    expect(body).toEqual({ success: true });
    const { mockDb } = await import("@/lib/supabase/mock-data");
    expect(mockDb.note_versions.some((v: any) => v.id === "mock-version-1")).toBe(false);
  });

  it("未知笔记的版本列表返回 404", async () => {
    const { status, body } = await call("/api/notes/note-404/versions");
    expect(status).toBe(404);
    expect(body).toEqual({ error: "笔记不存在" });
  });

  it("GET /comments 返回线程嵌套评论（按时间正序）", async () => {
    const { status, body } = await call("/api/notes/note-1/comments");
    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].block_id).toBe("mock-block-1");
    expect(body[0].comments).toHaveLength(2);
    expect(body[0].comments[0].body).toContain("对照原文");
  });

  it("POST /comments 新建线程返回线程（含首条评论），带 threadId 则追加评论", async () => {
    const created = await call("/api/notes/note-1/comments", {
      method: "POST",
      body: JSON.stringify({ blockId: "block-a", body: "这条要核对一下" }),
    });
    expect(created.status).toBe(201);
    expect(created.body.comments).toHaveLength(1);
    expect(created.body.comments[0].body).toBe("这条要核对一下");

    const reply = await call("/api/notes/note-1/comments", {
      method: "POST",
      // 与真实路由一致：回复同样必须带 blockId
      body: JSON.stringify({ threadId: created.body.id, blockId: "block-a", body: "已核对" }),
    });
    expect(reply.status).toBe(201);
    expect(reply.body.thread_id).toBe(created.body.id);
  });

  it("PATCH /comments 支持编辑评论与（取消）解决线程", async () => {
    const edited = await call("/api/notes/note-1/comments", {
      method: "PATCH",
      body: JSON.stringify({ commentId: "mock-comment-1", body: "改过的评论" }),
    });
    expect(edited.status).toBe(200);
    expect(edited.body.body).toBe("改过的评论");

    const resolved = await call("/api/notes/note-1/comments", {
      method: "PATCH",
      body: JSON.stringify({ threadId: "mock-thread-1", resolved: true }),
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.resolved_at).toBeTruthy();

    const unresolved = await call("/api/notes/note-1/comments", {
      method: "PATCH",
      body: JSON.stringify({ threadId: "mock-thread-1", resolved: false }),
    });
    expect(unresolved.body.resolved_at).toBeNull();
  });

  it("DELETE /comments 删除线程时级联删评论", async () => {
    const { status, body } = await call("/api/notes/note-1/comments", {
      method: "DELETE",
      body: JSON.stringify({ threadId: "mock-thread-1" }),
    });
    expect(status).toBe(200);
    expect(body).toEqual({ success: true });
    const { mockDb } = await import("@/lib/supabase/mock-data");
    expect(mockDb.note_comment_threads).toHaveLength(0);
    expect(mockDb.note_comments).toHaveLength(0);
  });

  it("建议：创建 → 接受 → 再改动返回 409", async () => {
    const created = await call("/api/notes/note-1/suggestions", {
      method: "POST",
      body: JSON.stringify({
        blockId: "block-a",
        originalBlock: { type: "paragraph" },
        proposedBlock: { type: "heading" },
      }),
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("pending");

    const accepted = await call("/api/notes/note-1/suggestions", {
      method: "PATCH",
      body: JSON.stringify({ suggestionId: created.body.id, status: "accepted" }),
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("accepted");

    const conflict = await call("/api/notes/note-1/suggestions", {
      method: "PATCH",
      body: JSON.stringify({ suggestionId: created.body.id, status: "rejected" }),
    });
    expect(conflict.status).toBe(409);
  });

  it("未覆盖的 /api 接口返回 501，非 API 请求透传原始 fetch", async () => {
    const unmatched = await call("/api/ai/ask", { method: "POST", body: JSON.stringify({}) });
    expect(unmatched.status).toBe(501);
    expect(unmatched.body.error).toContain("mock 后端未实现");

    await (window as any).fetch("https://example.com/other");
    expect(originalFetchRef).toHaveBeenCalledWith("https://example.com/other", undefined);
  });
});
