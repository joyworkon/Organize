// 任务日程字段备份往返（033 列此前从未进备份：导出不选列、schema 白名单拒绝、
// 恢复链不落库）。本文件覆盖客户端三段：导出列选择 → schema 校验 → 恢复载荷
// 重映射；DB 落库段（restore_backup_v2 的 tasks INSERT 列）需迁移补写，见交接账本。
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBackupData, pruneExportData } from "./export-data";
import {
  BACKUP_TABLES,
  createBackupV2,
  inspectBackupV2,
  type BackupData,
  type BackupRow,
  type BackupTable,
} from "./schema";
import { prepareRestorePayload } from "./restore";

const NOW = "2026-11-05T00:00:00.000Z";
const START = "2026-11-06T01:00:00.000Z";
const END = "2026-11-06T02:30:00.000Z";

const uuid = (n: number) =>
  `aa110000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function taskRow(overrides: Record<string, unknown> = {}): BackupRow {
  return {
    id: uuid(1),
    title: "周度评审",
    description: null,
    status: "todo",
    priority: "high",
    category: "work",
    due_date: END,
    estimated_minutes: null,
    actual_minutes: null,
    reading_item_id: null,
    note_id: null,
    parent_task_id: null,
    list_id: null,
    schedule_start_at: START,
    schedule_end_at: END,
    all_day: false,
    timezone: "Asia/Shanghai",
    recurrence_rule: { frequency: "weekly", interval: 1 },
    series_id: null,
    source_id: null,
    is_pinned: false,
    sort_order: 0,
    completed_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

/** 只实现 fetchBackupData 用到的链式查询面；select 列串原样记录供断言 */
function stubSupabase(
  tables: Partial<Record<BackupTable, BackupRow[]>>,
): { client: SupabaseClient; capturedColumns: Partial<Record<BackupTable, string>> } {
  const capturedColumns: Partial<Record<BackupTable, string>> = {};
  const client = {
    from(table: BackupTable) {
      const builder = {
        select(cols?: string) {
          capturedColumns[table] = cols;
          return builder;
        },
        eq: () => builder,
        is: () => builder,
        order: () => builder,
        range: async () => ({ data: tables[table] ?? [], error: null }),
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, capturedColumns };
}

function toFileShape(backup: unknown): unknown {
  return JSON.parse(JSON.stringify(backup));
}

describe("任务日程字段备份往返", () => {
  it("导出 select 明确带日程七列", async () => {
    const { client, capturedColumns } = stubSupabase({
      tasks: [taskRow()],
    });
    await fetchBackupData(client, "user-a");
    const columns = String(capturedColumns.tasks).split(/,\s*/);
    for (const col of [
      "schedule_start_at",
      "schedule_end_at",
      "all_day",
      "timezone",
      "recurrence_rule",
      "series_id",
      "source_id",
    ]) {
      expect(columns).toContain(col);
    }
  });

  it("日程/全天/时区/重复规则导出→校验→恢复字段一致，系列引用跟 ID 重映射", async () => {
    const { client } = stubSupabase({
      tasks: [
        taskRow({ all_day: true, recurrence_rule: { frequency: "daily", interval: 1 } }),
        taskRow({
          id: uuid(2),
          title: "下一场",
          all_day: false,
          sort_order: 1,
          series_id: uuid(1),
          source_id: uuid(1),
        }),
      ],
    });

    const backupData = pruneExportData(await fetchBackupData(client, "user-a"));
    const backup = createBackupV2(backupData);
    const inspection = inspectBackupV2(toFileShape(backup));
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) throw new Error(JSON.stringify(inspection.issues, null, 2));

    let seq = 0;
    const payload = prepareRestorePayload(inspection.backup, () =>
      `bb220000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    );
    const [first, second] = payload.data.tasks;
    expect(first.schedule_start_at).toBe(START);
    expect(first.schedule_end_at).toBe(END);
    expect(first.all_day).toBe(true);
    expect(first.timezone).toBe("Asia/Shanghai");
    expect(second.recurrence_rule).toEqual({ frequency: "weekly", interval: 1 });
    expect(second.all_day).toBe(false);
    expect(second.schedule_start_at).toBe(START);
    // 同表引用（系列头/来源）随 ID 重映射到新行
    expect(second.series_id).toBe(first.id);
    expect(second.source_id).toBe(first.id);
  });

  it("旧备份任务行无日程字段仍可导入（缺失归一为 null）", () => {
    const data = Object.fromEntries(
      BACKUP_TABLES.map((table) => [table, []]),
    ) as unknown as BackupData;
    data.tasks = [taskRow()];
    const raw = toFileShape(createBackupV2(data)) as {
      data: { tasks: Record<string, unknown>[] };
    };
    for (const col of [
      "schedule_start_at",
      "schedule_end_at",
      "all_day",
      "timezone",
      "recurrence_rule",
      "series_id",
      "source_id",
    ]) {
      delete raw.data.tasks[0][col];
    }
    const inspection = inspectBackupV2(raw);
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) throw new Error(JSON.stringify(inspection.issues, null, 2));

    const payload = prepareRestorePayload(inspection.backup);
    for (const col of [
      "schedule_start_at",
      "schedule_end_at",
      "all_day",
      "timezone",
      "recurrence_rule",
      "series_id",
      "source_id",
    ]) {
      expect((payload.data.tasks[0] as Record<string, unknown>)[col]).toBeNull();
    }
  });

  it("系列/来源指向不在备份内的任务 → 剪枝置空，不阻断校验", async () => {
    const { client } = stubSupabase({
      tasks: [taskRow({ series_id: uuid(99), source_id: uuid(99) })],
    });

    const backupData = pruneExportData(await fetchBackupData(client, "user-a"));
    expect(backupData.tasks[0].series_id).toBeNull();
    expect(backupData.tasks[0].source_id).toBeNull();
    expect(() => createBackupV2(backupData)).not.toThrow();
  });

  it("recurrence_rule 结构不合 DB 约束（frequency 非四选一）→ 校验拒绝", () => {
    const data = Object.fromEntries(
      BACKUP_TABLES.map((table) => [table, []]),
    ) as unknown as BackupData;
    data.tasks = [
      taskRow({ recurrence_rule: { frequency: "hourly", interval: 1 } }),
    ];
    expect(() => createBackupV2(data)).toThrow(/INVALID_ROW|字段缺失或类型不合法/);
  });
});
