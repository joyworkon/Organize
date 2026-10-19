import { describe, expect, it } from "vitest";
import {
  commentDeleteRejection,
  commentPatchRejection,
  noteContextRejection,
  parseCommentsDeleteBody,
  parseCommentsPatchBody,
  parseCommentsPostBody,
  resolveCommentDeleteInput,
  resolveCommentPatchInput,
  resolveCommentPostInput,
  threadDeleteRejection,
  threadLookupRejection,
  threadPatchRejection,
} from "./comments-api";

function req(body: string, method = "POST"): Request {
  return new Request("http://localhost/api/notes/note-1/comments", {
    method,
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const NO_ROWS = { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" };
const DB_DOWN = { code: "XX000", message: "connection to server lost; relation \"note_comments\" missing" };

describe("parseCommentsPostBody", () => {
  it("非法 JSON / 空请求体 / 顶层非对象 → 400 请求格式错误", async () => {
    for (const raw of ["{not json", "", "[]", '"text"', "null", "42"]) {
      const result = await parseCommentsPostBody(req(raw));
      expect(result).toEqual({
        ok: false,
        rejection: { status: 400, error: "请求格式错误" },
      });
    }
  });

  it("新建线程：合法 blockId + body → ok（trim 后返回）", async () => {
    const result = await parseCommentsPostBody(
      req(JSON.stringify({ blockId: " b1 ", body: " 你好 " }))
    );
    expect(result).toEqual({ ok: true, input: { blockId: "b1", text: "你好", threadId: undefined } });
  });

  it("回复线程：合法 threadId 透传", () => {
    const result = resolveCommentPostInput({ blockId: "b1", body: "hi", threadId: "t1" });
    expect(result).toEqual({ ok: true, input: { blockId: "b1", text: "hi", threadId: "t1" } });
  });

  it("blockId / body 非字符串 → 400 评论内容无效（不再 String() 强转）", () => {
    for (const body of [
      { blockId: 42, body: "hi" },
      { blockId: "b1", body: 42 },
      { blockId: null, body: "hi" },
      { blockId: "b1" },
      { body: "hi" },
      { blockId: { id: "b1" }, body: "hi" },
    ]) {
      expect(resolveCommentPostInput(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "评论内容无效" },
      });
    }
  });

  it("trim 后为空 / 超长 → 400 评论内容无效", () => {
    for (const body of [
      { blockId: "  ", body: "hi" },
      { blockId: "b1", body: "   " },
      { blockId: "b1", body: "x".repeat(5001) },
    ]) {
      expect(resolveCommentPostInput(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "评论内容无效" },
      });
    }
  });

  it("threadId 非字符串 → 400 请求格式错误", () => {
    for (const threadId of [42, true, { id: "t1" }, ["t1"]]) {
      expect(resolveCommentPostInput({ blockId: "b1", body: "hi", threadId })).toEqual({
        ok: false,
        rejection: { status: 400, error: "请求格式错误" },
      });
    }
  });

  it("threadId 为空串 / null / undefined 视为未提供 → 走新建线程", () => {
    for (const threadId of ["", null, undefined]) {
      const result = resolveCommentPostInput({ blockId: "b1", body: "hi", threadId });
      expect(result).toEqual({ ok: true, input: { blockId: "b1", text: "hi", threadId: undefined } });
    }
  });
});

describe("parseCommentsPatchBody", () => {
  it("非法 JSON / 顶层非对象 → 400 请求格式错误", async () => {
    for (const raw of ["{not json", "[]", "null"]) {
      const result = await parseCommentsPatchBody(req(raw, "PATCH"));
      expect(result).toEqual({
        ok: false,
        rejection: { status: 400, error: "请求格式错误" },
      });
    }
  });

  it("编辑评论：commentId + body:string → ok", async () => {
    const result = await parseCommentsPatchBody(
      req(JSON.stringify({ commentId: "c1", body: " 改后 " }), "PATCH")
    );
    expect(result).toEqual({
      ok: true,
      input: { kind: "edit-comment", commentId: "c1", text: "改后" },
    });
  });

  it("编辑评论：commentId 非字符串或 body 非字符串 → 400 请求格式错误", () => {
    for (const body of [
      { commentId: 42, body: "hi" },
      { commentId: "c1", body: 42 },
      { commentId: "c1" },
    ]) {
      expect(resolveCommentPatchInput(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "请求格式错误" },
      });
    }
  });

  it("编辑评论：trim 后为空 / 超长 → 400 评论内容无效", () => {
    for (const body of [
      { commentId: "c1", body: "   " },
      { commentId: "c1", body: "x".repeat(5001) },
    ]) {
      expect(resolveCommentPatchInput(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "评论内容无效" },
      });
    }
  });

  it("切换解决态：threadId + resolved:boolean → ok", () => {
    expect(resolveCommentPatchInput({ threadId: "t1", resolved: true })).toEqual({
      ok: true,
      input: { kind: "toggle-resolved", threadId: "t1", resolved: true },
    });
    expect(resolveCommentPatchInput({ threadId: "t1", resolved: false })).toEqual({
      ok: true,
      input: { kind: "toggle-resolved", threadId: "t1", resolved: false },
    });
  });

  it("切换解决态：threadId 非字符串或 resolved 非 boolean → 400 请求格式错误", () => {
    for (const body of [
      { threadId: 42, resolved: true },
      { threadId: "t1", resolved: "yes" },
      { threadId: "t1" },
    ]) {
      expect(resolveCommentPatchInput(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "请求格式错误" },
      });
    }
  });

  it("commentId 优先于 threadId（与旧路由分支顺序一致）", () => {
    const result = resolveCommentPatchInput({ commentId: "c1", body: "hi", threadId: "t1", resolved: true });
    expect(result).toEqual({
      ok: true,
      input: { kind: "edit-comment", commentId: "c1", text: "hi" },
    });
  });

  it("commentId / threadId 皆缺 → 400 无效操作", () => {
    for (const body of [{}, { body: "hi" }, { resolved: true }, { commentId: "" }, { threadId: null }]) {
      expect(resolveCommentPatchInput(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "无效操作" },
      });
    }
  });
});

