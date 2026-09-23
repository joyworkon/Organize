import { describe, expect, it } from "vitest";
import {
  IMPORT_HISTORY_CURSOR_PREFIX,
  decodeImportHistoryCursor,
  encodeImportHistoryCursor,
} from "./history-cursor";

// 阶段 1：文件历史分页游标（GET /api/imports）。排序 created_at DESC, id DESC，
// 游标 = 上一页末行 (created_at, id) 二元组；与 lib/library/cursor.ts 同款编码约定。
describe("import history cursor", () => {
  const cursor = { created_at: "2026-09-23T08:30:00.000Z", id: "0f0e0d0c-0000-1000-8000-000000000000" };

  it("编码带版本前缀，解码还原逐字段相等", () => {
    const encoded = encodeImportHistoryCursor(cursor);
    expect(encoded.startsWith(IMPORT_HISTORY_CURSOR_PREFIX)).toBe(true);
    expect(decodeImportHistoryCursor(encoded)).toEqual(cursor);
  });

  it("编码是 base64url（无 + / =，可放心进 query string）", () => {
    const encoded = encodeImportHistoryCursor(cursor);
    expect(encoded.slice(IMPORT_HISTORY_CURSOR_PREFIX.length)).not.toMatch(/[+/=]/);
  });

  it("null/空串解码为 null（第一页）", () => {
    expect(decodeImportHistoryCursor(null)).toBeNull();
    expect(decodeImportHistoryCursor("")).toBeNull();
  });

  it("非本前缀 / 不可解码 / 字段缺失或非法 → 抛错（路由转 400）", () => {
    expect(() => decodeImportHistoryCursor("lib1.abc")).toThrow();
    expect(() => decodeImportHistoryCursor("imp1.!!!not-base64!!!")).toThrow();
    expect(() =>
      decodeImportHistoryCursor(
        IMPORT_HISTORY_CURSOR_PREFIX + Buffer.from(JSON.stringify({ c: "nope", i: "" })).toString("base64url"),
      ),
    ).toThrow();
  });

  it("created_at 必须是 ISO 时间戳（防注入）", () => {
    // 编码侧拒绝非法时间戳
    expect(() =>
      encodeImportHistoryCursor({ created_at: "2026-09-23T08:30:00.000Z'; drop table --", id: cursor.id }),
    ).toThrow();
    // 绕过编码侧直接构造的载荷，解码侧同样拒绝
    const tampered = IMPORT_HISTORY_CURSOR_PREFIX +
      Buffer.from(JSON.stringify({ c: "nope", i: cursor.id })).toString("base64url");
    expect(() => decodeImportHistoryCursor(tampered)).toThrow();
  });
});
