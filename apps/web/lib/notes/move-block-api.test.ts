import { describe, expect, it } from "vitest";
import {
  moveBlockRpcRejection,
  parseMoveBlockBody,
  resolveMoveBlockInput,
  RPC_ERR_BLOCK_NOT_FOUND,
  RPC_ERR_NOTE_NOT_FOUND,
  RPC_ERR_SAME_NOTE,
} from "./move-block-api";

function req(body: string): Request {
  return new Request("http://localhost/api/notes/note-1/move-block", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("parseMoveBlockBody", () => {
  it("非法 JSON / 空请求体 / 顶层非对象 → 400 请求格式错误", async () => {
    for (const raw of ["{not json", "", "[]", '"text"', "null", "42"]) {
      const result = await parseMoveBlockBody(req(raw), "note-1");
      expect(result).toEqual({
        ok: false,
        rejection: { status: 400, error: "请求格式错误" },
      });
    }
  });

  it("合法字段 → ok", async () => {
    const result = await parseMoveBlockBody(
      req(JSON.stringify({ targetNoteId: "note-2", blockId: "blk-1" })),
      "note-1"
    );
    expect(result).toEqual({ ok: true, input: { targetNoteId: "note-2", blockId: "blk-1" } });
  });

  it("targetNoteId / blockId 非字符串 → 400 移动目标无效（不再 String() 强转）", () => {
    for (const body of [
      { targetNoteId: 42, blockId: "blk-1" },
      { targetNoteId: "note-2", blockId: 42 },
      { targetNoteId: null, blockId: "blk-1" },
      { blockId: "blk-1" },
      { targetNoteId: "note-2" },
      { targetNoteId: { id: "note-2" }, blockId: "blk-1" },
    ]) {
      expect(resolveMoveBlockInput(body, "note-1")).toEqual({
        ok: false,
        rejection: { status: 400, error: "移动目标无效" },
      });
    }
  });

  it("空串 / trim 后为空 / 目标即源笔记 → 400 移动目标无效", () => {
    for (const body of [
      { targetNoteId: "", blockId: "blk-1" },
      { targetNoteId: "note-2", blockId: "  " },
      { targetNoteId: "note-1", blockId: "blk-1" },
    ]) {
      expect(resolveMoveBlockInput(body, "note-1")).toEqual({
        ok: false,
        rejection: { status: 400, error: "移动目标无效" },
      });
    }
  });
});

describe("moveBlockRpcRejection", () => {
  it("RPC 主动 raise 的业务错误 → 稳定中文文案（不回显原始 message）", () => {
    expect(moveBlockRpcRejection({ code: "P0001", message: RPC_ERR_NOTE_NOT_FOUND })).toEqual({
      status: 404,
      error: "笔记不存在或无权限",
    });
    expect(moveBlockRpcRejection({ code: "P0001", message: RPC_ERR_BLOCK_NOT_FOUND })).toEqual({
      status: 404,
      error: "块不存在",
    });
    expect(moveBlockRpcRejection({ code: "P0001", message: RPC_ERR_SAME_NOTE })).toEqual({
      status: 400,
      error: "移动目标无效",
    });
  });

  it("其它错误 → null（route 走 serverError 500）", () => {
    expect(moveBlockRpcRejection({ code: "XX000", message: "connection lost" })).toBeNull();
    expect(moveBlockRpcRejection({ code: "22P02", message: "invalid input syntax for type uuid" })).toBeNull();
    expect(moveBlockRpcRejection(null)).toBeNull();
    expect(moveBlockRpcRejection({})).toBeNull();
  });
});
