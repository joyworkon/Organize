import { describe, expect, it } from "vitest";
import {
  parseSuggestionsPatchBody,
  parseSuggestionsPostBody,
  resolveSuggestionPatchInput,
  resolveSuggestionPostInput,
  suggestionNoteRejection,
  suggestionPatchRejection,
} from "./suggestions-api";

function req(body: string, method = "POST"): Request {
  return new Request("http://localhost/api/notes/note-1/suggestions", {
    method,
    headers: { "Content-Type": "application/json" },
    body,
  });
}

const NO_ROWS = { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" };
const DB_DOWN = { code: "XX000", message: "connection to server lost; relation \"note_suggestions\" missing" };

describe("parseSuggestionsPostBody", () => {
  it("非法 JSON / 空请求体 / 顶层非对象 → 400 请求格式错误", async () => {
    for (const raw of ["{not json", "", "[]", '"text"', "null", "42"]) {
      const result = await parseSuggestionsPostBody(req(raw));
      expect(result).toEqual({
        ok: false,
        rejection: { status: 400, error: "请求格式错误" },
      });
    }
  });

  it("合法字段 → ok（blockId trim 后返回）", async () => {
    const result = await parseSuggestionsPostBody(
      req(JSON.stringify({ blockId: " b1 ", originalBlock: { type: "paragraph" }, proposedBlock: { type: "heading" } }))
    );
    expect(result).toEqual({
      ok: true,
      input: { blockId: "b1", originalBlock: { type: "paragraph" }, proposedBlock: { type: "heading" } },
    });
  });

  it("blockId 非字符串 / 缺失 / trim 后为空 → 400 建议内容不完整", () => {
    for (const body of [
      { blockId: 42, originalBlock: {}, proposedBlock: {} },
      { originalBlock: {}, proposedBlock: {} },
      { blockId: "   ", originalBlock: {}, proposedBlock: {} },
      { blockId: null, originalBlock: {}, proposedBlock: {} },
    ]) {
      expect(resolveSuggestionPostInput(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "建议内容不完整" },
      });
    }
  });

  it("originalBlock / proposedBlock 非对象（字符串 / null / 数组 / 缺失）→ 400 建议内容不完整", () => {
    for (const body of [
      { blockId: "b1", originalBlock: "text", proposedBlock: {} },
      { blockId: "b1", originalBlock: {}, proposedBlock: null },
      { blockId: "b1", originalBlock: [], proposedBlock: {} },
      { blockId: "b1", proposedBlock: {} },
      { blockId: "b1", originalBlock: {} },
    ]) {
      expect(resolveSuggestionPostInput(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "建议内容不完整" },
      });
    }
  });
});

describe("parseSuggestionsPatchBody", () => {
  it("非法 JSON / 顶层非对象 → 400 请求格式错误", async () => {
    for (const raw of ["{not json", "[]", "null"]) {
      const result = await parseSuggestionsPatchBody(req(raw, "PATCH"));
      expect(result).toEqual({
        ok: false,
        rejection: { status: 400, error: "请求格式错误" },
      });
    }
  });

  it("suggestionId 非字符串 / 缺失 / 空串 → 400 无效状态", () => {
    for (const body of [
      { suggestionId: 42, status: "accepted" },
      { status: "accepted" },
      { suggestionId: "", status: "accepted" },
    ]) {
      expect(resolveSuggestionPatchInput(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "无效状态" },
      });
    }
  });

  it("status 非 accepted / rejected → 400 无效状态", () => {
    for (const body of [
      { suggestionId: "s1", status: "pending" },
      { suggestionId: "s1", status: "done" },
      { suggestionId: "s1" },
      { suggestionId: "s1", status: 1 },
    ]) {
      expect(resolveSuggestionPatchInput(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "无效状态" },
      });
    }
  });

  it("accepted / rejected → ok", async () => {
    for (const status of ["accepted", "rejected"]) {
      const result = await parseSuggestionsPatchBody(
        req(JSON.stringify({ suggestionId: "s1", status }), "PATCH")
      );
      expect(result).toEqual({ ok: true, input: { suggestionId: "s1", status } });
    }
  });
});

describe("Supabase 错误分类", () => {
  it("authorize note 查询：PGRST116 → 404 笔记不存在；其它错误 → null（走 serverError）", () => {
    expect(suggestionNoteRejection(NO_ROWS)).toEqual({ status: 404, error: "笔记不存在" });
    expect(suggestionNoteRejection(DB_DOWN)).toBeNull();
    expect(suggestionNoteRejection(null)).toBeNull();
  });

  it("PATCH 更新：PGRST116 → 409 建议不存在或已处理；其它错误 → null（走 serverError，不回显 message）", () => {
    expect(suggestionPatchRejection(NO_ROWS)).toEqual({ status: 409, error: "建议不存在或已处理" });
    expect(suggestionPatchRejection(DB_DOWN)).toBeNull();
    expect(suggestionPatchRejection({ code: "23505", message: "duplicate key" })).toBeNull();
  });
});
