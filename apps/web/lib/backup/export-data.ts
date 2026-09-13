/**
 * 备份导出的数据采集层（B01 抽取自 settings 页，供页面与恢复演练脚本共用，
 * 消除「演练脚本与真实导出各写一份查询」的漂移）。
 *
 * 表清单与列 = BACKUP_TABLES 合同（lib/backup/schema.ts），顺序必须一致；
 * fetchBackupData 以登录用户会话执行（RLS 决定回收站行是否可见）。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BACKUP_MAX_ROWS_PER_TABLE,
  BACKUP_TABLES,
  type BackupData,
  type BackupRow,
} from "./schema";

interface TableQueryConfig {
  table: (typeof BACKUP_TABLES)[number];
  columns: string;
  userOwned?: boolean;
  order: string[];
  /** RLS 不滤软删行时（task_lists）显式只取活跃行——回收站行不进备份（manifest excluded: soft_deleted） */
  activeOnly?: boolean;
}

export const BACKUP_TABLE_QUERIES: readonly TableQueryConfig[] = [
  {
    table: "reading_items",
    columns:
      "id, url, title, content, excerpt, cover_image, reading_status, reading_progress, is_pinned, full_width, started_reading_at, completed_reading_at, created_at, updated_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "notes",
    columns:
      "id, title, content, reading_item_id, icon, cover_url, cover_position, parent_note_id, full_width, font_family, small_font, is_pinned, last_edit_by, created_at, updated_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "tags",
    columns: "id, name, color, created_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "item_tags",
    columns: "item_id, tag_id",
    order: ["item_id", "tag_id"],
  },
  {
    table: "note_tags",
    columns: "note_id, tag_id",
    order: ["note_id", "tag_id"],
  },
  {
    table: "tasks",
    columns:
      "id, title, description, status, priority, category, due_date, estimated_minutes, actual_minutes, reading_item_id, note_id, parent_task_id, list_id, is_pinned, sort_order, completed_at, created_at, updated_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "task_dependencies",
    columns: "task_id, depends_on_task_id, created_at",
    userOwned: true,
    order: ["task_id", "depends_on_task_id"],
  },
  {
    table: "task_checklists",
    columns:
      "id, task_id, content, is_completed, sort_order, created_at, updated_at",
    order: ["id"],
  },
  {
    table: "task_tags",
    columns: "task_id, tag_id",
    order: ["task_id", "tag_id"],
  },
  {
    table: "lessons",
    columns:
      "id, title, content, lesson_type, task_id, reading_item_id, note_id, created_at, updated_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "lesson_tags",
    columns: "lesson_id, tag_id",
    order: ["lesson_id", "tag_id"],
  },
  {
    table: "highlights",
    columns:
      "id, reading_item_id, content, note, color, anchor_path, anchor_offset, note_id, task_id, created_at, updated_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "favorites",
    columns: "id, target_type, target_id, note, created_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "note_versions",
    columns: "id, note_id, content, title, message, created_at",
    order: ["id"],
  },
  {
    table: "note_comment_threads",
    columns: "id, note_id, block_id, resolved_at, created_at, updated_at",
    order: ["id"],
  },
  {
    table: "note_comments",
    columns: "id, thread_id, body, created_at, updated_at",
    order: ["id"],
  },
  {
    table: "note_suggestions",
    columns:
      "id, note_id, block_id, original_block, proposed_block, status, created_at, updated_at",
    order: ["id"],
  },
  {
    table: "synced_blocks",
    columns: "id, content, created_at, updated_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "db_databases",
    columns:
      "id, parent_note_id, title, icon, schema, views, created_at, updated_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "db_rows",
    columns: "id, database_id, sort, values, created_at, updated_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "task_lists",
    columns: "id, name, icon, color, sort_order, is_default, created_at, updated_at",
    userOwned: true,
    activeOnly: true,
    order: ["id"],
  },
  {
    table: "task_reminders",
    columns: "id, task_id, anchor, offset_minutes, notified_at, created_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "task_attachments",
    columns: "id, task_id, name, bucket, path, mime_type, size_bytes, created_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "task_activities",
    columns: "id, task_id, action, detail, created_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "task_templates",
    columns: "id, name, template, created_at, updated_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "countdown_days",
    columns: "id, title, target_date, repeat_annually, deleted_at, created_at, updated_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "memos",
    columns: "id, content, tags, deleted_at, created_at, updated_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "task_item_refs",
    columns: "id, task_id, note_id, block_id, created_at",
    userOwned: true,
    order: ["id"],
  },
  {
    table: "memo_notes",
    columns: "id, memo_id, note_id, created_at",
    userOwned: true,
    order: ["id"],
  },
] as const;

