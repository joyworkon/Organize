import {
  BACKUP_TABLES,
  type BackupData,
  type BackupRow,
  type BackupTable,
  type BackupV2,
} from "./schema";

export interface RestorePayload {
  restore_payload_version: 1;
  data: BackupData;
}

type UuidFactory = () => string;

const ID_TABLES = [
  "reading_items",
  "notes",
  "tags",
  "tasks",
  "task_checklists",
  "lessons",
  "highlights",
  "favorites",
  "note_versions",
  "note_comment_threads",
  "note_comments",
  "note_suggestions",
  "synced_blocks",
  "db_databases",
  "db_rows",
  // 033 任务工作台
  "task_lists",
  "task_reminders",
  "task_attachments",
  "task_activities",
  "task_templates",
  "countdown_days",
  // 058（P0-04）收录
  "memos",
  "task_item_refs",
  "memo_notes",
] as const satisfies readonly BackupTable[];

type IdTable = (typeof ID_TABLES)[number];

export function prepareRestorePayload(
  backup: BackupV2,
  uuidFactory: UuidFactory = () => crypto.randomUUID()
): RestorePayload {
  const maps = {} as Record<IdTable, Map<string, string>>;
  const generatedIds = new Set<string>();

  for (const table of ID_TABLES) {
    const tableMap = new Map<string, string>();
    for (const row of backup.data[table]) {
      const oldId = String(row.id);
      const newId = uuidFactory();
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          newId
        ) ||
        generatedIds.has(newId)
      ) {
        throw new Error("UUID factory returned an invalid or duplicate ID");
      }
      generatedIds.add(newId);
      tableMap.set(oldId, newId);
    }
    maps[table] = tableMap;
  }

  const data = Object.fromEntries(
    BACKUP_TABLES.map((table) => [table, []])
  ) as unknown as BackupData;

  data.reading_items = backup.data.reading_items.map((row) =>
    withId(row, maps.reading_items)
  );
  data.notes = backup.data.notes.map((row) => ({
    ...withId(row, maps.notes),
    reading_item_id: remapOptional(row.reading_item_id, maps.reading_items),
    parent_note_id:
      row.parent_note_id == null
        ? null
        : remap(row.parent_note_id, maps.notes),
    icon: row.icon ?? null,
    cover_url: row.cover_url ?? null,
    cover_position: row.cover_position ?? 50,
    full_width: row.full_width === true,
    font_family:
      (["default", "serif", "mono"] as const).includes(
        row.font_family as "default" | "serif" | "mono"
      )
        ? (row.font_family as "default" | "serif" | "mono")
        : "default",
    small_font: row.small_font === true,
    // 066 归属列：restore 刻意不搬运（协作上下文状态，跨账号/跨时间恢复后无意义），
    // 置空而不是透传，防止悬空 uuid 流进恢复载荷；下次保存由 RPC 重新落值
    last_edit_by: null,
    content: rewriteInternalLinks(row.content, maps.notes, maps.reading_items, maps.synced_blocks, maps.db_databases, maps.tasks),
  }));
  data.tags = backup.data.tags.map((row) => withId(row, maps.tags));
  data.item_tags = backup.data.item_tags.map((row) => ({
    item_id: remap(row.item_id, maps.reading_items),
    tag_id: remap(row.tag_id, maps.tags),
  }));
  data.note_tags = backup.data.note_tags.map((row) => ({
    note_id: remap(row.note_id, maps.notes),
    tag_id: remap(row.tag_id, maps.tags),
  }));
  data.tasks = backup.data.tasks.map((row) => ({
    ...withId(row, maps.tasks),
    reading_item_id: remapOptional(row.reading_item_id, maps.reading_items),
    note_id: remapOptional(row.note_id, maps.notes),
    parent_task_id: remapOptional(row.parent_task_id, maps.tasks),
  }));
  data.task_dependencies = (backup.data.task_dependencies || []).map((row) => ({
    task_id: remap(row.task_id, maps.tasks),
    depends_on_task_id: remap(row.depends_on_task_id, maps.tasks),
    created_at: row.created_at,
  }));
  data.task_checklists = backup.data.task_checklists.map((row) => ({
    ...withId(row, maps.task_checklists),
    task_id: remap(row.task_id, maps.tasks),
  }));
  data.task_tags = backup.data.task_tags.map((row) => ({
    task_id: remap(row.task_id, maps.tasks),
    tag_id: remap(row.tag_id, maps.tags),
  }));
  data.lessons = backup.data.lessons.map((row) => ({
    ...withId(row, maps.lessons),
    task_id: remapOptional(row.task_id, maps.tasks),
    reading_item_id: remapOptional(row.reading_item_id, maps.reading_items),
    note_id: remapOptional(row.note_id, maps.notes),
    content: rewriteInternalLinks(row.content, maps.notes, maps.reading_items, maps.synced_blocks, maps.db_databases, maps.tasks),
  }));
  data.lesson_tags = backup.data.lesson_tags.map((row) => ({
    lesson_id: remap(row.lesson_id, maps.lessons),
    tag_id: remap(row.tag_id, maps.tags),
  }));
  data.highlights = backup.data.highlights.map((row) => ({
    ...withId(row, maps.highlights),
    reading_item_id: remap(row.reading_item_id, maps.reading_items),
    note_id: remapOptional(row.note_id, maps.notes),
    task_id: remapOptional(row.task_id, maps.tasks),
  }));
  data.favorites = backup.data.favorites.map((row) => ({
    ...withId(row, maps.favorites),
    target_id:
      row.target_type === "reading"
        ? remap(row.target_id, maps.reading_items)
        : row.target_type === "note"
          ? remap(row.target_id, maps.notes)
          : remap(row.target_id, maps.tasks),
  }));
  data.note_versions = backup.data.note_versions.map((row) => ({
    ...withId(row, maps.note_versions),
    note_id: remap(row.note_id, maps.notes),
    content: rewriteInternalLinks(row.content, maps.notes, maps.reading_items, maps.synced_blocks, maps.db_databases, maps.tasks),
  }));
  data.note_comment_threads = backup.data.note_comment_threads.map((row) => ({
    ...withId(row, maps.note_comment_threads),
    note_id: remap(row.note_id, maps.notes),
  }));
  data.note_comments = backup.data.note_comments.map((row) => ({
    ...withId(row, maps.note_comments),
    thread_id: remap(row.thread_id, maps.note_comment_threads),
  }));
  data.note_suggestions = backup.data.note_suggestions.map((row) => ({
    ...withId(row, maps.note_suggestions),
    note_id: remap(row.note_id, maps.notes),
    original_block: rewriteInternalLinks(
      row.original_block,
      maps.notes,
      maps.reading_items,
      maps.synced_blocks,
      maps.db_databases,
      maps.tasks
    ),
    proposed_block: rewriteInternalLinks(
      row.proposed_block,
      maps.notes,
      maps.reading_items,
      maps.synced_blocks,
      maps.db_databases,
      maps.tasks
    ),
  }));
  data.synced_blocks = backup.data.synced_blocks.map((row) => ({
    ...withId(row, maps.synced_blocks),
    content: rewriteInternalLinks(
      row.content,
      maps.notes,
      maps.reading_items,
      maps.synced_blocks,
      maps.db_databases,
      maps.tasks
    ),
  }));
  data.db_databases = backup.data.db_databases.map((row) => ({
    ...withId(row, maps.db_databases),
    parent_note_id:
      row.parent_note_id == null ? null : remap(row.parent_note_id, maps.notes),
    // schema/views 是数据库结构定义，内部不含笔记/阅读 ID，不需要重写链接
    schema: row.schema,
    views: row.views,
  }));
  data.db_rows = backup.data.db_rows.map((row) => ({
    ...withId(row, maps.db_rows),
    database_id: remap(row.database_id, maps.db_databases),
    // values 里可能含富文本/链接（text 类属性的 href mark），递归重写内部链接
    values: rewriteInternalLinks(
      row.values,
      maps.notes,
      maps.reading_items,
      maps.synced_blocks,
      maps.db_databases,
      maps.tasks
    ),
  }));

  // 033 任务工作台新表（v2 备份无这些 key，用 || [] 兜底）
  data.task_lists = (backup.data.task_lists || []).map((row) => withId(row, maps.task_lists));
  data.task_reminders = (backup.data.task_reminders || []).map((row) => ({
    ...withId(row, maps.task_reminders),
    task_id: remap(row.task_id, maps.tasks),
  }));
  data.task_attachments = (backup.data.task_attachments || []).map((row) => ({
    ...withId(row, maps.task_attachments),
    task_id: remap(row.task_id, maps.tasks),
  }));
  data.task_activities = (backup.data.task_activities || []).map((row) => ({
    ...withId(row, maps.task_activities),
    task_id: remap(row.task_id, maps.tasks),
  }));
  data.task_templates = (backup.data.task_templates || []).map((row) => withId(row, maps.task_templates));
  data.countdown_days = (backup.data.countdown_days || []).map((row) =>
    withId(row, maps.countdown_days)
  );
  // 058（P0-04）：速记与任务↔笔记双链（老备份缺表按空处理）
  data.memos = (backup.data.memos || []).map((row) => withId(row, maps.memos));
  data.task_item_refs = (backup.data.task_item_refs || []).map((row) => ({
    ...withId(row, maps.task_item_refs),
    task_id: remap(row.task_id, maps.tasks),
    note_id: remap(row.note_id, maps.notes),
  }));

  // R11：memo_notes 引用重映射（memo_id → 新 memos，note_id → 新 notes）
  data.memo_notes = (backup.data.memo_notes || []).map((row) => ({
    ...withId(row, maps.memo_notes),
    memo_id: remap(row.memo_id, maps.memos),
    note_id: remap(row.note_id, maps.notes),
  }));

  // tasks 新列的外键重映射（list_id → task_lists）
  data.tasks = data.tasks.map((row) => ({
    ...row,
    list_id: row.list_id ? remapOptional(row.list_id as string, maps.task_lists) : null,
  }));

  return { restore_payload_version: 1, data };
}

