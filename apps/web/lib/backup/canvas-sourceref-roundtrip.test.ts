// 画布资料引用（sourceRef）恢复重映射：canvas_documents.content 里的
// sourceRef.id 按 kind 指向 reading_items / memos（lib/canvas/model.ts 阶段 E），
// 恢复换新 ID 后必须跟走，否则「打开来源 / 更新快照 / 来源状态」全失联
// （use-source-status 按 kind+id 分表探测，查不到即不可达）。
// 悬空引用（来源不在本次备份）按项目悬空引用惯例原样保留。
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchBackupData, pruneExportData } from "./export-data";
import {
  createBackupV2,
  inspectBackupV2,
  type BackupRow,
  type BackupTable,
} from "./schema";
import { prepareRestorePayload } from "./restore";

const NOW = "2026-11-05T00:00:00.000Z";

const uuid = (n: number) =>
  `cc330000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const READING_ID = uuid(1);
const MEMO_ID = uuid(2);
// 悬空来源：不在备份内的 id（源已删/未导出），恢复后保留旧值
const DANGLING_ID = uuid(99);

function readingRow(): BackupRow {
  return {
    id: READING_ID,
    url: "https://example.com/article",
    title: "一篇文章",
    content: null,
    excerpt: null,
    cover_image: null,
    reading_status: "unread",
    reading_progress: 0,
    is_pinned: false,
    started_reading_at: null,
    completed_reading_at: null,
    created_at: NOW,
    updated_at: NOW,
  };
}

function memoRow(): BackupRow {
  return {
    id: MEMO_ID,
    content: "速记首行\n正文",
    tags: [],
    deleted_at: null,
    created_at: NOW,
    updated_at: NOW,
  };
}

function canvasContent(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    boards: [
      {
        id: "board-1",
        x: 0,
        y: 0,
        width: 640,
        padding: 24,
        gap: 16,
        regions: [
          {
            id: "region-1",
            name: "内容",
            sections: [
              {
                id: "section-1",
                widthMode: "equal",
                columnWeights: [1],
                columns: [
                  {
                    id: "col-1",
                    blocks: [
                      {
                        id: "card-1",
                        type: "materialCard",
                        title: "文章卡片",
                        text: "摘录正文",
                        sourceRef: {
                          kind: "reading",
                          id: READING_ID,
                          title: "一篇文章",
                          excerpt: "摘要",
                          url: "https://example.com/article",
                          updatedAt: NOW,
                        },
                      },
                      {
                        id: "text-1",
                        type: "text",
                        role: "body",
                        text: "速记摘录",
                        sourceRef: { kind: "memo", id: MEMO_ID, title: "速记首行" },
                      },
                      {
                        id: "card-dangling",
                        type: "materialCard",
                        title: "悬空卡片",
                        text: "来源已删",
                        sourceRef: { kind: "reading", id: DANGLING_ID, title: "旧来源" },
                      },
                      { id: "plain-1", type: "text", role: "title", text: "无来源块" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    freeItems: [
      {
        id: "free-1",
        x: 10,
        y: 10,
        width: 300,
        zIndex: 1,
        block: {
          id: "free-img",
          type: "image",
          asset: null,
          fit: "contain",
          sourceRef: { kind: "reading", id: READING_ID, title: "一篇文章" },
        },
      },
    ],
    connectors: [],
  };
}

function canvasRow(overrides: Record<string, unknown> = {}): BackupRow {
  return {
    id: uuid(10),
    title: "调研画布",
    content: canvasContent(),
    deleted_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

/** 只实现 fetchBackupData 用到的链式查询面 */
function stubSupabase(
  tables: Partial<Record<BackupTable, BackupRow[]>>,
): SupabaseClient {
  const client = {
    from(table: BackupTable) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        order: () => builder,
        range: async () => ({ data: tables[table] ?? [], error: null }),
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

function toFileShape(backup: unknown): unknown {
  return JSON.parse(JSON.stringify(backup));
}

describe("画布 sourceRef 恢复重映射", () => {
  it("content 内 sourceRef.id 按 kind 随 reading_items/memos 换新 ID，悬空原样保留", async () => {
    const client = stubSupabase({
      reading_items: [readingRow()],
      memos: [memoRow()],
      canvas_documents: [canvasRow()],
    });

    const backupData = pruneExportData(await fetchBackupData(client, "user-a"));
    const backup = createBackupV2(backupData);
    const inspection = inspectBackupV2(toFileShape(backup));
    expect(inspection.ok).toBe(true);
    if (!inspection.ok) throw new Error(JSON.stringify(inspection.issues, null, 2));

    let seq = 0;
    const payload = prepareRestorePayload(inspection.backup, () =>
      `dd440000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    );

    const [reading] = payload.data.reading_items;
    const [memo] = payload.data.memos;
    const [canvas] = payload.data.canvas_documents;
    expect(canvas.title).toBe("调研画布");

    const content = canvas.content as {
      boards: {
        regions: {
          sections: { columns: { blocks: Record<string, unknown>[] }[] }[];
        }[];
      }[];
      freeItems: { block: Record<string, unknown> }[];
    };
    const blocks = content.boards[0].regions[0].sections[0].columns[0].blocks;
    const [card, text, dangling, plain] = blocks;

    // 页面块与自由容器内的来源引用都随恢复重映射到新行
    expect((card.sourceRef as Record<string, unknown>).id).toBe(reading.id);
    expect((text.sourceRef as Record<string, unknown>).id).toBe(memo.id);
    expect(
      (content.freeItems[0].block.sourceRef as Record<string, unknown>).id
    ).toBe(reading.id);

    // 快照字段原样保留（恢复不伪造来源内容）
    expect(card.sourceRef).toMatchObject({
      kind: "reading",
      title: "一篇文章",
      excerpt: "摘要",
      url: "https://example.com/article",
      updatedAt: NOW,
    });

    // 悬空引用（来源不在备份）原样保留：来源探测按不可达展示，快照不依赖来源存活
    expect((dangling.sourceRef as Record<string, unknown>).id).toBe(DANGLING_ID);

    // 无来源的块逐字段不变
    expect(plain).toEqual({
      id: "plain-1",
      type: "text",
      role: "title",
      text: "无来源块",
    });
  });
});