/**
 * 按登录用户（RLS）逐表分页拉取全部行。表顺序与 BACKUP_TABLES 一致，
 * 单表超限直接抛错（与 settings 页原实现同语义）。
 */
export async function fetchBackupData(
  supabase: SupabaseClient,
  userId: string
): Promise<BackupData> {
  const pageSize = 500;
  const results = await Promise.all(
    BACKUP_TABLE_QUERIES.map(async (config) => {
      const rows: BackupRow[] = [];
      for (let offset = 0; ; offset += pageSize) {
        let query = supabase.from(config.table).select(config.columns);
        if ("userOwned" in config && config.userOwned) {
          query = query.eq("user_id", userId);
        }
        if (config.activeOnly) {
          query = query.is("deleted_at", null);
        }
        for (const field of config.order) {
          query = query.order(field, { ascending: true });
        }

        const result = await query.range(offset, offset + pageSize - 1);
        if (result.error) {
          throw new Error(`${config.table} 导出失败: ${result.error.message}`);
        }
        const page = (result.data ?? []) as unknown as BackupRow[];
        rows.push(...page);
        if (rows.length > BACKUP_MAX_ROWS_PER_TABLE) {
          throw new Error(
            `${config.table} 超过 ${BACKUP_MAX_ROWS_PER_TABLE} 条，无法生成安全备份`
          );
        }
        if (page.length < pageSize) break;
      }
      return rows;
    })
  );

  if (
    BACKUP_TABLE_QUERIES.some(
      (config, index) => config.table !== BACKUP_TABLES[index]
    )
  ) {
    throw new Error("备份表顺序与格式合同不一致");
  }

  return Object.fromEntries(
    BACKUP_TABLES.map((table, index) => [table, results[index]])
  ) as unknown as BackupData;
}

const idSetOf = (rows: BackupRow[]): Set<string> =>
  new Set(rows.map((row) => String(row.id)));

/**
 * 导出剪枝（B01 实测缺陷修复）：RLS 只挡「有 deleted_at 过滤策略」的表，
 * 回收站行的子行（note_versions / note_tags / task_checklists / task_dependencies /
 * task_item_refs / task_tags / task_reminders / task_attachments / task_activities——
 * 这些表的 SELECT 策略按属主 join 或仅 user_id，不过滤父行软删）会泄漏进导出，
 * 而父行不在 → 校验 BROKEN_REFERENCE → 整份导出失败。
 *
 * 两步处理（均在导出侧完成，保持 inspect/restore 的严格校验不变）：
 *   1. 孤儿子行剔除——引用的父行不在导出集则丢行（纯关系行，无独立内容）；
 *   2. 悬空可选引用置 null——业务行本身活跃但引用了被排除的回收站行
 *      （notes.reading_item_id / tasks.list_id / highlights.note_id 等），
 *      丢引用不丢行；任务层级同理（父任务被删 → 子任务升级为根任务）。
 * 内容级悬空引用（href/syncedId/databaseId/taskId）不在此处理——内容 JSON
 * 如实保留，由 schema/restore 按「悬空为合法产品态」放宽（043 链接失效装饰）。
 */
