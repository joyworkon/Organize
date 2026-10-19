export const LINKED_DATABASES_LOAD_ERROR_MESSAGE = "数据库列表加载失败，请重试";
export const LINKED_DATABASES_EMPTY_MESSAGE = "还没有可链接的数据库，请先创建一个数据库";

export interface LinkedDatabaseListItem {
  id: string;
  title: string;
}

export type LinkedDatabasesLoadOutcome<T extends LinkedDatabaseListItem> =
  | { kind: "ready"; databases: T[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export function resolveLinkedDatabasesLoad<T extends LinkedDatabaseListItem = LinkedDatabaseListItem>({
  ok,
  databases,
}: {
  ok: boolean;
  databases?: T[] | null;
}): LinkedDatabasesLoadOutcome<T> {
  if (!ok) {
    return { kind: "error", message: LINKED_DATABASES_LOAD_ERROR_MESSAGE };
  }

  const loadedDatabases = databases ?? [];
  if (loadedDatabases.length === 0) {
    return { kind: "empty" };
  }

  return { kind: "ready", databases: loadedDatabases };
}
