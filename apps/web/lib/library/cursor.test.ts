import { describe, expect, it } from "vitest";
import {
  decodeLibraryCursor,
  encodeLibraryCursor,
  LIBRARY_CURSOR_PREFIX,
  LibraryCursorError,
} from "./cursor";

const sample = {
  created_at: "2026-09-22T08:00:00.000Z",
  source_type: "reading",
  id: "74040000-0000-0000-0000-000000000001",
};

describe("library cursor 编解码", () => {
  it("编码含版本前缀，解码 round-trip 一致", () => {
    const encoded = encodeLibraryCursor(sample);
    expect(encoded.startsWith(LIBRARY_CURSOR_PREFIX)).toBe(true);
    expect(decodeLibraryCursor(encoded)).toEqual(sample);
  });

  it("memo source_type 与带时区偏移的时间也能 round-trip", () => {
    const cursor = {
      created_at: "2026-09-22T16:00:00+08:00",
      source_type: "memo",
      id: "74040000-0000-0000-0000-0000000000AB",
    };
    expect(decodeLibraryCursor(encodeLibraryCursor(cursor))).toEqual(cursor);
  });

  it("null/空串返回 null（第一页）", () => {
    expect(decodeLibraryCursor(null)).toBeNull();
    expect(decodeLibraryCursor("")).toBeNull();
  });

  it.each([
    ["版本缺失", "v9.eyJjIjoiYSJ9"],
    ["版本前缀被篡改", "lib2.eyJjIjoiYSJ9"],
    ["base64 损坏", `${LIBRARY_CURSOR_PREFIX}!!!not-base64!!!`],
    ["JSON 非法", `${LIBRARY_CURSOR_PREFIX}bm90LWpzb24`],
    ["时间格式非法", encodePayload({ c: "yesterday", s: "memo", i: sample.id })],
    ["source_type 非法", encodePayload({ c: sample.created_at, s: "note", i: sample.id })],
    ["id 为空", encodePayload({ c: sample.created_at, s: "memo", i: "" })],
  ])("坏 cursor 抛 LibraryCursorError：%s", (_label, raw) => {
    expect(() => decodeLibraryCursor(raw)).toThrow(LibraryCursorError);
  });

  it("编码入口也拒绝非法输入", () => {
    expect(() => encodeLibraryCursor({ ...sample, source_type: "note" })).toThrow(LibraryCursorError);
    expect(() => encodeLibraryCursor({ ...sample, id: "" })).toThrow(LibraryCursorError);
  });
});

function encodePayload(payload: Record<string, string>): string {
  return `${LIBRARY_CURSOR_PREFIX}${Buffer.from(JSON.stringify(payload), "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}`;
}
