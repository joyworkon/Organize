import { describe, expect, it } from "vitest";
import { getPublicShare } from "./public-share";

// 返回的是 getPublicShare 的**选项对象**（082 起签名收成 options：多了 sessionId），
// 这样各调用点 `getPublicShare(token, clientReturning([...]))` 形状保持不变
function clientReturning(data: unknown) {
  return {
    client: {
      rpc: async () => ({ data, error: null }),
    },
  };
}

/** 捕获传给 RPC 的实参，用于断言 p_session_id 确实下传（082） */
function clientCapturingArgs(sink: Record<string, unknown>[], data: unknown) {
  return {
    client: {
      rpc: async (_name: string, args: Record<string, unknown>) => {
        sink.push(args);
        return { data, error: null };
      },
    },
  };
}

describe("getPublicShare", () => {
  it("does not call the database for malformed tokens", async () => {
    let called = false;
    const result = await getPublicShare("short", {
      client: {
        rpc: async () => {
          called = true;
          return { data: [], error: null };
        },
      },
    });

    expect(result).toEqual({ state: "missing" });
    expect(called).toBe(false);
  });

  it("parses the note whitelist returned by the capability RPC", async () => {
    const result = await getPublicShare(
      "1234567890123456",
      clientReturning([
        {
          status: "active",
          resource_type: "note",
          expires_at: null,
          resource: {
            id: "note-id",
            title: "Public note",
            content: { type: "doc", content: [] },
          },
        },
      ])
    );

    expect(result).toEqual({
      state: "active",
      resource_type: "note",
      expires_at: null,
      access_mode: "public_read",
      resource: {
        id: "note-id",
        title: "Public note",
        content: { type: "doc", content: [] },
      },
    });
    expect(JSON.stringify(result)).not.toContain("user_id");
  });

  it("keeps public_edit only when the RPC says so, defaulting everything else to read-only", async () => {
    const editable = await getPublicShare(
      "1234567890123456",
      clientReturning([
        {
          status: "active",
          resource_type: "note",
          expires_at: null,
          access_mode: "public_edit",
          resource: { id: "note-id", title: "Editable", content: { type: "doc" } },
        },
      ])
    );
    expect(editable).toMatchObject({ state: "active", access_mode: "public_edit" });

    for (const accessMode of [undefined, "disabled", "unknown_future_mode"]) {
      const result = await getPublicShare(
        "1234567890123456",
        clientReturning([
          {
            status: "active",
            resource_type: "note",
            expires_at: null,
            access_mode: accessMode,
            resource: { id: "note-id", title: "Legacy", content: { type: "doc" } },
          },
        ])
      );
      // 缺失/未知/disabled 一律 fail-safe 为只读
      expect(result).toMatchObject({ state: "active", access_mode: "public_read" });
    }
  });

  it("keeps expired and missing shares non-readable", async () => {
    await expect(
      getPublicShare(
        "1234567890123456",
        clientReturning([
          {
            status: "expired",
            resource_type: "reading_item",
            expires_at: "2026-01-01T00:00:00.000Z",
            resource: null,
          },
        ])
      )
    ).resolves.toEqual({
      state: "expired",
      resource_type: "reading_item",
      expires_at: "2026-01-01T00:00:00.000Z",
    });

    await expect(
      getPublicShare("1234567890123456", clientReturning([{ status: "missing" }]))
    ).resolves.toEqual({ state: "missing" });
  });

  it("rejects unexpected RPC projections", async () => {
    const result = await getPublicShare(
      "1234567890123456",
      clientReturning([
        {
          status: "active",
          resource_type: "reading_item",
          resource: { id: "item-id", title: "Item", user_id: "leak" },
        },
      ])
    );

    expect(result).toEqual({ state: "missing" });
  });

  it("surfaces claim_required without leaking resource, and forwards the session id (082)", async () => {
    const args: Record<string, unknown>[] = [];
    const gated = await getPublicShare(
      "1234567890123456",
      clientCapturingArgs(args, [
        {
          status: "claim_required",
          resource_type: "note",
          expires_at: null,
          access_mode: "public_edit",
          resource: null,
        },
      ])
    );

    expect(gated).toEqual({
      state: "claim_required",
      resource_type: "note",
      expires_at: null,
      access_mode: "public_edit",
    });
    // 未持会话时也要显式传 null——RPC 据此走「无会话证据」分支（不设限的链接不受影响）
    expect(args[0]).toEqual({ p_token: "1234567890123456", p_session_id: null });

    const sessionId = "0b7a1c2d-3e4f-4a5b-8c9d-0e1f2a3b4c5d";
    await getPublicShare("1234567890123456", {
      sessionId,
      ...clientCapturingArgs(args, [{ status: "active", resource_type: "note", resource: null }]),
    });
    expect(args[1]).toEqual({ p_token: "1234567890123456", p_session_id: sessionId });
  });
});
