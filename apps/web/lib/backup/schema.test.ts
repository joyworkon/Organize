import { describe, expect, it } from "vitest";
import {
  BACKUP_TABLES,
  createBackupV2,
  inspectBackupV2,
  type BackupData,
} from "./schema";
import { prepareRestorePayload } from "./restore";

const ids = {
  reading: "10000000-0000-4000-8000-000000000001",
  note: "20000000-0000-4000-8000-000000000001",
  tag: "30000000-0000-4000-8000-000000000001",
  task: "40000000-0000-4000-8000-000000000001",
  childTask: "40000000-0000-4000-8000-000000000002",
  checklist: "50000000-0000-4000-8000-000000000001",
  lesson: "60000000-0000-4000-8000-000000000001",
  highlight: "70000000-0000-4000-8000-000000000001",
  favorite: "80000000-0000-4000-8000-000000000001",
  version: "90000000-0000-4000-8000-000000000001",
  thread: "a0000000-0000-4000-8000-000000000001",
  comment: "b0000000-0000-4000-8000-000000000001",
  suggestion: "c0000000-0000-4000-8000-000000000001",
  synced: "d0000000-0000-4000-8000-000000000001",
  database: "e0000000-0000-4000-8000-000000000001",
  dbRow: "f0000000-0000-4000-8000-000000000001",
  // 033 任务工作台
  taskList: "10000000-0000-4000-8000-000000000002",
  taskReminder: "20000000-0000-4000-8000-000000000002",
  // 058（P0-04）
  memo: "30000000-0000-4000-8000-000000000002",
  taskItemRef: "40000000-0000-4000-8000-000000000002",
};
const timestamp = "2026-07-29T12:00:00.000Z";

