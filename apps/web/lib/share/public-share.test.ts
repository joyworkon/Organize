import { describe, expect, it } from "vitest";
import { getPublicShare } from "./public-share";

function clientReturning(data: unknown) {
  return {
    rpc: async () => ({ data, error: null }),
  };
}

describe("getPublicShare", () => {
  it("does not call the database for malformed tokens", async () => {
    let called = false;
    const result = await getPublicShare("short", {
      rpc: async () => {
        called = true;
        return { data: [], error: null };
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
      resource: {
        id: "note-id",
        title: "Public note",
        content: { type: "doc", content: [] },
      },
    });
    expect(JSON.stringify(result)).not.toContain("user_id");
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
});
