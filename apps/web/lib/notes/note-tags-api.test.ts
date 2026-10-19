import { describe, expect, it } from "vitest";
import { parseNoteTagPostBody, resolveNoteTagRef } from "./note-tags-api";

function req(body: string): Request {
  return new Request("http://localhost/api/notes/note-1/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("parseNoteTagPostBody", () => {
  it("非法 JSON / 空请求体 → 400 请求格式错误", async () => {
    for (const raw of ["{not json", ""]) {
      const result = await parseNoteTagPostBody(req(raw));
      expect(result).toEqual({
        ok: false,
        rejection: { status: 400, error: "请求格式错误" },
      });
    }
  });

  it("顶层是数组 / 字符串 / null / 数字 → 400 请求格式错误", async () => {
    for (const raw of ["[]", '"text"', "null", "42"]) {
      const result = await parseNoteTagPostBody(req(raw));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.rejection).toEqual({ status: 400, error: "请求格式错误" });
      }
    }
  });

  it("合法 body：{ tag_id } → ref.tagId", async () => {
    const result = await parseNoteTagPostBody(req(JSON.stringify({ tag_id: "t1" })));
    expect(result).toEqual({ ok: true, ref: { tagId: "t1", tagName: undefined } });
  });

  it("合法 body：{ name } → trim 后的 ref.tagName", async () => {
    const result = await parseNoteTagPostBody(req(JSON.stringify({ name: "  foo  " })));
    expect(result).toEqual({ ok: true, ref: { tagId: undefined, tagName: "foo" } });
  });

  it("tag_id 优先于 name", async () => {
    const result = await parseNoteTagPostBody(
      req(JSON.stringify({ tag_id: "t1", name: "foo" }))
    );
    expect(result).toEqual({ ok: true, ref: { tagId: "t1", tagName: "foo" } });
  });
});

describe("resolveNoteTagRef", () => {
  it("缺 tag_id 且缺 name → 400 需要提供 tag_id 或 name", () => {
    expect(resolveNoteTagRef({})).toEqual({
      ok: false,
      rejection: { status: 400, error: "需要提供 tag_id 或 name" },
    });
  });

  it("name 为空白串 / tag_id 为空串 → 视为未提供 → 400", () => {
    for (const body of [{ name: "   " }, { tag_id: "" }, { tag_id: "", name: "  " }]) {
      expect(resolveNoteTagRef(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "需要提供 tag_id 或 name" },
      });
    }
  });

  it("name 为 null → 视为未提供", () => {
    expect(resolveNoteTagRef({ name: null })).toEqual({
      ok: false,
      rejection: { status: 400, error: "需要提供 tag_id 或 name" },
    });
  });

  it("非字符串 name 经 toString 处理（与原内联实现一致）", () => {
    expect(resolveNoteTagRef({ name: 42 })).toEqual({
      ok: true,
      ref: { tagId: undefined, tagName: "42" },
    });
  });
});