function fixtureData(): BackupData {
  return {
    reading_items: [
      {
        id: ids.reading,
        url: "https://example.com",
        title: "Reading",
        content: "<p>Article</p>",
        excerpt: null,
        cover_image: null,
        reading_status: "read",
        reading_progress: 1,
        is_pinned: false,
        full_width: true,
        started_reading_at: timestamp,
        completed_reading_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    notes: [
      {
        id: ids.note,
        title: "Note",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  marks: [
                    {
                      type: "link",
                      attrs: { href: `/library/${ids.reading}#block-a` },
                    },
                  ],
                  text: "linked",
                },
              ],
            },
            // 绑定了 syncedId 的同步块：恢复时 syncedId 必须被重映射
            {
              type: "syncedBlock",
              attrs: { syncedId: ids.synced, hydrated: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "sync-content" }] }],
            },
            // 未绑定的占位同步块：syncedId="" 必须原样保留，不抛错
            {
              type: "syncedBlock",
              attrs: { syncedId: "", hydrated: true },
              content: [{ type: "paragraph" }],
            },
            // P0-04：任务绑定块——taskItem.attrs.taskId 必须被重映射；
            // 未绑定（taskId 为 null）原样保留
            {
              type: "taskItem",
              attrs: { taskId: ids.task },
              content: [{ type: "paragraph", content: [{ type: "text", text: "task-bound" }] }],
            },
            {
              type: "taskItem",
              attrs: { taskId: null },
              content: [{ type: "paragraph" }],
            },
          ],
        },
        reading_item_id: ids.reading,
        is_pinned: false,
        full_width: false,
        font_family: "default",
        small_font: false,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    tags: [{ id: ids.tag, name: "Tag", color: "blue", created_at: timestamp }],
    item_tags: [{ item_id: ids.reading, tag_id: ids.tag }],
    note_tags: [{ note_id: ids.note, tag_id: ids.tag }],
    tasks: [
      {
        id: ids.task,
        title: "Task",
        description: null,
        status: "done",
        priority: "medium",
        category: "work",
        due_date: null,
        estimated_minutes: null,
        actual_minutes: null,
        reading_item_id: ids.reading,
        note_id: ids.note,
        is_pinned: false,
        sort_order: 0,
        completed_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    task_dependencies: [],
    task_checklists: [
      {
        id: ids.checklist,
        task_id: ids.task,
        content: "Check",
        is_completed: true,
        sort_order: 0,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    task_tags: [{ task_id: ids.task, tag_id: ids.tag }],
    lessons: [
      {
        id: ids.lesson,
        title: "Lesson",
        content: { type: "doc", content: [] },
        lesson_type: "lesson",
        task_id: ids.task,
        reading_item_id: ids.reading,
        note_id: ids.note,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    lesson_tags: [{ lesson_id: ids.lesson, tag_id: ids.tag }],
    highlights: [
      {
        id: ids.highlight,
        reading_item_id: ids.reading,
        content: "Highlight",
        note: null,
        color: "yellow",
        anchor_path: null,
        anchor_offset: null,
        note_id: ids.note,
        task_id: ids.task,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    favorites: [
      {
        id: ids.favorite,
        target_type: "note",
        target_id: ids.note,
        note: null,
        created_at: timestamp,
      },
    ],
    note_versions: [
      {
        id: ids.version,
        note_id: ids.note,
        content: { type: "doc", content: [] },
        title: "Version",
        message: null,
        created_at: timestamp,
      },
    ],
    note_comment_threads: [
      {
        id: ids.thread,
        note_id: ids.note,
        block_id: "block-a",
        resolved_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    note_comments: [
      {
        id: ids.comment,
        thread_id: ids.thread,
        body: "Comment",
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    note_suggestions: [
      {
        id: ids.suggestion,
        note_id: ids.note,
        block_id: "block-a",
        original_block: { type: "paragraph" },
        proposed_block: { type: "paragraph" },
        status: "pending",
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    synced_blocks: [
      {
        id: ids.synced,
        content: [
          { type: "paragraph", content: [{ type: "text", text: "shared" }] },
        ],
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    db_databases: [
      {
        id: ids.database,
        // 挂在 fixture note 下，模拟整页数据库
        parent_note_id: ids.note,
        title: "书籍清单",
        icon: "📚",
        schema: [
          { id: "prop_name", name: "书名", type: "text" },
          { id: "prop_status", name: "状态", type: "select", options: [{ id: "opt_reading", name: "在读" }] },
          { id: "prop_done", name: "读完", type: "checkbox" },
        ],
        views: [{ id: "default_view", type: "table", config: {} }],
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    db_rows: [
      {
        id: ids.dbRow,
        database_id: ids.database,
        sort: 0,
        values: {
          prop_name: "深入理解计算机系统",
          prop_status: "opt_reading",
          prop_done: false,
        },
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    // 033 任务工作台新增（fixture 用空数组 + 一个 task_list + reminder 示例）
    task_lists: [
      {
        id: ids.taskList,
        name: "工作",
        icon: "💼",
        color: "#3b82f6",
        sort_order: 0,
        is_default: true,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    task_reminders: [
      {
        id: ids.taskReminder,
        task_id: ids.task,
        anchor: "start",
        offset_minutes: -15,
        notified_at: null,
        created_at: timestamp,
      },
    ],
    task_attachments: [],
    task_activities: [],
    task_templates: [],
    countdown_days: [],
    memos: [
      {
        id: ids.memo,
        content: "备份往返 #合同",
        tags: ["合同"],
        deleted_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    task_item_refs: [
      {
        id: ids.taskItemRef,
        task_id: ids.task,
        note_id: ids.note,
        block_id: "blk-backup-1",
        created_at: timestamp,
      },
    ],
  };
}

describe("Backup V2", () => {
  it("validates a complete dependency-ordered fixture", () => {
    const backup = createBackupV2(fixtureData(), timestamp);
    expect(inspectBackupV2(JSON.stringify(backup))).toEqual({
      ok: true,
      backup,
      issues: [],
    });
    expect(Object.keys(backup.data)).toEqual(BACKUP_TABLES);
  });

  it("rejects missing tables, broken references, and sensitive fields", () => {
    const backup = createBackupV2(fixtureData(), timestamp) as unknown as Record<
      string,
      unknown
    >;
    const data = backup.data as Record<string, Array<Record<string, unknown>>>;
    delete data.note_comments;
    data.notes[0].user_id = "leak";
    data.tasks[0].note_id = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    const result = inspectBackupV2(backup);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((entry) => entry.code)).toEqual(
        expect.arrayContaining([
          "INVALID_TABLE",
          "SENSITIVE_FIELD",
          "BROKEN_REFERENCE",
        ])
      );
    }
  });

  it("rejects V1 and unknown versions", () => {
    expect(inspectBackupV2({ version: 1 })).toMatchObject({ ok: false });
    expect(inspectBackupV2({ format: "organize-backup", version: 99 })).toMatchObject({
      ok: false,
    });
  });

  it("remaps every UUID, relationship, favorite target, and internal link", () => {
    const backup = createBackupV2(fixtureData(), timestamp);
    let sequence = 1;
    const payload = prepareRestorePayload(backup, () => {
      const suffix = String(sequence++).padStart(12, "0");
      return `f0000000-0000-4000-8000-${suffix}`;
    });

    const restoredReadingId = String(payload.data.reading_items[0].id);
    const restoredNoteId = String(payload.data.notes[0].id);
    expect(restoredReadingId).not.toBe(ids.reading);
    expect(restoredNoteId).not.toBe(ids.note);
    expect(payload.data.notes[0].reading_item_id).toBe(restoredReadingId);
    expect(payload.data.tasks[0].note_id).toBe(restoredNoteId);
    expect(payload.data.favorites[0].target_id).toBe(restoredNoteId);
    expect(JSON.stringify(payload.data.notes[0].content)).toContain(
      `/library/${restoredReadingId}#block-a`
    );
    expect(JSON.stringify(payload)).not.toContain(ids.note);
    expect(JSON.stringify(payload)).not.toContain(ids.reading);
    // P0-04：任务绑定块与两张新表的重映射
    const restoredTaskId = String(payload.data.tasks[0].id);
    const taskItems = (payload.data.notes[0].content as { content?: Array<{ attrs?: { taskId?: unknown } }> }).content?.filter((node) => (node as { type?: string }).type === "taskItem") ?? [];
    expect(taskItems[0]?.attrs?.taskId).toBe(restoredTaskId);
    expect(taskItems[1]?.attrs?.taskId).toBeNull();
    expect(String(payload.data.task_item_refs[0].task_id)).toBe(restoredTaskId);
    expect(String(payload.data.task_item_refs[0].note_id)).toBe(restoredNoteId);
    expect(String(payload.data.memos[0].id)).not.toBe(ids.memo);
    expect((payload.data.memos[0].tags as string[]).join()).toBe("合同");
    // 重映射后旧 ID 不再出现在 payload 任何位置
    expect(JSON.stringify(payload)).not.toContain(ids.taskItemRef);
    expect(JSON.stringify(payload)).not.toContain(ids.memo);
  });

  it("v3 老备份（缺 memos/task_item_refs 键）补空后可导入（P0-04 兼容）", () => {
    const backup = createBackupV2(fixtureData(), timestamp) as unknown as Record<string, unknown>;
    backup.version = 3;
    const data = backup.data as Record<string, unknown>;
    const counts = (backup.manifest as { counts: Record<string, number> }).counts;
    delete data.memos;
    delete data.task_item_refs;
    // 真实 v3 文件的 manifest 也没有新表键
    delete counts.memos;
    delete counts.task_item_refs;
    const result = inspectBackupV2(backup);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.backup.data.memos).toEqual([]);
      expect(result.backup.data.task_item_refs).toEqual([]);
    }
    // v4 备份缺新表则必须报错（新格式不允许含糊）
    const v4 = createBackupV2(fixtureData(), timestamp) as unknown as Record<string, unknown>;
    delete (v4.data as Record<string, unknown>).memos;
    expect(inspectBackupV2(v4).ok).toBe(false);
  });

  it("接受完整父子链并在恢复时重映射 parent_task_id", () => {
    const data = fixtureData();
    data.tasks[0].parent_task_id = null;
    data.tasks.push({
      ...data.tasks[0],
      id: ids.childTask,
      title: "Child task",
      parent_task_id: ids.task,
    });
    const backup = createBackupV2(data, timestamp);
    expect(inspectBackupV2(backup).ok).toBe(true);

    let sequence = 1;
    const payload = prepareRestorePayload(backup, () => {
      const suffix = String(sequence++).padStart(12, "0");
      return `b0000000-0000-4000-8000-${suffix}`;
    });
    expect(payload.data.tasks[0].parent_task_id).toBeNull();
    expect(payload.data.tasks[1].parent_task_id).toBe(payload.data.tasks[0].id);
    expect(payload.data.tasks[1].parent_task_id).not.toBe(ids.task);
  });

  it("拒绝不存在的父任务和任意深度的层级循环", () => {
    const broken = createBackupV2(fixtureData(), timestamp) as any;
    broken.data.tasks[0].parent_task_id =
      "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const brokenResult = inspectBackupV2(broken);
    expect(brokenResult.ok).toBe(false);
    if (!brokenResult.ok) {
      expect(brokenResult.issues.map((entry) => entry.code)).toContain(
        "BROKEN_REFERENCE"
      );
    }

    const cyclic = createBackupV2(fixtureData(), timestamp) as any;
    cyclic.data.tasks[0].parent_task_id = ids.childTask;
    cyclic.data.tasks.push({
      ...cyclic.data.tasks[0],
      id: ids.childTask,
      title: "Child task",
      parent_task_id: ids.task,
    });
    const cyclicResult = inspectBackupV2(cyclic);
    expect(cyclicResult.ok).toBe(false);
    if (!cyclicResult.ok) {
      expect(cyclicResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "INVALID_ROW",
            message: "任务层级不能形成循环",
          }),
        ])
      );
    }
  });

  it("兼容未包含 parent_task_id 的旧备份", () => {
    const backup = createBackupV2(fixtureData(), timestamp) as any;
    delete backup.data.tasks[0].parent_task_id;
    expect(inspectBackupV2(backup).ok).toBe(true);
    expect(prepareRestorePayload(backup).data.tasks[0].parent_task_id).toBeNull();
  });

  it("校验依赖引用、自依赖、重复边和任意深度循环，并重映射两端 ID", () => {
    const data = fixtureData();
    data.tasks.push({
      ...data.tasks[0],
      id: ids.childTask,
      title: "Dependent task",
    });
    data.task_dependencies.push({
      task_id: ids.childTask,
      depends_on_task_id: ids.task,
      created_at: timestamp,
    });
    const backup = createBackupV2(data, timestamp);
    expect(inspectBackupV2(backup).ok).toBe(true);

    const payload = prepareRestorePayload(backup);
    expect(payload.data.task_dependencies[0].task_id).toBe(payload.data.tasks[1].id);
    expect(payload.data.task_dependencies[0].depends_on_task_id).toBe(
      payload.data.tasks[0].id
    );

    const self = structuredClone(backup);
    self.data.task_dependencies[0].depends_on_task_id = ids.childTask;
    expect(inspectBackupV2(self).ok).toBe(false);

    const duplicate = structuredClone(backup);
    duplicate.data.task_dependencies.push({
      ...duplicate.data.task_dependencies[0],
    });
    expect(inspectBackupV2(duplicate).ok).toBe(false);

    const cyclic = structuredClone(backup);
    cyclic.data.task_dependencies.push({
      task_id: ids.task,
      depends_on_task_id: ids.childTask,
      created_at: timestamp,
    });
    const cyclicResult = inspectBackupV2(cyclic);
    expect(cyclicResult.ok).toBe(false);
    if (!cyclicResult.ok) {
      expect(cyclicResult.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: "任务依赖不能形成循环" }),
        ])
      );
    }
  });

  it("恢复时重映射高亮关联的笔记和任务 ID", () => {
    const payload = prepareRestorePayload(createBackupV2(fixtureData(), timestamp));

    expect(payload.data.highlights[0].note_id).toBe(payload.data.notes[0].id);
    expect(payload.data.highlights[0].task_id).toBe(payload.data.tasks[0].id);
  });

  it("accepts legacy backups that omit full_width / font_family / small_font", () => {
    const backup = createBackupV2(fixtureData(), timestamp) as unknown as Record<
      string,
      unknown
    >;
    const data = backup.data as Record<string, Array<Record<string, unknown>>>;
    delete data.notes[0].full_width;
    delete data.notes[0].font_family;
    delete data.notes[0].small_font;
    // 044 之前的备份没有 reading_items.full_width
    delete data.reading_items[0].full_width;

    const result = inspectBackupV2(backup);
    expect(result.ok).toBe(true);

    const payload = prepareRestorePayload(backup as any);
    expect(payload.data.notes[0].full_width).toBe(false);
    expect(payload.data.notes[0].font_family).toBe("default");
    expect(payload.data.notes[0].small_font).toBe(false);
    expect(payload.data.reading_items[0].full_width).toBeUndefined();
  });

  it("066 归属列：新备份可携带 last_edit_by，旧备份缺省仍通过（restore 不搬运）", () => {
    const withAttribution = createBackupV2(fixtureData(), timestamp) as unknown as Record<
      string,
      unknown
    >;
    (withAttribution.data as Record<string, Array<Record<string, unknown>>>).notes[0][
      "last_edit_by"
    ] = "20000000-0000-4000-8000-000000000099";
    expect(inspectBackupV2(withAttribution).ok).toBe(true);

    // 旧备份（066 之前导出）没有该字段：optional 保证兼容
    const legacy = createBackupV2(fixtureData(), timestamp) as unknown as Record<
      string,
      unknown
    >;
    const legacyData = legacy.data as Record<string, Array<Record<string, unknown>>>;
    delete legacyData.notes[0].last_edit_by;
    expect(inspectBackupV2(legacy).ok).toBe(true);

    // restore 链刻意不消费 last_edit_by（见 066 迁移头注释）：prepareRestorePayload 置空
    const payload = prepareRestorePayload(withAttribution as any);
    expect(payload.data.notes[0].last_edit_by).toBeNull();
  });

  it("accepts reading_items.full_width from current exports and preserves it on restore", () => {
    const backup = createBackupV2(fixtureData(), timestamp);
    expect(inspectBackupV2(backup).ok).toBe(true);
    const payload = prepareRestorePayload(backup);
    expect(payload.data.reading_items[0].full_width).toBe(true);
  });

  it("rejects invalid font_family values and preserves valid ones", () => {
    const backup = createBackupV2(fixtureData(), timestamp) as unknown as Record<
      string,
      unknown
    >;
    const bad = JSON.parse(JSON.stringify(backup));
    (bad.data as any).notes[0].font_family = "comic-sans";
    expect(inspectBackupV2(bad).ok).toBe(false);

    const good = createBackupV2(fixtureData(), timestamp) as unknown as Record<
      string,
      unknown
    >;
    (good.data as any).notes[0].font_family = "serif";
    (good.data as any).notes[0].full_width = true;
    (good.data as any).notes[0].small_font = true;
    expect(inspectBackupV2(good).ok).toBe(true);

    const payload = prepareRestorePayload(good as any);
    expect(payload.data.notes[0].font_family).toBe("serif");
    expect(payload.data.notes[0].full_width).toBe(true);
    expect(payload.data.notes[0].small_font).toBe(true);
  });

  it("remaps synced_blocks ids and syncedId attrs inside notes, preserving empty syncedId", () => {
    const backup = createBackupV2(fixtureData(), timestamp);
    let sequence = 1;
    const payload = prepareRestorePayload(backup, () => {
      const suffix = String(sequence++).padStart(12, "0");
      return `f0000000-0000-4000-8000-${suffix}`;
    });

    // synced_blocks 表里的 id 被重映射
    const restoredSyncedId = String(payload.data.synced_blocks[0].id);
    expect(restoredSyncedId).not.toBe(ids.synced);

    // notes.content 里绑定了 syncedId 的同步块，其 attrs.syncedId 指向新 id
    const noteContent = payload.data.notes[0].content as any;
    const bound = noteContent.content.find(
      (n: any) => n.type === "syncedBlock" && n.attrs.syncedId !== ""
    );
    expect(bound.attrs.syncedId).toBe(restoredSyncedId);

    // 未绑定的占位块 syncedId="" 被保留为空字符串，不报错
    const placeholder = noteContent.content.find(
      (n: any) => n.type === "syncedBlock" && n.attrs.syncedId === ""
    );
    expect(placeholder).toBeDefined();
    expect(placeholder.attrs.syncedId).toBe("");

    // 整个 payload 里不能再出现旧的 synced id
    expect(JSON.stringify(payload)).not.toContain(ids.synced);
  });

  it("synced_blocks 备份要求 content 为数组（节点数组）", () => {
    const backup = createBackupV2(fixtureData(), timestamp) as any;
    // 把 content 改成对象（非法）
    backup.data.synced_blocks[0].content = { type: "doc" };
    expect(inspectBackupV2(backup).ok).toBe(false);

    // 改回数组合法
    const good = createBackupV2(fixtureData(), timestamp);
    expect(inspectBackupV2(good).ok).toBe(true);
  });

  it("db_databases/db_rows 通过校验，parent_note_id 与 database_id 引用正确", () => {
    const backup = createBackupV2(fixtureData(), timestamp);
    expect(inspectBackupV2(backup).ok).toBe(true);
    expect(backup.data.db_databases).toHaveLength(1);
    expect(backup.data.db_rows).toHaveLength(1);
    expect(backup.data.db_databases[0].parent_note_id).toBe(ids.note);
    expect(backup.data.db_rows[0].database_id).toBe(ids.database);
  });

  it("db_databases.parent_note_id 必须引用存在的笔记", () => {
    const backup = createBackupV2(fixtureData(), timestamp) as any;
    backup.data.db_databases[0].parent_note_id = "00000000-0000-4000-8000-000000000000";
    expect(inspectBackupV2(backup).ok).toBe(false);

    // parent_note_id = null（行内数据库）合法
    const good = createBackupV2(fixtureData(), timestamp) as any;
    good.data.db_databases[0].parent_note_id = null;
    expect(inspectBackupV2(good).ok).toBe(true);
  });

  it("db_rows.database_id 必须引用存在的 db_databases", () => {
    const backup = createBackupV2(fixtureData(), timestamp) as any;
    backup.data.db_rows[0].database_id = "00000000-0000-4000-8000-000000000000";
    expect(inspectBackupV2(backup).ok).toBe(false);
  });

  it("prepareRestorePayload 重映射 db 相关 id 与 parent_note_id，且不污染 schema/views", () => {
    const backup = createBackupV2(fixtureData(), timestamp);
    let sequence = 1;
    const payload = prepareRestorePayload(backup, () => {
      const suffix = String(sequence++).padStart(12, "0");
      return `a0000000-0000-4000-8000-${suffix}`;
    });

    const newDbId = String(payload.data.db_databases[0].id);
    const newRowId = String(payload.data.db_rows[0].id);
    const newNoteId = String(payload.data.notes[0].id);
    expect(newDbId).not.toBe(ids.database);
    expect(newRowId).not.toBe(ids.dbRow);
    // parent_note_id 指向重映射后的 note
    expect(payload.data.db_databases[0].parent_note_id).toBe(newNoteId);
    // database_id 指向重映射后的 database
    expect(payload.data.db_rows[0].database_id).toBe(newDbId);
    // schema/views 原样保留，id 是属性 id（不是数据库主键），不重映射
    expect((payload.data.db_databases[0].schema as any[])[0].id).toBe("prop_name");
    expect((payload.data.db_databases[0].views as any[])[0].id).toBe("default_view");
    // values 原样保留（属性 key 不是 UUID）
    expect((payload.data.db_rows[0].values as any).prop_name).toBe("深入理解计算机系统");
    // 直接验证旧 id 没出现在 db 行里（避免字符串 contains 误伤其他重映射后的 id）
    expect(payload.data.db_databases[0].id).not.toBe(ids.database);
    expect(payload.data.db_rows[0].id).not.toBe(ids.dbRow);
    expect(payload.data.db_rows[0].database_id).not.toBe(ids.database);
  });
});
