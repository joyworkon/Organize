import {
  TRASH_RESOURCE_TYPES,
  type TrashAction,
  type TrashResourceType,
} from "./contracts";

export interface TrashItem {
  resource_type: TrashResourceType;
  id: string;
  title: string;
  deleted_at: string;
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

interface TrashMutationResponse {
  success: true;
  affected: number;
}

export async function listTrash(fetcher: Fetcher = fetch): Promise<TrashItem[]> {
  const response = await fetcher("/api/trash", { cache: "no-store" });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(body, "无法读取垃圾箱"));
  }
  if (!Array.isArray(body) || !body.every(isTrashItem)) {
    throw new Error("垃圾箱返回了无效数据");
  }
  return body;
}

export async function mutateTrash(
  resourceType: TrashResourceType,
  ids: string[],
  action: TrashAction,
  fetcher: Fetcher = fetch
): Promise<number> {
  const response = await fetcher("/api/trash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      resource_type: resourceType,
      ids,
    }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(getErrorMessage(body, "垃圾箱操作失败"));
  }
  if (!isTrashMutationResponse(body)) {
    throw new Error("垃圾箱返回了无效结果");
  }
  return body.affected;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return fallback;
}

function isTrashItem(value: unknown): value is TrashItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    TRASH_RESOURCE_TYPES.includes(item.resource_type as TrashResourceType) &&
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.deleted_at === "string" &&
    !Number.isNaN(Date.parse(item.deleted_at))
  );
}

function isTrashMutationResponse(
  value: unknown
): value is TrashMutationResponse {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    result.success === true &&
    typeof result.affected === "number" &&
    Number.isInteger(result.affected) &&
    result.affected >= 0
  );
}
