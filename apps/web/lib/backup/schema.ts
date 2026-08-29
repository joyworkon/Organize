export const BACKUP_FORMAT = "organize-backup";
export const BACKUP_VERSION = 4;
/** 备份版本兼容范围：v4 是当前格式（058 起收录 memos 与 task_item_refs），v2/v3 仍可导入（新表按空处理） */
export const BACKUP_ACCEPTED_VERSIONS = [2, 3, 4] as const;
export const BACKUP_MAX_BYTES = 10 * 1024 * 1024;
export const BACKUP_MAX_ROWS_PER_TABLE = 10_000;
export const BACKUP_MAX_TOTAL_ROWS = 50_000;

export const BACKUP_TABLES = [
  "reading_items",
  "notes",
  "tags",
  "item_tags",
  "note_tags",
  "tasks",
  "task_dependencies",
  "task_checklists",
  "task_tags",
  "lessons",
  "lesson_tags",
  "highlights",
  "favorites",
  "note_versions",
  "note_comment_threads",
  "note_comments",
  "note_suggestions",
  "synced_blocks",
  "db_databases",
  "db_rows",
  // 033 任务工作台新增
  "task_lists",
  "task_reminders",
  "task_attachments",
  "task_activities",
  "task_templates",
  "countdown_days",
  // 058（P0-04）收录：速记与任务↔笔记双链
  "memos",
  "task_item_refs",
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];
export type BackupRow = Record<string, unknown>;
export type BackupData = Record<BackupTable, BackupRow[]>;

export interface BackupV2 {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  manifest: {
    counts: Record<BackupTable, number>;
    excluded: string[];
  };
  data: BackupData;
}

export interface BackupIssue {
  code:
    | "INVALID_JSON"
    | "INVALID_FORMAT"
    | "UNSUPPORTED_VERSION"
    | "INVALID_MANIFEST"
    | "INVALID_TABLE"
    | "INVALID_ROW"
    | "DUPLICATE_ID"
    | "BROKEN_REFERENCE"
    | "SENSITIVE_FIELD"
    | "LIMIT_EXCEEDED";
  path: string;
  message: string;
}

export type BackupInspection =
  | { ok: true; backup: BackupV2; issues: [] }
  | { ok: false; issues: BackupIssue[] };

type Validator = (value: unknown) => boolean;

interface RowSchema {
  fields: Record<string, Validator>;
  keyFields: string[];
}

const isUuid: Validator = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
const isString: Validator = (value) => typeof value === "string";
const isNullableString: Validator = (value) => value === null || isString(value);
const isBoolean: Validator = (value) => typeof value === "boolean";
const isNumber: Validator = (value) =>
  typeof value === "number" && Number.isFinite(value);
const isInteger: Validator = (value) => Number.isInteger(value);
const isNullableInteger: Validator = (value) => value === null || isInteger(value);
const isTimestamp: Validator = (value) =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));
const isNullableTimestamp: Validator = (value) =>
  value === null || isTimestamp(value);
const isNullableUuid: Validator = (value) => value === null || isUuid(value);
const isJsonObject: Validator = (value) => isRecord(value);
const isJsonArray: Validator = (value) => Array.isArray(value);
const isJsonStructure: Validator = (value) => isRecord(value) || Array.isArray(value);
const isNullableJsonObject: Validator = (
  value
) =>
  value === null || isJsonObject(value);
const optional =
  (validator: Validator): Validator =>
  (value) =>
    value === undefined || validator(value);
const isCoverPosition: Validator = (value) =>
  Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 100;
const oneOf =
  (...values: string[]): Validator =>
  (value) =>
    typeof value === "string" && values.includes(value);