describe("parseCommentsDeleteBody", () => {
  it("非法 JSON / 顶层非对象 → 400 请求格式错误", async () => {
    for (const raw of ["{not json", "[]", "null"]) {
      const result = await parseCommentsDeleteBody(req(raw, "DELETE"));
      expect(result).toEqual({
        ok: false,
        rejection: { status: 400, error: "请求格式错误" },
      });
    }
  });

  it("commentId → 删评论；threadId → 删线程", () => {
    expect(resolveCommentDeleteInput({ commentId: "c1" })).toEqual({
      ok: true,
      input: { kind: "comment", commentId: "c1" },
    });
    expect(resolveCommentDeleteInput({ threadId: "t1" })).toEqual({
      ok: true,
      input: { kind: "thread", threadId: "t1" },
    });
  });

  it("commentId 优先于 threadId（与旧路由分支顺序一致）", () => {
    expect(resolveCommentDeleteInput({ commentId: "c1", threadId: "t1" })).toEqual({
      ok: true,
      input: { kind: "comment", commentId: "c1" },
    });
  });

  it("id 非字符串 → 400 请求格式错误", () => {
    for (const body of [{ commentId: 42 }, { threadId: true }, { commentId: { id: "c1" } }]) {
      expect(resolveCommentDeleteInput(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "请求格式错误" },
      });
    }
  });

  it("commentId / threadId 皆缺 → 400 无效操作", () => {
    for (const body of [{}, { commentId: "" }, { threadId: null }]) {
      expect(resolveCommentDeleteInput(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "无效操作" },
      });
    }
  });
});

describe("Supabase 结果分类", () => {
  it("noteContextRejection：PGRST116 → 404 笔记不存在；其它错误 → null（route 走 serverError）", () => {
    expect(noteContextRejection(NO_ROWS)).toEqual({ status: 404, error: "笔记不存在" });
    expect(noteContextRejection(DB_DOWN)).toBeNull();
  });

  it("threadLookupRejection：PGRST116 → 404 评论线程不存在；其它错误 → null", () => {
    expect(threadLookupRejection(NO_ROWS)).toEqual({ status: 404, error: "评论线程不存在" });
    expect(threadLookupRejection(DB_DOWN)).toBeNull();
  });

  it("commentPatchRejection：PGRST116 → 404 评论不存在或无权限；其它错误 → null", () => {
    expect(commentPatchRejection(NO_ROWS)).toEqual({ status: 404, error: "评论不存在或无权限" });
    expect(commentPatchRejection(DB_DOWN)).toBeNull();
  });

  it("threadPatchRejection：PGRST116 → 404 评论线程不存在；其它错误 → null", () => {
    expect(threadPatchRejection(NO_ROWS)).toEqual({ status: 404, error: "评论线程不存在" });
    expect(threadPatchRejection(DB_DOWN)).toBeNull();
  });

  it("commentDeleteRejection：0 行 → 404；≥1 行 → null（成功）", () => {
    expect(commentDeleteRejection(0)).toEqual({ status: 404, error: "评论不存在或无权限" });
    expect(commentDeleteRejection(1)).toBeNull();
  });

  it("threadDeleteRejection：0 行 → 404；≥1 行 → null（成功）", () => {
    expect(threadDeleteRejection(0)).toEqual({ status: 404, error: "评论线程不存在" });
    expect(threadDeleteRejection(1)).toBeNull();
  });
});