function withId(row: BackupRow, map: Map<string, string>): BackupRow {
  return { ...row, id: remap(row.id, map) };
}

function remap(value: unknown, map: Map<string, string>): string {
  const mapped = typeof value === "string" ? map.get(value) : undefined;
  if (!mapped) throw new Error(`Missing restore mapping for ${String(value)}`);
  return mapped;
}

function remapOptional(
  value: unknown,
  map: Map<string, string>
): string | null {
  return value == null ? null : remap(value, map);
}

function rewriteInternalLinks(
  value: unknown,
  noteIds: Map<string, string>,
  readingIds: Map<string, string>,
  syncedBlockIds?: Map<string, string>,
  databaseIds?: Map<string, string>,
  taskIds?: Map<string, string>
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteInternalLinks(entry, noteIds, readingIds, syncedBlockIds, databaseIds, taskIds));
  }
  if (!isRecord(value)) return value;

  const rewritten: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "href" && typeof entry === "string") {
      rewritten[key] = entry.replace(
        /\/(notes|library)\/([0-9a-f-]{36})(?=[/?#]|$)/gi,
        (_match, kind: "notes" | "library", oldId: string) => {
          const mapped =
            kind === "notes" ? noteIds.get(oldId) : readingIds.get(oldId);
          if (!mapped) throw new Error(`Unknown internal link target ${oldId}`);
          return `/${kind}/${mapped}`;
        }
      );
    } else if (key === "syncedId" && typeof entry === "string" && entry.length > 0 && syncedBlockIds) {
      // 同步区块引用：syncedId 直接引用 synced_blocks 表的主键，需要重映射；
      // 空字符串（未绑定的占位块）原样保留
      const mapped = syncedBlockIds.get(entry);
      if (!mapped) throw new Error(`Unknown synced block reference ${entry}`);
      rewritten[key] = mapped;
    } else if (key === "databaseId" && typeof entry === "string" && entry.length > 0 && databaseIds) {
      // 数据库块引用：attrs.databaseId 指向 db_databases.id，需要重映射；
      // 空字符串（未绑定的占位块）原样保留
      const mapped = databaseIds.get(entry);
      if (!mapped) throw new Error(`Unknown database reference ${entry}`);
      rewritten[key] = mapped;
    } else if (key === "taskId" && taskIds) {
      // 任务绑定块（P0-04）：taskItem.attrs.taskId 指向 tasks.id，需要重映射；
      // null/空字符串（未绑定的清单项）原样保留
      if (entry == null || entry === "") {
        rewritten[key] = entry;
      } else if (typeof entry === "string") {
        const mapped = taskIds.get(entry);
        if (!mapped) throw new Error(`Unknown task binding reference ${entry}`);
        rewritten[key] = mapped;
      } else {
        rewritten[key] = rewriteInternalLinks(entry, noteIds, readingIds, syncedBlockIds, databaseIds, taskIds);
      }
    } else {
      rewritten[key] = rewriteInternalLinks(entry, noteIds, readingIds, syncedBlockIds, databaseIds, taskIds);
    }
  }
  return rewritten;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
