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
      "id, title, description, status, priority, category, due_date, estimated_minutes, actual_minutes, reading_item_id, note_id, parent_task_id, is_pinned, sort_order, completed_at, created_at, updated_at",
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
