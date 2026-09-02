import { afterEach, describe, expect, it } from "vitest";
import { validateInvitePayload } from "./invite";
import { generateToken } from "./token";
import { createAdminClient } from "@/lib/supabase/admin";

const NOTE_ID = "71200000-0000-0000-0000-000000000001";
const WS_ID = "71100000-0000-0000-0000-000000000001";

describe("validateInvitePayload", () => {
  const valid = {
    resource_type: "note",
    resource_id: NOTE_ID,
    access_role: "editor",
    email: "  Someone@Example.COM ",
  };

  it("accepts a full payload and normalizes the email to lowercased trim", () => {
    const parsed = validateInvitePayload({ ...valid, workspace_id: WS_ID });
    expect(parsed).toEqual({
      ok: true,
      value: {
        resource_type: "note",
        resource_id: NOTE_ID,
        workspace_id: WS_ID,
        access_role: "editor",
        email: "someone@example.com",
        new_workspace_name: null,
      },
    });
  });

  it("treats an absent workspace_id as create-new and keeps the workspace name", () => {
    const parsed = validateInvitePayload({
      ...valid,
      workspace_id: "",
      new_workspace_name: "  产品组  ",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.workspace_id).toBeNull();
      expect(parsed.value.new_workspace_name).toBe("产品组");
    }
  });

  it.each([
    [{ ...valid, resource_type: "task" }, "resource_type 非法"],
    [{ ...valid, resource_id: "not-a-uuid" }, "resource_id 非法"],
    [{ ...valid, access_role: "owner" }, "access_role 非法"],
    [{ ...valid, email: "not-an-email" }, "email 非法"],
    [{ ...valid, email: 42 }, "email 非法"],
    [{ ...valid, workspace_id: "abc" }, "workspace_id 非法"],
    [{ ...valid, new_workspace_name: 7 }, "new_workspace_name 非法"],
    [null, "请求体非法"],
    ["x", "请求体非法"],
  ])("rejects %j with %s", (body, error) => {
    expect(validateInvitePayload(body)).toEqual({ ok: false, error });
  });

  it("rejects an oversized workspace name", () => {
    const parsed = validateInvitePayload({
      ...valid,
      new_workspace_name: "长".repeat(101),
    });
    expect(parsed).toEqual({ ok: false, error: "new_workspace_name 过长" });
  });
});

describe("generateToken", () => {
  it("produces url-safe 22-char tokens with entropy", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(generateToken()).not.toBe(token);
  });
});

describe("invite service prerequisites", () => {
  const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  afterEach(() => {
    if (savedUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (savedKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("reports the invite service as unconfigured without the service role key (503 branch)", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(createAdminClient()).toBeNull();
  });
});
