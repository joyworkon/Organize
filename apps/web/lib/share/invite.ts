import type { ShareResourceType } from "@organize/shared";

export type InviteAccessRole = "viewer" | "editor";

/** POST /api/share/invite 的请求体（字段宽松进入，校验收口在 validateInvitePayload） */
export interface InviteRequestInput {
  resource_type?: unknown;
  resource_id?: unknown;
  workspace_id?: unknown;
  access_role?: unknown;
  email?: unknown;
  new_workspace_name?: unknown;
}

export interface ValidatedInvite {
  resource_type: ShareResourceType;
  resource_id: string;
  /** 缺省为 null：由 route 以调用者身份 create_workspace 新建协作空间 */
  workspace_id: string | null;
  access_role: InviteAccessRole;
  /** lower(btrim) 后的邮箱（071 的 redeem_share_invite 按 lower 比对） */
  email: string;
  new_workspace_name: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_WORKSPACE_NAME = 100;

/**
 * 邀请未注册邮箱（Track A）的入参校验：纯函数，route 与 Vitest 共用。
 * fail-closed：任何字段类型/格式不合都整单拒绝，不做静默修正（email 的小写化除外，
 * 那是 071 兑现比对的既定口径）。
 */
export function validateInvitePayload(
  body: unknown
): { ok: true; value: ValidatedInvite } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "请求体非法" };
  }
  const raw = body as InviteRequestInput;

  if (raw.resource_type !== "note" && raw.resource_type !== "reading_item") {
    return { ok: false, error: "resource_type 非法" };
  }
  if (typeof raw.resource_id !== "string" || !UUID_RE.test(raw.resource_id)) {
    return { ok: false, error: "resource_id 非法" };
  }
  if (raw.access_role !== "viewer" && raw.access_role !== "editor") {
    return { ok: false, error: "access_role 非法" };
  }
  if (typeof raw.email !== "string") {
    return { ok: false, error: "email 非法" };
  }
  const email = raw.email.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: "email 非法" };
  }

  let workspaceId: string | null = null;
  if (raw.workspace_id !== undefined && raw.workspace_id !== null && raw.workspace_id !== "") {
    if (typeof raw.workspace_id !== "string" || !UUID_RE.test(raw.workspace_id)) {
      return { ok: false, error: "workspace_id 非法" };
    }
    workspaceId = raw.workspace_id;
  }

  let newWorkspaceName: string | null = null;
  if (raw.new_workspace_name !== undefined && raw.new_workspace_name !== null) {
    if (typeof raw.new_workspace_name !== "string") {
      return { ok: false, error: "new_workspace_name 非法" };
    }
    newWorkspaceName = raw.new_workspace_name.trim();
    if (newWorkspaceName.length > MAX_WORKSPACE_NAME) {
      return { ok: false, error: "new_workspace_name 过长" };
    }
  }

  return {
    ok: true,
    value: {
      resource_type: raw.resource_type,
      resource_id: raw.resource_id,
      workspace_id: workspaceId,
      access_role: raw.access_role,
      email,
      new_workspace_name: newWorkspaceName,
    },
  };
}
