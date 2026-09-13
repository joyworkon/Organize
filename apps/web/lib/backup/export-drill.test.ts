// B01 恢复演练的纯客户端层单测：导出剪枝、悬空内容引用、旧版本/损坏/超限
// 备份文件、tasks.list_id 往返。真实后端全链路往返由
// scripts/backup-restore-drill.mts 覆盖（RED→GREEN 证据见账本 B01）。
import { describe, expect, it } from "vitest";
import {
  BACKUP_TABLES,
  BACKUP_VERSION,
  createBackupV2,
  inspectBackupV2,
  type BackupData,
} from "./schema";
import { pruneExportData } from "./export-data";
import { prepareRestorePayload } from "./restore";

const timestamp = "2026-09-13T00:00:00.000Z";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function emptyData(): BackupData {
  return Object.fromEntries(BACKUP_TABLES.map((t) => [t, []])) as unknown as BackupData;
}

/** 最小合法数据：一篇笔记 + 一个标签 + 一条关联（可按需叠加） */
function baseData(): BackupData {
  const data = emptyData();
  data.notes = [
    {
      id: uuid(1),
      title: "笔记",
      content: { type: "doc", content: [] },
      reading_item_id: null,
      is_pinned: false,
      created_at: timestamp,
      updated_at: timestamp,
    },
  ];
  data.tags = [
    { id: uuid(2), name: "标签", color: "blue", created_at: timestamp },
  ];
  data.note_tags = [{ note_id: uuid(1), tag_id: uuid(2) }];
  return data;
}

