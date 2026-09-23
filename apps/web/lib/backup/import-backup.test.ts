import { describe, expect, it } from "vitest";
import {
  BACKUP_TABLES,
  BACKUP_VERSION,
  createBackupV2,
  inspectBackupV2,
  type BackupData,
} from "./schema";
import { pruneExportData } from "./export-data";
import { scanAttachmentReferences } from "./attachment-package";
import { prepareRestorePayload } from "./restore";

// 091（备份 v7）：导入任务/文件进备份——扫描、剪枝、恢复重映射与状态归一。
// 原件本体走附件包 import-files 私有桶目录（行内坐标，不是内容 URL）。

const NOW = "2026-09-23T08:00:00.000Z";
const READING_ID = "10000000-0000-4000-8000-000000000001";
const TASK_ID = "d1000000-0000-4000-8000-000000000001";
const FILE_ID = "d2000000-0000-4000-8000-000000000001";
const OLD_ORIGINAL = `origin-user/t-1/${FILE_ID}.pdf`;
const OLD_IMAGE = `origin-user/t-1/${FILE_ID}-img1.png`;

function baseData(): BackupData {
  const empty = Object.fromEntries(BACKUP_TABLES.map((table) => [table, []]));
  return {
    ...empty,
    reading_items: [
      {
        id: READING_ID,
        url: "urn:organize:import:x",
        title: "导入条目",
        content: "<p>正文</p>",
        excerpt: null,
        cover_image: null,
        reading_status: "unread",
        reading_progress: 0,
        is_pinned: false,
        started_reading_at: null,
        completed_reading_at: null,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    import_tasks: [
      { id: TASK_ID, status: "saved", created_at: NOW, updated_at: NOW },
    ],
    import_files: [
      {
        id: FILE_ID,
        task_id: TASK_ID,
        file_name: "报告.pdf",
        mime: "application/pdf",
        size: 2048,
        kind: "pdf",
        storage_path: OLD_ORIGINAL,
        status: "saved",
        error: null,
        reading_item_id: READING_ID,
        page_count: 8,
        asset_paths: [OLD_IMAGE],
        retry_key: "t-retry-1",
        created_at: NOW,
        updated_at: NOW,
      },
    ],
  } as unknown as BackupData;
}

describe("备份 v7：导入两表", () => {
  it("v7 fixture 校验通过且版本号为 7", () => {
    const backup = createBackupV2(baseData(), NOW);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(inspectBackupV2(JSON.stringify(backup)).ok).toBe(true);
  });

  it("processing 状态的任务/文件行过不了校验（未完成不进备份，防伪造成功）", () => {
    const data = baseData();
    (data.import_tasks[0] as Record<string, unknown>).status = "processing";
    (data.import_files[0] as Record<string, unknown>).status = "parsing";
    const raw = {
      format: "organize-backup",
      version: BACKUP_VERSION,
      exportedAt: NOW,
      manifest: {
        counts: Object.fromEntries(
          BACKUP_TABLES.map((table) => [table, (data[table] as unknown[]).length]),
        ),
        excluded: ["auth", "plugins", "shares", "soft_deleted", "storage"],
      },
      data,
    };
    const result = inspectBackupV2(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map((i) => i.path).join("\n");
      expect(paths).toContain("import_tasks");
      expect(paths).toContain("import_files");
    }
  });

  it("import_files 的任务引用悬空 → BROKEN_REFERENCE（恢复才不因外键回滚）", () => {
    const data = baseData();
    (data.import_files[0] as Record<string, unknown>).task_id =
      "d1000000-0000-4000-8000-0000000000ff";
    const result = inspectBackupV2(createBackupV2(baseData(), NOW));
    expect(result.ok).toBe(true); // 基线（未篡改）应通过
    const raw = {
      format: "organize-backup",
      version: BACKUP_VERSION,
      exportedAt: NOW,
      manifest: {
        counts: Object.fromEntries(
          BACKUP_TABLES.map((table) => [table, (data[table] as unknown[]).length]),
        ),
        excluded: ["auth", "plugins", "shares", "soft_deleted", "storage"],
      },
      data,
    };
    const tampered = inspectBackupV2(JSON.stringify(raw));
    expect(tampered.ok).toBe(false);
  });

  it("导出剪枝：孤儿文件行剔除、条目引用悬空置 null、processing 归一 failed", () => {
    const data = baseData();
    (data.import_tasks[0] as Record<string, unknown>).status = "processing";
    (data.import_files[0] as Record<string, unknown>).reading_item_id =
      "ffffffff-ffff-4fff-8fff-ffffffffffff";
    // 文件行在备份时刻仍在途 → 归一 failed
    (data.import_files[0] as Record<string, unknown>).status = "parsing";
    // 第二条文件行挂在导出集之外的任务上 → 孤儿剔除
    data.import_files.push({
      id: "d2000000-0000-4000-8000-000000000002",
      task_id: "d1000000-0000-4000-8000-0000000000fe",
      file_name: "孤儿.pdf",
      mime: "application/pdf",
      size: 1,
      kind: "pdf",
      storage_path: null,
      status: "saved",
      error: null,
      reading_item_id: null,
      page_count: null,
      asset_paths: [],
      retry_key: "t-retry-2",
      created_at: NOW,
      updated_at: NOW,
    } as never);
    const pruned = pruneExportData(data);
    expect(pruned.import_tasks[0].status).toBe("failed");
    expect(pruned.import_files).toHaveLength(1);
    expect(pruned.import_files[0].reading_item_id).toBeNull();
    expect(pruned.import_files[0].status).toBe("failed");
  });

  it("附件包扫描：import-files 坐标（storage_path + asset_paths）进 files，不进 url_map", () => {
    const scanned = scanAttachmentReferences(baseData());
    const keys = scanned.files.map((f) => `files/${f.bucket}/${f.path}`);
    expect(keys).toContain(`files/import-files/${OLD_ORIGINAL}`);
    expect(keys).toContain(`files/import-files/${OLD_IMAGE}`);
    expect(scanned.files.filter((f) => f.bucket === "import-files")).toHaveLength(2);
    // 私有桶坐标不产生内容 URL 映射
    expect(scanned.urlMap).toHaveLength(0);
  });

  it("恢复重映射：ID/条目引用/私有桶坐标全部跟走；非终态归一 failed 并收口任务状态", () => {
    const data = baseData();
    // 注入一个非终态行 + 一个 failed 行，验证归一与任务收口（partial）
    data.import_files.push(
      {
        id: "d2000000-0000-4000-8000-000000000003",
        task_id: TASK_ID,
        file_name: "中断.docx",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: 10,
        kind: "docx",
        storage_path: `origin-user/t-1/d2000000-0000-4000-8000-000000000003.docx`,
        status: "parsing",
        error: null,
        reading_item_id: null,
        page_count: null,
        asset_paths: [],
        retry_key: "t-retry-3",
        created_at: NOW,
        updated_at: NOW,
      } as never,
      {
        id: "d2000000-0000-4000-8000-000000000004",
        task_id: TASK_ID,
        file_name: "失败.txt",
        mime: "text/plain",
        size: 10,
        kind: "text",
        storage_path: null,
        status: "failed",
        error: "解析失败",
        reading_item_id: null,
        page_count: null,
        asset_paths: [],
        retry_key: "t-retry-4",
        created_at: NOW,
        updated_at: NOW,
      } as never,
    );
    const backup = createBackupV2(
      // schema 只允许终态——先手动归一（等价导出侧剪枝），恢复侧重映射才是被测对象
      { ...data, import_files: data.import_files.map((row) =>
        row.status === "parsing" ? { ...row, status: "failed" } : row,
      ) } as BackupData,
      NOW,
    );
    // 注：为验证归一，payload 里手动放回一个非终态行（绕过 schema，直接调 prepare）
    (backup.data.import_files[1] as Record<string, unknown>).status = "parsing";

    // 私有桶重放映射（浏览器上传后的产物形态）
    const newOriginal = `new-user/aaaa.pdf`;
    const newImage = `new-user/bbbb.png`;
    let seq = 0;
    const uuid = () => {
      seq += 1;
      return `20999999-9999-4999-8999-${String(seq).padStart(12, "0")}`;
    };
    const payload = prepareRestorePayload(backup, uuid, {
      attachments: {
        manifest: {
          package_version: 1,
          created_at: NOW,
          backup_version: 7,
          files: [],
          url_map: [],
          external_urls: [],
          external_urls_truncated: false,
          inline_base64_count: 0,
          total_bytes: 0,
        },
        urlMap: [],
        pathMap: new Map([
          ["import-files/" + OLD_ORIGINAL, { bucket: "import-files" as const, path: newOriginal, newUrl: "" }],
          ["import-files/" + OLD_IMAGE, { bucket: "import-files" as const, path: newImage, newUrl: "" }],
        ]),
        missing: [],
        migrated: { files: 2, bytes: 10 },
      },
    });

    const tasks = payload.data.import_tasks;
    const files = payload.data.import_files;
    expect(tasks).toHaveLength(1);
    // 1 saved + 1 failed（parsing 归一）→ partial
    expect(tasks[0].status).toBe("partial");
    // ID 全部重映射为新 uuid
    expect(String(tasks[0].id)).toMatch(/^20999999-/);
    const parsed = files.find((f) => f.retry_key === "t-retry-3");
    expect(parsed?.status).toBe("failed");
    expect(parsed?.error).toBe("备份时导入未完成，可重试");
    const saved = files.find((f) => f.retry_key === "t-retry-1");
    // 私有桶坐标跟走到新账号路径
    expect(saved?.storage_path).toBe(newOriginal);
    expect(saved?.asset_paths).toEqual([newImage]);
    expect(saved?.reading_item_id).not.toBe(READING_ID);
    expect(String(saved?.reading_item_id)).toMatch(/^20999999-/);
    expect(saved?.task_id).toBe(tasks[0].id);
  });

  it("v6 老备份（缺 import 两表键）补空后校验通过", () => {
    const backup = createBackupV2(baseData(), NOW);
    const raw = JSON.parse(JSON.stringify(backup)) as Record<string, unknown>;
    const data = raw.data as Record<string, unknown>;
    delete data.import_tasks;
    delete data.import_files;
    (raw.manifest as { counts: Record<string, number> }).counts.import_tasks = 0;
    (raw.manifest as { counts: Record<string, number> }).counts.import_files = 0;
    raw.version = 6;
    const result = inspectBackupV2(JSON.stringify(raw));
    if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
    expect(result.ok).toBe(true);
  });
});