const rowSchemas: Record<BackupTable, RowSchema> = {
  reading_items: {
    fields: {
      id: isUuid,
      url: isString,
      title: isNullableString,
      content: isNullableString,
      excerpt: isNullableString,
      cover_image: isNullableString,
      reading_status: oneOf("unread", "reading", "read"),
      reading_progress: isNumber,
      is_pinned: isBoolean,
      started_reading_at: isNullableTimestamp,
      completed_reading_at: isNullableTimestamp,
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  notes: {
    fields: {
      id: isUuid,
      title: isNullableString,
      content: isNullableJsonObject,
      reading_item_id: isNullableUuid,
      icon: optional(isNullableString),
      cover_url: optional(isNullableString),
      cover_position: optional(isCoverPosition),
      parent_note_id: optional(isNullableUuid),
      full_width: optional(isBoolean),
      font_family: optional(oneOf("default", "serif", "mono")),
      small_font: optional(isBoolean),
      is_pinned: isBoolean,
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  tags: {
    fields: {
      id: isUuid,
      name: isString,
      color: oneOf(
        "gray",
        "red",
        "orange",
        "amber",
        "yellow",
        "green",
        "emerald",
        "teal",
        "cyan",
        "blue",
        "indigo",
        "violet",
        "purple",
        "fuchsia",
        "pink",
        "rose"
      ),
      created_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  item_tags: relationSchema("item_id", "tag_id"),
  note_tags: relationSchema("note_id", "tag_id"),
  tasks: {
    fields: {
      id: isUuid,
      title: isString,
      description: isNullableString,
      status: oneOf("todo", "in_progress", "done", "cancelled"),
      priority: oneOf("high", "medium", "low"),
      category: oneOf("work", "study", "life"),
      due_date: isNullableTimestamp,
      estimated_minutes: isNullableInteger,
      actual_minutes: isNullableInteger,
      reading_item_id: isNullableUuid,
      note_id: isNullableUuid,
      parent_task_id: optional(isNullableUuid),
      is_pinned: isBoolean,
      sort_order: isInteger,
      completed_at: isNullableTimestamp,
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  task_dependencies: {
    fields: {
      task_id: isUuid,
      depends_on_task_id: isUuid,
      created_at: isTimestamp,
    },
    keyFields: ["task_id", "depends_on_task_id"],
  },
  task_checklists: {
    fields: {
      id: isUuid,
      task_id: isUuid,
      content: isString,
      is_completed: isBoolean,
      sort_order: isInteger,
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  task_tags: relationSchema("task_id", "tag_id"),
  lessons: {
    fields: {
      id: isUuid,
      title: isNullableString,
      content: isNullableJsonObject,
      lesson_type: oneOf("reflection", "lesson", "insight"),
      task_id: isNullableUuid,
      reading_item_id: isNullableUuid,
      note_id: isNullableUuid,
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  lesson_tags: relationSchema("lesson_id", "tag_id"),
  highlights: {
    fields: {
      id: isUuid,
      reading_item_id: isUuid,
      content: isString,
      note: isNullableString,
      color: oneOf("yellow", "green", "blue", "pink", "purple"),
      anchor_path: isNullableString,
      anchor_offset: isNullableInteger,
      note_id: optional(isNullableUuid),
      task_id: optional(isNullableUuid),
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  favorites: {
    fields: {
      id: isUuid,
      target_type: oneOf("reading", "note", "task"),
      target_id: isUuid,
      note: isNullableString,
      created_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  note_versions: {
    fields: {
      id: isUuid,
      note_id: isUuid,
      content: isJsonObject,
      title: isNullableString,
      message: isNullableString,
      created_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  note_comment_threads: {
    fields: {
      id: isUuid,
      note_id: isUuid,
      block_id: isString,
      resolved_at: isNullableTimestamp,
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  note_comments: {
    fields: {
      id: isUuid,
      thread_id: isUuid,
      body: isString,
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  note_suggestions: {
    fields: {
      id: isUuid,
      note_id: isUuid,
      block_id: isString,
      original_block: isJsonObject,
      proposed_block: isJsonObject,
      status: oneOf("pending", "accepted", "rejected"),
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  synced_blocks: {
    fields: {
      id: isUuid,
      content: isJsonArray,
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  db_databases: {
    fields: {
      id: isUuid,
      parent_note_id: isNullableUuid,
      title: isString,
      icon: optional(isNullableString),
      schema: isJsonArray,
      views: isJsonArray,
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  db_rows: {
    fields: {
      id: isUuid,
      database_id: isUuid,
      sort: isInteger,
      values: isJsonObject,
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  // 033 任务工作台新增
  task_lists: {
    fields: {
      id: isUuid,
      name: isString,
      icon: (v) => v === null || typeof v === "string",
      color: (v) => v === null || typeof v === "string",
      sort_order: isInteger,
      is_default: (v) => v === true || v === false,
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  task_reminders: {
    fields: {
      id: isUuid,
      task_id: isUuid,
      anchor: (v) => v === "start" || v === "end",
      offset_minutes: isInteger,
      notified_at: (v) => v === null || typeof v === "string",
      created_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  task_attachments: {
    fields: {
      id: isUuid,
      task_id: isUuid,
      name: isString,
      bucket: isString,
      path: isString,
      mime_type: (v) => v === null || typeof v === "string",
      size_bytes: (v) => v === null || typeof v === "number",
      created_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  task_activities: {
    fields: {
      id: isUuid,
      task_id: isUuid,
      action: isString,
      detail: (v) => v === null || (typeof v === "object" && v !== null),
      created_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  task_templates: {
    fields: {
      id: isUuid,
      name: isString,
      template: isJsonObject,
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  countdown_days: {
    fields: {
      id: isUuid,
      title: isString,
      target_date: (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
      repeat_annually: isBoolean,
      deleted_at: isNullableTimestamp,
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  memos: {
    fields: {
      id: isUuid,
      content: isString,
      tags: (value) =>
        Array.isArray(value) && value.every((entry) => typeof entry === "string"),
      deleted_at: isNullableTimestamp,
      created_at: isTimestamp,
      updated_at: isTimestamp,
    },
    keyFields: ["id"],
  },
  task_item_refs: {
    fields: {
      id: isUuid,
      task_id: isUuid,
      note_id: isUuid,
      block_id: isString,
      created_at: isTimestamp,
    },
    keyFields: ["id", "note_id", "block_id"],
  },
};

const REQUIRED_EXCLUSIONS = [
  "auth",
  "plugins",
  "shares",
  "soft_deleted",
  "storage",
];

export function inspectBackupV2(input: unknown): BackupInspection {
  const issues: BackupIssue[] = [];
  let value = input;

  if (typeof input === "string") {
    if (utf8Length(input) > BACKUP_MAX_BYTES) {
      return failure("LIMIT_EXCEEDED", "$", "备份文件超过 10 MiB");
    }
    try {
      value = JSON.parse(input);
    } catch {
      return failure("INVALID_JSON", "$", "文件不是有效 JSON");
    }
  }

  if (!isRecord(value)) {
    return failure("INVALID_FORMAT", "$", "备份顶层必须是对象");
  }
  try {
    if (utf8Length(JSON.stringify(value)) > BACKUP_MAX_BYTES) {
      return failure("LIMIT_EXCEEDED", "$", "备份文件超过 10 MiB");
    }
  } catch {
    return failure("INVALID_FORMAT", "$", "备份内容无法序列化");
  }
  if (value.format !== BACKUP_FORMAT) {
    issues.push(issue("INVALID_FORMAT", "$.format", "备份格式标识不匹配"));
  }
  if (!BACKUP_ACCEPTED_VERSIONS.includes(value.version as 2 | 3 | 4)) {
    issues.push(
      issue("UNSUPPORTED_VERSION", "$.version", "仅支持 organize-backup v2/v3/v4")
    );
  }
  // 旧 v2 备份没有 033 新表；早期 v3 备份没有 058 新表（memos/task_item_refs），统一补空数组。
  if ((value.version === 2 || value.version === 3) && value.data && typeof value.data === "object") {
    const data = value.data as Record<string, unknown>;
    const v3NewTables = ["task_lists", "task_reminders", "task_attachments", "task_activities", "task_templates", "countdown_days", "task_dependencies", "memos", "task_item_refs"];
    for (const t of v3NewTables) {
      if (data[t] === undefined) {
        data[t] = [];
      }
    }
  }
  if (!isTimestamp(value.exportedAt)) {
    issues.push(issue("INVALID_FORMAT", "$.exportedAt", "导出时间无效"));
  }
  rejectUnknownKeys(
    value,
    ["format", "version", "exportedAt", "manifest", "data"],
    "$",
    issues
  );

  if (!isRecord(value.data)) {
    issues.push(issue("INVALID_TABLE", "$.data", "缺少数据表对象"));
    return { ok: false, issues };
  }
  rejectUnknownKeys(value.data, [...BACKUP_TABLES], "$.data", issues);

  let totalRows = 0;
  const normalizedData = {} as BackupData;
  for (const table of BACKUP_TABLES) {
    const rows = value.data[table];
    if (!Array.isArray(rows)) {
      issues.push(issue("INVALID_TABLE", `$.data.${table}`, "数据表必须是数组"));
      normalizedData[table] = [];
      continue;
    }
    if (rows.length > BACKUP_MAX_ROWS_PER_TABLE) {
      issues.push(
        issue(
          "LIMIT_EXCEEDED",
          `$.data.${table}`,
          `单表不能超过 ${BACKUP_MAX_ROWS_PER_TABLE} 行`
        )
      );
    }
    totalRows += rows.length;
    normalizedData[table] = rows.filter(isRecord);
    validateRows(table, rows, issues);
  }
  if (totalRows > BACKUP_MAX_TOTAL_ROWS) {
    issues.push(
      issue(
        "LIMIT_EXCEEDED",
        "$.data",
        `总记录数不能超过 ${BACKUP_MAX_TOTAL_ROWS}`
      )
    );
  }

  validateManifest(value.manifest, normalizedData, issues, value.version as number | undefined);
  validateRelationships(normalizedData, issues);

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, backup: value as unknown as BackupV2, issues: [] };
}

export function createBackupV2(
  data: BackupData,
  exportedAt = new Date().toISOString()
): BackupV2 {
  const counts = Object.fromEntries(
    BACKUP_TABLES.map((table) => [table, data[table].length])
  ) as Record<BackupTable, number>;
  const backup: BackupV2 = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    manifest: {
      counts,
      excluded: [...REQUIRED_EXCLUSIONS],
    },
    data,
  };

  const inspection = inspectBackupV2(backup);
  if (!inspection.ok) {
    throw new Error(
      `Backup V2 validation failed: ${inspection.issues
        .map((entry) => `${entry.path}: ${entry.message}`)
        .join("; ")}`
    );
  }
  return backup;
}

function relationSchema(...fields: string[]): RowSchema {
  return {
    fields: Object.fromEntries(fields.map((field) => [field, isUuid])),
    keyFields: fields,
  };
}

function validateRows(
  table: BackupTable,
  rows: unknown[],
  issues: BackupIssue[]
) {
  const schema = rowSchemas[table];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const path = `$.data.${table}[${index}]`;
    if (!isRecord(row)) {
      issues.push(issue("INVALID_ROW", path, "记录必须是对象"));
      return;
    }

    rejectUnknownKeys(row, Object.keys(schema.fields), path, issues);
    for (const [field, validator] of Object.entries(schema.fields)) {
      if (!validator(row[field])) {
        issues.push(
          issue("INVALID_ROW", `${path}.${field}`, "字段缺失或类型不合法")
        );
      }
    }

    for (const sensitive of ["user_id", "owner_id", "token", "config"]) {
      if (sensitive in row) {
        issues.push(
          issue(
            "SENSITIVE_FIELD",
            `${path}.${sensitive}`,
            "备份不得包含账户或密钥字段"
          )
        );
      }
    }

    const key = schema.keyFields.map((field) => String(row[field])).join(":");
    if (seen.has(key)) {
      issues.push(issue("DUPLICATE_ID", path, "记录主键重复"));
    }
    seen.add(key);
  });
}

function validateManifest(
  value: unknown,
  data: BackupData,
  issues: BackupIssue[],
  version?: number
) {
  if (!isRecord(value) || !isRecord(value.counts) || !Array.isArray(value.excluded)) {
    issues.push(issue("INVALID_MANIFEST", "$.manifest", "manifest 结构无效"));
    return;
  }
  rejectUnknownKeys(value, ["counts", "excluded"], "$.manifest", issues);
  rejectUnknownKeys(value.counts, [...BACKUP_TABLES], "$.manifest.counts", issues);

  // P0-04：v2/v3 老备份的 manifest 没有新表键（当时尚不存在），缺键按 0 记；
  // v4 起严格要求数据与 counts 都齐全
  const v3CompatTables = new Set(["task_lists", "task_reminders", "task_attachments", "task_activities", "task_templates", "countdown_days", "task_dependencies", "memos", "task_item_refs"]);
  for (const table of BACKUP_TABLES) {
    const declared = value.counts[table];
    const isLegacyMissing =
      (version === 2 || version === 3) && v3CompatTables.has(table) && declared === undefined;
    if ((isLegacyMissing ? 0 : declared) !== data[table].length) {
      issues.push(
        issue(
          "INVALID_MANIFEST",
          `$.manifest.counts.${table}`,
          "记录数与数据不一致"
        )
      );
    }
  }

  const exclusions = value.excluded.filter(
    (entry): entry is string => typeof entry === "string"
  );
  if (
    exclusions.length !== value.excluded.length ||
    REQUIRED_EXCLUSIONS.some((entry) => !exclusions.includes(entry))
  ) {
    issues.push(
      issue(
        "INVALID_MANIFEST",
        "$.manifest.excluded",
        "必须明确排除 auth/plugins/shares/storage/soft_deleted"
      )
    );
  }
}

function validateRelationships(data: BackupData, issues: BackupIssue[]) {
  const ids = {
    reading: idSet(data.reading_items),
    notes: idSet(data.notes),
    tags: idSet(data.tags),
    tasks: idSet(data.tasks),
    lessons: idSet(data.lessons),
    threads: idSet(data.note_comment_threads),
    databases: idSet(data.db_databases),
  };

  checkOptionalRefs(data.notes, "reading_item_id", ids.reading, "notes", issues);
  checkOptionalRefs(data.notes, "parent_note_id", ids.notes, "notes", issues);
  checkRefs(data.item_tags, "item_id", ids.reading, "item_tags", issues);
  checkRefs(data.item_tags, "tag_id", ids.tags, "item_tags", issues);
  checkRefs(data.note_tags, "note_id", ids.notes, "note_tags", issues);
  checkRefs(data.note_tags, "tag_id", ids.tags, "note_tags", issues);
  checkOptionalRefs(data.tasks, "reading_item_id", ids.reading, "tasks", issues);
  checkOptionalRefs(data.tasks, "note_id", ids.notes, "tasks", issues);
  checkOptionalRefs(data.tasks, "parent_task_id", ids.tasks, "tasks", issues);
  validateTaskHierarchy(data.tasks, issues);
  checkRefs(data.task_dependencies, "task_id", ids.tasks, "task_dependencies", issues);
  checkRefs(
    data.task_dependencies,
    "depends_on_task_id",
    ids.tasks,
    "task_dependencies",
    issues
  );
  validateTaskDependencies(data.task_dependencies, issues);
  checkRefs(data.task_checklists, "task_id", ids.tasks, "task_checklists", issues);
  checkRefs(data.task_tags, "task_id", ids.tasks, "task_tags", issues);
  checkRefs(data.task_tags, "tag_id", ids.tags, "task_tags", issues);
  checkRefs(data.task_item_refs, "task_id", ids.tasks, "task_item_refs", issues);
  checkRefs(data.task_item_refs, "note_id", ids.notes, "task_item_refs", issues);
  checkOptionalRefs(data.lessons, "task_id", ids.tasks, "lessons", issues);
  checkOptionalRefs(data.lessons, "reading_item_id", ids.reading, "lessons", issues);
  checkOptionalRefs(data.lessons, "note_id", ids.notes, "lessons", issues);
  checkRefs(data.lesson_tags, "lesson_id", ids.lessons, "lesson_tags", issues);
  checkRefs(data.lesson_tags, "tag_id", ids.tags, "lesson_tags", issues);
  checkRefs(data.highlights, "reading_item_id", ids.reading, "highlights", issues);
  checkOptionalRefs(data.highlights, "note_id", ids.notes, "highlights", issues);
  checkOptionalRefs(data.highlights, "task_id", ids.tasks, "highlights", issues);
  checkRefs(data.note_versions, "note_id", ids.notes, "note_versions", issues);
  checkRefs(
    data.note_comment_threads,
    "note_id",
    ids.notes,
    "note_comment_threads",
    issues
  );
  checkRefs(data.note_comments, "thread_id", ids.threads, "note_comments", issues);
  checkRefs(data.note_suggestions, "note_id", ids.notes, "note_suggestions", issues);
  checkOptionalRefs(
    data.db_databases,
    "parent_note_id",
    ids.notes,
    "db_databases",
    issues
  );
  checkRefs(data.db_rows, "database_id", ids.databases, "db_rows", issues);

  data.favorites.forEach((favorite, index) => {
    const targetSet =
      favorite.target_type === "reading"
        ? ids.reading
        : favorite.target_type === "note"
          ? ids.notes
          : ids.tasks;
    checkReference(
      favorite.target_id,
      targetSet,
      `$.data.favorites[${index}].target_id`,
      issues
    );
  });

  const jsonFields: Array<[BackupRow[], string, string]> = [
    [data.notes, "content", "notes"],
    [data.lessons, "content", "lessons"],
    [data.note_versions, "content", "note_versions"],
    [data.note_suggestions, "original_block", "note_suggestions"],
    [data.note_suggestions, "proposed_block", "note_suggestions"],
    [data.synced_blocks, "content", "synced_blocks"],
    [data.db_rows, "values", "db_rows"],
  ];
  for (const [rows, field, table] of jsonFields) {
    rows.forEach((row, index) => {
      inspectInternalLinks(
        row[field],
        ids.notes,
        ids.reading,
        idSet(data.synced_blocks),
        ids.databases,
        `$.data.${table}[${index}].${field}`,
        issues
      );
    });
  }
}

function inspectInternalLinks(
  value: unknown,
  noteIds: Set<string>,
  readingIds: Set<string>,
  syncedBlockIds: Set<string>,
  databaseIds: Set<string>,
  path: string,
  issues: BackupIssue[]
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectInternalLinks(entry, noteIds, readingIds, syncedBlockIds, databaseIds, `${path}[${index}]`, issues)
    );
    return;
  }
  if (!isRecord(value)) return;

  if (typeof value.href === "string") {
    const matches = Array.from(
      value.href.matchAll(/\/(notes|library)\/([0-9a-f-]{36})(?=[/?#]|$)/gi)
    );
    for (const match of matches) {
      const targetSet = match[1] === "notes" ? noteIds : readingIds;
      checkReference(match[2], targetSet, `${path}.href`, issues);
    }
  }
  // syncedId/databaseId 是直接 UUID 引用（非 URL），非空时必须在对应表中存在
  if (typeof value.syncedId === "string" && value.syncedId.length > 0) {
    checkReference(value.syncedId, syncedBlockIds, `${path}.syncedId`, issues);
  }
  if (typeof value.databaseId === "string" && value.databaseId.length > 0) {
    checkReference(value.databaseId, databaseIds, `${path}.databaseId`, issues);
  }
  for (const [key, entry] of Object.entries(value)) {
    inspectInternalLinks(entry, noteIds, readingIds, syncedBlockIds, databaseIds, `${path}.${key}`, issues);
  }
}

function idSet(rows: BackupRow[]): Set<string> {
  return new Set(rows.map((row) => String(row.id)));
}

function checkRefs(
  rows: BackupRow[],
  field: string,
  targets: Set<string>,
  table: string,
  issues: BackupIssue[]
) {
  rows.forEach((row, index) =>
    checkReference(row[field], targets, `$.data.${table}[${index}].${field}`, issues)
  );
}

function checkOptionalRefs(
  rows: BackupRow[],
  field: string,
  targets: Set<string>,
  table: string,
  issues: BackupIssue[]
) {
  rows.forEach((row, index) => {
    if (row[field] !== null) {
      checkReference(
        row[field],
        targets,
        `$.data.${table}[${index}].${field}`,
        issues
      );
    }
  });
}

function checkReference(
  value: unknown,
  targets: Set<string>,
  path: string,
  issues: BackupIssue[]
) {
  if (typeof value === "string" && !targets.has(value)) {
    issues.push(issue("BROKEN_REFERENCE", path, "引用的记录不在备份中"));
  }
}

function validateTaskHierarchy(rows: BackupRow[], issues: BackupIssue[]) {
  const parents = new Map(
    rows.map((row) => [
      String(row.id),
      typeof row.parent_task_id === "string" ? row.parent_task_id : null,
    ])
  );

  rows.forEach((row, index) => {
    const id = String(row.id);
    let current = parents.get(id) || null;
    const visited = new Set([id]);
    while (current && parents.has(current)) {
      if (visited.has(current)) {
        issues.push(
          issue(
            "INVALID_ROW",
            `$.data.tasks[${index}].parent_task_id`,
            "任务层级不能形成循环"
          )
        );
        return;
      }
      visited.add(current);
      current = parents.get(current) || null;
    }
  });
}

function validateTaskDependencies(rows: BackupRow[], issues: BackupIssue[]) {
  const graph = new Map<string, string[]>();
  rows.forEach((row, index) => {
    const taskId = String(row.task_id);
    const prerequisiteId = String(row.depends_on_task_id);
    if (taskId === prerequisiteId) {
      issues.push(
        issue(
          "INVALID_ROW",
          `$.data.task_dependencies[${index}].depends_on_task_id`,
          "任务不能依赖自身"
        )
      );
      return;
    }
    graph.set(taskId, [...(graph.get(taskId) || []), prerequisiteId]);
  });

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const hasCycle = (taskId: string): boolean => {
    if (visiting.has(taskId)) return true;
    if (visited.has(taskId)) return false;
    visiting.add(taskId);
    for (const prerequisiteId of graph.get(taskId) || []) {
      if (hasCycle(prerequisiteId)) return true;
    }
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  };

  for (const taskId of Array.from(graph.keys())) {
    if (hasCycle(taskId)) {
      issues.push(
        issue(
          "INVALID_ROW",
          "$.data.task_dependencies",
          "任务依赖不能形成循环"
        )
      );
      return;
    }
  }
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
  issues: BackupIssue[]
) {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      issues.push(issue("INVALID_ROW", `${path}.${key}`, "包含未授权字段"));
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function issue(
  code: BackupIssue["code"],
  path: string,
  message: string
): BackupIssue {
  return { code, path, message };
}

function failure(
  code: BackupIssue["code"],
  path: string,
  message: string
): BackupInspection {
  return { ok: false, issues: [issue(code, path, message)] };
}