describe("pruneExportData（回收站行泄漏修复）", () => {
  it("剔除父行缺席的孤儿子行（RLS 不过滤软删的表）", () => {
    const data = baseData();
    // 回收站笔记（不在导出的 notes 里）的版本行 / 评论线程 / 建议行 → 孤儿
    data.note_versions = [
      {
        id: uuid(3),
        note_id: uuid(9), // 父行缺席
        content: { type: "doc", content: [] },
        title: "孤儿版本",
        message: null,
        created_at: timestamp,
      },
      {
        id: uuid(4),
        note_id: uuid(1), // 父行在
        content: { type: "doc", content: [] },
        title: "正常版本",
        message: null,
        created_at: timestamp,
      },
    ];
    data.note_comment_threads = [
      {
        id: uuid(5),
        note_id: uuid(9), // 孤儿
        block_id: "b",
        resolved_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ];
    data.task_item_refs = [
      {
        id: uuid(6),
        task_id: uuid(8), // 任务侧缺席
        note_id: uuid(1),
        block_id: "blk-1",
        created_at: timestamp,
      },
    ];

    // 未剪枝：校验失败（B01 RED 场景的最小复现）
    expect(() => createBackupV2(data)).toThrow(/BROKEN_REFERENCE|引用的记录不在备份中|validation failed/);

    const pruned = pruneExportData(data);
    expect(pruned.note_versions.map((r) => r.id)).toEqual([uuid(4)]);
    expect(pruned.note_comment_threads).toEqual([]);
    expect(pruned.task_item_refs).toEqual([]);
    expect(() => createBackupV2(pruned)).not.toThrow();
  });

  it("悬空可选引用置 null：任务引用回收站笔记/列表、高亮引用回收站笔记", () => {
    const data = baseData();
    data.tasks = [
      {
        id: uuid(8),
        title: "任务",
        description: null,
        status: "todo",
        priority: "high",
        category: "work",
        due_date: null,
        estimated_minutes: null,
        actual_minutes: null,
        reading_item_id: uuid(7), // 回收站文章（缺席）
        note_id: uuid(9), // 回收站笔记（缺席）
        parent_task_id: null,
        list_id: uuid(6), // 回收站列表（缺席）
        is_pinned: false,
        sort_order: 0,
        completed_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ];
    data.highlights = [
      {
        id: uuid(10),
        reading_item_id: uuid(1), // 阅读行缺席 → 高亮行整体剔除（必填引用）
        content: "h",
        note: null,
        color: "yellow",
        anchor_path: null,
        anchor_offset: null,
        note_id: null,
        task_id: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ];

    const pruned = pruneExportData(data);
    expect(pruned.tasks[0].note_id).toBeNull();
    expect(pruned.tasks[0].reading_item_id).toBeNull();
    expect(pruned.tasks[0].list_id).toBeNull();
    expect(pruned.highlights).toEqual([]);
    expect(() => createBackupV2(pruned)).not.toThrow();
  });

  it("父任务缺席的活跃子任务升级为根任务（丢引用不丢行）", () => {
    const data = baseData();
    data.tasks = [
      {
        id: uuid(8),
        title: "活跃子任务",
        description: null,
        status: "todo",
        priority: "high",
        category: "work",
        due_date: null,
        estimated_minutes: null,
        actual_minutes: null,
        reading_item_id: null,
        note_id: null,
        parent_task_id: uuid(9), // 回收站父任务（缺席）
        list_id: null,
        is_pinned: false,
        sort_order: 0,
        completed_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ];
    const pruned = pruneExportData(data);
    expect(pruned.tasks[0].parent_task_id).toBeNull();
    expect(() => createBackupV2(pruned)).not.toThrow();
  });
});

describe("内容级悬空引用（合法产品态，不阻断校验与恢复）", () => {
  it("指向缺席笔记的 href / syncedId / databaseId 通过校验，恢复时原样保留", () => {
    const data = baseData();
    data.notes[0].content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "悬空",
              marks: [{ type: "link", attrs: { href: `/notes/${uuid(99)}` } }],
            },
          ],
        },
        { type: "syncedBlock", attrs: { syncedId: uuid(98) } },
        { type: "databaseBlock", attrs: { databaseId: uuid(97) } },
      ],
    };

    const backup = createBackupV2(data);
    expect(inspectBackupV2(backup).ok).toBe(true);

    const payload = prepareRestorePayload(backup);
    const content = payload.data.notes[0].content as {
      content: Array<{ attrs?: Record<string, unknown> }>;
    };
    // 悬空引用原样保留（恢复后由 043 链接失效装饰/占位块呈现）
    expect(JSON.stringify(content)).toContain(`/notes/${uuid(99)}`);
    expect(content.content[1].attrs?.syncedId).toBe(uuid(98));
    expect(content.content[2].attrs?.databaseId).toBe(uuid(97));
  });

  it("指向在份目标的引用仍被重映射", () => {
    const data = baseData();
    data.notes[0].content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "在份",
              marks: [{ type: "link", attrs: { href: `/notes/${uuid(1)}` } }],
            },
          ],
        },
      ],
    };
    const backup = createBackupV2(data);
    const payload = prepareRestorePayload(backup);
    const content = payload.data.notes[0].content as {
      content: Array<{ content?: Array<{ marks?: Array<{ attrs?: { href?: string } }> }> }>;
    };
    expect(content.content[0].content?.[0].marks?.[0].attrs?.href).toBe(
      `/notes/${payload.data.notes[0].id}`
    );
  });
});