export function pruneExportData(data: BackupData): BackupData {
  const readingIds = idSetOf(data.reading_items);
  const noteIds = idSetOf(data.notes);
  const tagIds = idSetOf(data.tags);
  const taskIds = idSetOf(data.tasks);
  const lessonIds = idSetOf(data.lessons);
  const threadIds = idSetOf(data.note_comment_threads);
  const databaseIds = idSetOf(data.db_databases);
  const memoIds = idSetOf(data.memos);
  const listIds = idSetOf(data.task_lists);

  const kept = { ...data };

  // 1) 行级悬空可选引用 → null
  kept.notes = data.notes.map((row) => ({
    ...row,
    reading_item_id:
      row.reading_item_id == null || readingIds.has(String(row.reading_item_id))
        ? row.reading_item_id
        : null,
    parent_note_id:
      row.parent_note_id == null || noteIds.has(String(row.parent_note_id))
        ? row.parent_note_id
        : null,
  }));
  kept.tasks = data.tasks.map((row) => ({
    ...row,
    reading_item_id:
      row.reading_item_id == null || readingIds.has(String(row.reading_item_id))
        ? row.reading_item_id
        : null,
    note_id:
      row.note_id == null || noteIds.has(String(row.note_id)) ? row.note_id : null,
    parent_task_id:
      row.parent_task_id == null || taskIds.has(String(row.parent_task_id))
        ? row.parent_task_id
        : null,
    list_id:
      row.list_id == null || listIds.has(String(row.list_id)) ? row.list_id : null,
  }));
  kept.lessons = data.lessons.map((row) => ({
    ...row,
    task_id:
      row.task_id == null || taskIds.has(String(row.task_id)) ? row.task_id : null,
    reading_item_id:
      row.reading_item_id == null || readingIds.has(String(row.reading_item_id))
        ? row.reading_item_id
        : null,
    note_id:
      row.note_id == null || noteIds.has(String(row.note_id)) ? row.note_id : null,
  }));
  kept.highlights = data.highlights
    // reading_item_id 是必填引用：父文章不在导出集（RLS 挡回收站行，正常不发生；
    // 防御性丢行）则高亮行整体剔除
    .filter((row) => readingIds.has(String(row.reading_item_id)))
    .map((row) => ({
      ...row,
      note_id:
        row.note_id == null || noteIds.has(String(row.note_id)) ? row.note_id : null,
      task_id:
        row.task_id == null || taskIds.has(String(row.task_id)) ? row.task_id : null,
    }));
  kept.favorites = data.favorites.filter((row) => {
    const targets =
      row.target_type === "reading"
        ? readingIds
        : row.target_type === "note"
          ? noteIds
          : taskIds;
    return targets.has(String(row.target_id));
  });
  kept.db_databases = data.db_databases.map((row) => ({
    ...row,
    parent_note_id:
      row.parent_note_id == null || noteIds.has(String(row.parent_note_id))
        ? row.parent_note_id
        : null,
  }));

  // 2) 孤儿子行剔除
  kept.item_tags = data.item_tags.filter(
    (row) => readingIds.has(String(row.item_id)) && tagIds.has(String(row.tag_id))
  );
  kept.note_tags = data.note_tags.filter(
    (row) => noteIds.has(String(row.note_id)) && tagIds.has(String(row.tag_id))
  );
  kept.note_versions = data.note_versions.filter((row) =>
    noteIds.has(String(row.note_id))
  );
  kept.note_comment_threads = data.note_comment_threads.filter((row) =>
    noteIds.has(String(row.note_id))
  );
  kept.note_comments = data.note_comments.filter((row) =>
    threadIds.has(String(row.thread_id))
  );
  kept.note_suggestions = data.note_suggestions.filter((row) =>
    noteIds.has(String(row.note_id))
  );
  kept.task_checklists = data.task_checklists.filter((row) =>
    taskIds.has(String(row.task_id))
  );
  kept.task_dependencies = data.task_dependencies.filter(
    (row) =>
      taskIds.has(String(row.task_id)) && taskIds.has(String(row.depends_on_task_id))
  );
  kept.task_tags = data.task_tags.filter(
    (row) => taskIds.has(String(row.task_id)) && tagIds.has(String(row.tag_id))
  );
  kept.task_reminders = data.task_reminders.filter((row) =>
    taskIds.has(String(row.task_id))
  );
  kept.task_attachments = data.task_attachments.filter((row) =>
    taskIds.has(String(row.task_id))
  );
  kept.task_activities = data.task_activities.filter((row) =>
    taskIds.has(String(row.task_id))
  );
  kept.task_item_refs = data.task_item_refs.filter(
    (row) => taskIds.has(String(row.task_id)) && noteIds.has(String(row.note_id))
  );
  kept.memo_notes = data.memo_notes.filter(
    (row) => memoIds.has(String(row.memo_id)) && noteIds.has(String(row.note_id))
  );
  kept.db_rows = data.db_rows.filter((row) =>
    databaseIds.has(String(row.database_id))
  );
  kept.lesson_tags = data.lesson_tags.filter(
    (row) => lessonIds.has(String(row.lesson_id)) && tagIds.has(String(row.tag_id))
  );

  return kept;
}
