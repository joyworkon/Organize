import { describe, expect, it } from "vitest";
import {
  buildNotePatchUpdate,
  isNoRowsError,
  noteGetRejection,
  notePatchRejection,
  parseJsonBody,
  resolveNoteDelete,
} from "./api-mutation";

function req(body: string): Request {
  return new Request("http://localhost/api/notes/note-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("parseJsonBody", () => {
  it("合法 JSON 对象 → ok", async () => {
    const result = await parseJsonBody(req(JSON.stringify({ title: "t" })));
    expect(result).toEqual({ ok: true, body: { title: "t" } });
  });

  it("非法 JSON / 空请求体 → 400 请求格式错误", async () => {
    for (const raw of ["{not json", ""]) {
      const result = await parseJsonBody(req(raw));
      expect(result).toEqual({
        ok: false,
        rejection: { status: 400, error: "请求格式错误" },
      });
    }
  });

  it("顶层是数组 / 字符串 / null / 数字 → 400 请求格式错误", async () => {
    for (const raw of ["[]", '"text"', "null", "42"]) {
      const result = await parseJsonBody(req(raw));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.rejection).toEqual({ status: 400, error: "请求格式错误" });
      }
    }
  });
});

describe("buildNotePatchUpdate", () => {
  it("空 body → 400 没有可更新的字段（route 据此不发 update、不递增 revision）", () => {
    expect(buildNotePatchUpdate({})).toEqual({
      ok: false,
      rejection: { status: 400, error: "没有可更新的字段" },
    });
  });

  it("只有不识别字段 / 类型不合法字段 → 400 没有可更新的字段", () => {
    for (const body of [
      { nope: 1 },
      { icon: 42 },
      { font_family: "bogus" },
      { page_template: "bogus" },
      { cover_position: "50" },
      { parent_note_id: 42 },
    ]) {
      expect(buildNotePatchUpdate(body)).toEqual({
        ok: false,
        rejection: { status: 400, error: "没有可更新的字段" },
      });
    }
  });

  it("常规字段原样进入 updateData", () => {
    const content = { type: "doc", content: [{ type: "paragraph" }] };
    const result = buildNotePatchUpdate({
      title: "标题",
      content,
      reading_item_id: "ri-1",
      icon: null,
      cover_url: "https://example.com/c.png",
      full_width: true,
      font_family: "serif",
      small_font: true,
      page_template: "red-blue",
    });
    expect(result).toEqual({
      ok: true,
      updateData: {
        title: "标题",
        content,
        reading_item_id: "ri-1",
        icon: null,
        cover_url: "https://example.com/c.png",
        full_width: true,
        font_family: "serif",
        small_font: true,
        page_template: "red-blue",
      },
    });
  });

  it("cover_position 取整并钳制在 0–100", () => {
    for (const [input, expected] of [[-5, 0], [50.4, 50], [120, 100]] as const) {
      const result = buildNotePatchUpdate({ cover_position: input });
      expect(result).toEqual({ ok: true, updateData: { cover_position: expected } });
    }
  });

  it("parent_note_id 为 string 或 null 时进入 updateData（存在性/循环校验在 route）", () => {
    expect(buildNotePatchUpdate({ parent_note_id: "p-1" })).toEqual({
      ok: true,
      updateData: { parent_note_id: "p-1" },
    });
    expect(buildNotePatchUpdate({ parent_note_id: null })).toEqual({
      ok: true,
      updateData: { parent_note_id: null },
    });
  });
});

describe("noteGetRejection / notePatchRejection", () => {
  it("PGRST116（0 行）→ 404", () => {
    const noRows = { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" };
    expect(isNoRowsError(noRows)).toBe(true);
    expect(noteGetRejection(noRows)).toEqual({ status: 404, error: "笔记不存在" });
    expect(notePatchRejection(noRows)).toEqual({ status: 404, error: "笔记不存在或无权限" });
  });

  it("真实数据库故障 → null（route 走 serverError，不伪装 404）", () => {
    const dbDown = { code: "57P01", message: "terminating connection" };
    expect(isNoRowsError(dbDown)).toBe(false);
    expect(noteGetRejection(dbDown)).toBeNull();
    expect(notePatchRejection(dbDown)).toBeNull();
    expect(noteGetRejection(null)).toBeNull();
    expect(notePatchRejection({ message: "no code" })).toBeNull();
  });
});

describe("resolveNoteDelete", () => {
  it("RPC error → 500 通用文案（不泄露 message）", () => {
    expect(resolveNoteDelete({ message: "boom" }, 0)).toEqual({
      ok: false,
      rejection: { status: 500, error: "删除笔记失败", code: "TRASH_MUTATION_FAILED" },
    });
  });

  it("affected === 0（不存在/已删/不属于本人）→ 404，不假装成功", () => {
    expect(resolveNoteDelete(null, 0)).toEqual({
      ok: false,
      rejection: { status: 404, error: "笔记不存在或已删除" },
    });
  });

  it("affected > 0 → 成功且透传 affected", () => {
    expect(resolveNoteDelete(null, 1)).toEqual({ ok: true, affected: 1 });
    expect(resolveNoteDelete(null, 3)).toEqual({ ok: true, affected: 3 });
  });
});