describe("tasks.list_id 备份往返（B01 缺陷：此前导出不带列、恢复链不落库）", () => {
  it("导出行带 list_id 通过校验并在恢复载荷中重映射", () => {
    const data = baseData();
    data.task_lists = [
      {
        id: uuid(5),
        name: "工作",
        icon: null,
        color: null,
        sort_order: 0,
        is_default: true,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ];
    data.tasks = [
      {
        id: uuid(8),
        title: "列表任务",
        description: null,
        status: "todo",
        priority: "high",
        category: "work",
        due_date: null,
        estimated_minutes: null,
        actual_minutes: null,
        reading_item_id: null,
        note_id: null,
        parent_task_id: null,
        list_id: uuid(5),
        is_pinned: false,
        sort_order: 0,
        completed_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ];
    const backup = createBackupV2(data);
    const payload = prepareRestorePayload(backup);
    expect(payload.data.tasks[0].list_id).toBe(payload.data.task_lists[0].id);
  });
});

describe("旧版本备份文件兼容（v2/v4 真实文件形状）", () => {
  it("v2 备份（缺 033/058/075 全部新表 + manifest 无新表键）可导入并补空", () => {
    const backup = createBackupV2(baseData(), timestamp) as unknown as Record<string, unknown>;
    backup.version = 2;
    const data = backup.data as Record<string, unknown>;
    const counts = (backup.manifest as { counts: Record<string, number> }).counts;
    const newTables = BACKUP_TABLES.filter((t) =>
      [
        "task_lists", "task_reminders", "task_attachments", "task_activities",
        "task_templates", "countdown_days", "task_dependencies", "memos",
        "task_item_refs", "memo_notes",
      ].includes(t)
    );
    for (const t of newTables) {
      delete data[t];
      delete counts[t];
    }
    const result = inspectBackupV2(backup);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const t of newTables) {
        expect(result.backup.data[t]).toEqual([]);
      }
    }
  });

  it("v4 备份（075 之前：缺 memo_notes 键）可导入并补空；缺更早的新表仍报错", () => {
    const backup = createBackupV2(baseData(), timestamp) as unknown as Record<string, unknown>;
    backup.version = 4;
    const data = backup.data as Record<string, unknown>;
    const counts = (backup.manifest as { counts: Record<string, number> }).counts;
    delete data.memo_notes;
    delete counts.memo_notes;
    const result = inspectBackupV2(backup);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.backup.data.memo_notes).toEqual([]);
    }

    // v4 缺 memos（058 表）不允许——v4 文件当时已有该表
    const broken = createBackupV2(baseData(), timestamp) as unknown as Record<string, unknown>;
    broken.version = 4;
    delete (broken.data as Record<string, unknown>).memos;
    expect(inspectBackupV2(broken).ok).toBe(false);
  });

  it("v2/v4 旧文件恢复载荷正确重映射（新表按空处理）", () => {
    const backup = createBackupV2(baseData(), timestamp) as unknown as Record<string, unknown>;
    backup.version = 2;
    const data = backup.data as Record<string, unknown>;
    const counts = (backup.manifest as { counts: Record<string, number> }).counts;
    for (const t of ["task_lists", "memos", "task_item_refs", "memo_notes"]) {
      delete data[t];
      delete counts[t];
    }
    const result = inspectBackupV2(backup);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    let sequence = 1;
    const payload = prepareRestorePayload(result.backup, () => {
      const suffix = String(sequence++).padStart(12, "0");
      return `b1000000-0000-4000-8000-${suffix}`;
    });
    expect(String(payload.data.notes[0].id)).not.toBe(uuid(1));
    expect(payload.data.memos).toEqual([]);
    expect(payload.data.memo_notes).toEqual([]);
  });
});

describe("损坏与超限备份文件（B01 卡面覆盖项）", () => {
  it("截断的 JSON 报 INVALID_JSON", () => {
    const backup = JSON.stringify(createBackupV2(baseData(), timestamp));
    const result = inspectBackupV2(backup.slice(0, Math.floor(backup.length / 2)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].code).toBe("INVALID_JSON");
  });

  it("完全非法的 JSON 报 INVALID_JSON", () => {
    const result = inspectBackupV2("{{{not-json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].code).toBe("INVALID_JSON");
  });

  it("超过 10MiB 的字符串报 LIMIT_EXCEEDED", () => {
    const big = JSON.stringify({ pad: "x".repeat(10 * 1024 * 1024 + 1024) });
    const result = inspectBackupV2(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].code).toBe("LIMIT_EXCEEDED");
  });

  it("序列化后超限的对象报 LIMIT_EXCEEDED（route 路径：对象入参）", () => {
    const big = { format: "organize-backup", version: BACKUP_VERSION, pad: "y".repeat(10 * 1024 * 1024 + 1024) };
    const result = inspectBackupV2(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].code).toBe("LIMIT_EXCEEDED");
  });

  it("恰好在限额内的备份不受影响", () => {
    const backup = createBackupV2(baseData(), timestamp);
    expect(inspectBackupV2(JSON.stringify(backup)).ok).toBe(true);
  });
});
