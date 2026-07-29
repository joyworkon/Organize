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

export type PublicShareResult =
  | { state: "missing" }
  | { state: "expired"; resource_type: "note" | "reading_item"; expires_at: string }
  | {
      state: "active";
      resource_type: "note";
      expires_at: string | null;
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

export async function getPublicShare(
  token: string,
  injectedClient?: PublicShareRpcClient
): Promise<PublicShareResult> {
  if (!token || token.length < 16 || token.length > 256) {
    return { state: "missing" };
  }

  const client = injectedClient ?? (await createClient());
  const { data, error } = await client.rpc("get_public_share", { p_token: token });
  if (error) {
    console.error("Public share lookup failed:", error.message);
    return { state: "missing" };
  }

  return parseRpcRow(data);
}
