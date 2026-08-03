export const TRASH_RESOURCE_TYPES = [
  "note",
  "reading_item",
  "task",
  "lesson",
  "database",
  "countdown",
] as const;
export const TRASH_ACTIONS = [
  "soft_delete",
  "restore",
  "permanent_delete",
] as const;

export type TrashResourceType = (typeof TRASH_RESOURCE_TYPES)[number];
export type TrashAction = (typeof TRASH_ACTIONS)[number];

export interface TrashMutation {
  action: TrashAction;
  resourceType: TrashResourceType;
  ids: string[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseTrashMutation(body: unknown): TrashMutation | null {
  if (!isRecord(body)) return null;
  if (
    !TRASH_ACTIONS.includes(body.action as TrashAction) ||
    !TRASH_RESOURCE_TYPES.includes(body.resource_type as TrashResourceType) ||
    !Array.isArray(body.ids)
  ) {
    return null;
  }

  const ids = Array.from(
    new Set(body.ids.filter((id): id is string => typeof id === "string"))
  );
  if (
    ids.length === 0 ||
    ids.length > 200 ||
    ids.some((id) => !UUID_PATTERN.test(id))
  ) {
    return null;
  }

  return {
    action: body.action as TrashAction,
    resourceType: body.resource_type as TrashResourceType,
    ids,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
