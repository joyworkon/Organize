import { createClient } from "../supabase/server";

interface RpcError {
  message: string;
}

interface PublicShareRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

interface NoteShareResource {
  id: string;
  title: string | null;
  content: Record<string, unknown> | null;
}

interface ReadingShareResource {
  id: string;
  title: string | null;
  content: string | null;
  excerpt: string | null;
  cover_image: string | null;
  url: string;
}

/** 072 公开链接三态：disabled 不会出现在 active 行（is_public 一致性约束），仅类型完整 */
export type ShareAccessMode = "disabled" | "public_read" | "public_edit";

export type PublicShareResult =
  | { state: "missing" }
  | { state: "expired"; resource_type: "note" | "reading_item"; expires_at: string }
  /**
   * 082 名额闸门：链接本身有效，但调用方没带有效会话（名额已满 / 尚未认领）。
   * 只回元信息、**不回 resource**——内容在服务端就断掉。页面据此渲染「确认进入」
   * 或「名额已被占用」，因此这一态不能并入 missing（那会显示成「链接不存在」，
   * 让使用者误以为链接坏了）。
   */
  | {
      state: "claim_required";
      resource_type: "note" | "reading_item";
      expires_at: string | null;
      /**
       * 收窄到两个公开态：disabled 的分享行走 is_public=false → missing，
       * 永远到不了 claim_required，类型上也不该给它留位子。
       */
      access_mode: "public_read" | "public_edit";
    }
  | {
      state: "active";
      resource_type: "note";
      expires_at: string | null;
      access_mode: ShareAccessMode;
      resource: NoteShareResource;
    }
  | {
      state: "active";
      resource_type: "reading_item";
      expires_at: string | null;
      resource: ReadingShareResource;
    };

interface RpcRow {
  status?: unknown;
  resource_type?: unknown;
  expires_at?: unknown;
  access_mode?: unknown;
  resource?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRpcRow(value: unknown): PublicShareResult {
  const row = (Array.isArray(value) ? value[0] : value) as RpcRow | undefined;
  if (!row || row.status === "missing") return { state: "missing" };

  const resourceType =
    row.resource_type === "note" || row.resource_type === "reading_item"
      ? row.resource_type
      : null;

  if (row.status === "expired" && resourceType && typeof row.expires_at === "string") {
    return {
      state: "expired",
      resource_type: resourceType,
      expires_at: row.expires_at,
    };
  }

  if (row.status === "claim_required" && resourceType) {
    return {
      state: "claim_required",
      resource_type: resourceType,
      expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
      access_mode: row.access_mode === "public_edit" ? "public_edit" : "public_read",
    };
  }

  if (row.status !== "active" || !resourceType || !isRecord(row.resource)) {
    return { state: "missing" };
  }

  const resource = row.resource;
  if (
    typeof resource.id !== "string" ||
    (resource.title !== null && typeof resource.title !== "string")
  ) {
    return { state: "missing" };
  }

  const expiresAt = typeof row.expires_at === "string" ? row.expires_at : null;
  if (resourceType === "note") {
    if (resource.content !== null && !isRecord(resource.content)) {
      return { state: "missing" };
    }
    return {
      state: "active",
      resource_type: "note",
      expires_at: expiresAt,
      // fail-safe：access_mode 缺失/未知（旧 RPC / 未来新态）一律按只读处理
      access_mode: row.access_mode === "public_edit" ? "public_edit" : "public_read",
      resource: {
        id: resource.id,
        title: resource.title as string | null,
        content: resource.content as Record<string, unknown> | null,
      },
    };
  }

  if (
    typeof resource.url !== "string" ||
    (resource.content !== null && typeof resource.content !== "string") ||
    (resource.excerpt !== null && typeof resource.excerpt !== "string") ||
    (resource.cover_image !== null && typeof resource.cover_image !== "string")
  ) {
    return { state: "missing" };
  }

  return {
    state: "active",
    resource_type: "reading_item",
    expires_at: expiresAt,
    resource: {
      id: resource.id,
      title: resource.title as string | null,
      content: resource.content as string | null,
      excerpt: resource.excerpt as string | null,
      cover_image: resource.cover_image as string | null,
      url: resource.url,
    },
  };
}

export interface GetPublicShareOptions {
  /** 082 名额闸门：本设备的会话凭证（来自 httpOnly cookie）；不设限的链接不需要 */
  sessionId?: string | null;
  /** 测试注入；不传则建真实客户端 */
  client?: PublicShareRpcClient;
}

export async function getPublicShare(
  token: string,
  options: GetPublicShareOptions = {}
): Promise<PublicShareResult> {
  if (!token || token.length < 16 || token.length > 256) {
    return { state: "missing" };
  }

  const client = options.client ?? (await createClient());
  const { data, error } = await client.rpc("get_public_share", {
    p_token: token,
    p_session_id: options.sessionId ?? null,
  });
  if (error) {
    console.error("Public share lookup failed:", error.message);
    return { state: "missing" };
  }

  return parseRpcRow(data);
}
