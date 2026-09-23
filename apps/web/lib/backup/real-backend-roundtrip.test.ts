// @vitest-environment node
// 真实后端备份往返（阶段 2 收口）：真实 PDF / DOCX（含嵌入图）/ 画布图片的
// 导出 → 附件包 → 恢复 → 重映射全链，含双账号隔离与缺失资产明确报告。
//
// 运行（需本地 Docker Supabase 栈，见 AGENTS.md）：
//   supabase start && supabase migration up
//   REAL_DB_E2E=1 npx vitest run lib/backup/real-backend-roundtrip.test.ts
// 未设 REAL_DB_E2E=1 时整体跳过（CI 走 mock 门禁；本用例是真实链路验收）。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchBackupData, pruneExportData } from "./export-data";
import { scanAttachmentReferences, buildAttachmentPackage } from "./attachment-package";
import { restoreAttachmentPackage } from "./attachment-restore";
import { prepareRestorePayload } from "./restore";

const REAL_DB = process.env.REAL_DB_E2E === "1";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, "..", "imports", "fixtures", name)));

/** 1×1 红色 PNG（画布图片资产） */
const PNG_BYTES = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

async function signUp(suffix: string): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(URL, ANON_KEY);
  const email = `rt-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@roundtrip.test`;
  const { data, error } = await client.auth.signUp({ email, password: "roundtrip-pass-1" });
  expect(error).toBeNull();
  expect(data.session).toBeTruthy();
  return { client, userId: data.user!.id };
}

describe.skipIf(!REAL_DB)("真实后端备份往返（v7）", () => {
  it(
    "A 导出（真实 PDF/DOCX 嵌入图/画布图片）→ B 恢复：行、坐标、隔离全部成立",
    { timeout: 120_000 },
    async () => {
      const a = await signUp("a");
      const b = await signUp("b");

      // ---------- A 侧造数：真实文件 + 画布图片 ----------
      const pdfBytes = fixture("sample.pdf");
      const docxBytes = fixture("sample.docx");

      const taskId = crypto.randomUUID();
      const pdfFileId = crypto.randomUUID();
      const docxFileId = crypto.randomUUID();
      const readingId = crypto.randomUUID();
      const canvasId = crypto.randomUUID();
      const imagePath = `${a.userId}/canvas/${canvasId}.png`;

      // 原件入私有桶（同 /api/imports 的 {uid}/{taskId}/{fileId}.ext 路径约定）
      const pdfPath = `${a.userId}/${taskId}/${pdfFileId}.pdf`;
      const docxPath = `${a.userId}/${taskId}/${docxFileId}.docx`;
      for (const [path, bytes, mime] of [
        [pdfPath, pdfBytes, "application/pdf"],
        [docxPath, docxBytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ] as const) {
        const { error } = await a.client.storage
          .from("import-files")
          .upload(path, bytes, { contentType: mime });
        expect(error).toBeNull();
      }

      // 画布图片进公开桶（画布 content 引用其公开 URL）
      const { error: imgError } = await a.client.storage
        .from("images")
        .upload(imagePath, PNG_BYTES, { contentType: "image/png" });
      expect(imgError).toBeNull();
      const imageUrl = a.client.storage.from("images").getPublicUrl(imagePath).data.publicUrl;

      // 导入记录（saved，原件坐标与嵌入图 asset_paths）+ 关联阅读条目 + 画布文档
      const { error: taskError } = await a.client.from("import_tasks")
        .insert({ id: taskId, status: "saved" });
      expect(taskError).toBeNull();
      const { error: readingError } = await a.client.from("reading_items").insert({
        id: readingId, user_id: a.userId, url: `urn:organize:import:${pdfFileId}`, title: "往返条目",
        content: "<p>正文</p>", excerpt: "正文", reading_status: "unread", reading_progress: 0,
      });
      expect(readingError).toBeNull();
      const { error: filesError } = await a.client.from("import_files").insert([
        {
          id: pdfFileId, task_id: taskId, file_name: "报告.pdf", mime: "application/pdf",
          size: pdfBytes.length, kind: "pdf", storage_path: pdfPath, asset_paths: [],
          status: "saved", error: null, reading_item_id: readingId, page_count: 1,
          retry_key: `rt-${pdfFileId}`,
        },
        {
          id: docxFileId, task_id: taskId, file_name: "方案.docx",
          mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: docxBytes.length, kind: "docx", storage_path: docxPath,
          asset_paths: [`${a.userId}/${taskId}/${docxFileId}-img1.png`],
          status: "saved", error: null, reading_item_id: null, page_count: null,
          retry_key: `rt-${docxFileId}`,
        },
      ]);
      if (filesError) throw new Error(`import_files insert 失败: ${filesError.message}`);
      // DOCX 嵌入图本体（与 asset_paths 对应）
      const { error: img2Error } = await a.client.storage
        .from("import-files")
        .upload(`${a.userId}/${taskId}/${docxFileId}-img1.png`, PNG_BYTES, { contentType: "image/png" });
      expect(img2Error).toBeNull();

      const { error: canvasError } = await a.client.from("canvas_documents").insert({
        id: canvasId, user_id: a.userId, title: "往返画布",
        content: {
          schemaVersion: 2,
          boards: [{ id: "b1", name: "页", regions: [{ id: "r1", name: "区块", style: {}, sections: [] }], sections: [], freeItems: [], width: 640, background: "", radius: 0 }],
          freeItems: [{ id: "f1", type: "image", asset: { url: imageUrl }, x: 0, y: 0, width: 100 }],
        },
      });
      expect(canvasError).toBeNull();

      // ---------- A 导出：JSON + 附件包 ----------
      const backupData = pruneExportData(await fetchBackupData(a.client, a.userId));
      expect(backupData.import_files).toHaveLength(2);
      expect(backupData.import_tasks).toHaveLength(1);
      const scanned = scanAttachmentReferences(backupData);
      const importKeys = scanned.files.filter((f) => f.bucket === "import-files");
      expect(importKeys.map((f) => f.path).sort()).toEqual(
        [pdfPath, docxPath, `${a.userId}/${taskId}/${docxFileId}-img1.png`].sort(),
      );

      const chunks: Uint8Array[] = [];
      const { manifest } = await buildAttachmentPackage(scanned, (chunk) => {
        chunks.push(chunk);
      }, { supabase: a.client });
      const zipBytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      expect(manifest.backup_version).toBe(7);
      expect(manifest.files.filter((f) => f.bucket === "import-files")).toHaveLength(3);
      expect(manifest.files.some((f) => f.bucket === "images" && f.path === imagePath)).toBe(true);

      // ---------- B 恢复：附件重放 + RPC 落库 ----------
      const mapping = await restoreAttachmentPackage(zipBytes, {
        supabase: b.client,
        userId: b.userId,
      });
      // 缺失资产如实报告为空（全部重放成功）
      expect(mapping.missing).toHaveLength(0);
      expect(mapping.migrated.files).toBe(manifest.files.length);

      const payload = prepareRestorePayload(
        JSON.parse(JSON.stringify({ format: "organize-backup", version: 7, exportedAt: new Date().toISOString(), manifest: { counts: {}, excluded: [] }, data: backupData }) as never),
        () => crypto.randomUUID(),
        { attachments: mapping },
      );
      const { data: rpcResult, error: rpcError } = await b.client.rpc(
        "restore_backup_v2_full",
        { p_payload: payload },
      );
      expect(rpcError).toBeNull();
      expect((rpcResult as { status: string }).status).toBe("restored");

      // ---------- 断言：B 侧的行与存储 ----------
      const { data: restoredFiles } = await b.client.from("import_files").select("*");
      expect(restoredFiles).toHaveLength(2);
      for (const row of restoredFiles ?? []) {
        // 坐标重映射到 B 目录，且 B 真的能下载到原件
        expect(row.storage_path).toMatch(new RegExp(`^${b.userId}/`));
        const { data: blob, error: dlError } = await b.client.storage
          .from("import-files")
          .download(row.storage_path!);
        expect(dlError).toBeNull();
        expect((await blob!.arrayBuffer()).byteLength).toBeGreaterThan(0);
        // 嵌入图坐标同样跟走
        if (row.kind === "docx") {
          expect(row.asset_paths).toHaveLength(1);
          expect(row.asset_paths[0]).toMatch(new RegExp(`^${b.userId}/`));
        }
        // 阅读条目关联在 B 名下成立
        if (row.reading_item_id) {
          const { data: reading } = await b.client.from("reading_items")
            .select("id").eq("id", row.reading_item_id);
          expect(reading).toHaveLength(1);
        }
      }
      // 任务状态收口一致（两行全 saved → saved）
      const { data: restoredTasks } = await b.client.from("import_tasks").select("status");
      expect(restoredTasks?.[0]?.status).toBe("saved");
      // 画布图片 URL 重映射到 B 的 images 桶
      const { data: restoredCanvas } = await b.client.from("canvas_documents").select("content");
      const restoredFreeItems = (restoredCanvas?.[0]?.content as { freeItems: Array<{ asset: { url: string } }> }).freeItems;
      expect(restoredFreeItems[0].asset.url).not.toBe(imageUrl);
      expect(restoredFreeItems[0].asset.url).toContain("/images/");

      // ---------- 隔离与私有性 ----------
      // B 的新原件路径对 A 不可读（RLS 目录限定）
      const bOriginalPath = (restoredFiles ?? [])[0].storage_path as string;
      const { error: aReadError } = await a.client.storage.from("import-files").download(bOriginalPath);
      expect(aReadError).not.toBeNull();
      // 私有桶对象无签名公开访问不可得
      const anonFetch = await fetch(`${URL}/storage/v1/object/public/import-files/${bOriginalPath}`);
      expect(anonFetch.ok).toBe(false);
      // A 的旧原件 B 也读不到（跨账号隔离）
      const { error: bReadOldError } = await b.client.storage.from("import-files").download(pdfPath);
      expect(bReadOldError).not.toBeNull();
    },
  );

  it(
    "包内缺文件：restore 记入 missing 明确报告，恢复不假报成功（storage_path 保留旧路径）",
    { timeout: 120_000 },
    async () => {
      const a = await signUp("c");
      const taskId = crypto.randomUUID();
      const fileId = crypto.randomUUID();
      const pdfBytes = fixture("sample.pdf");
      const pdfPath = `${a.userId}/${taskId}/${fileId}.pdf`;
      await a.client.storage.from("import-files").upload(pdfPath, pdfBytes);
      await a.client.from("import_tasks").insert({ id: taskId, status: "saved" });
      await a.client.from("import_files").insert({
        id: fileId, task_id: taskId, file_name: "缺文件.pdf", mime: "application/pdf",
        size: pdfBytes.length, kind: "pdf", storage_path: pdfPath, asset_paths: [],
        status: "saved", error: null, reading_item_id: null, page_count: 1,
        retry_key: `rt-miss-${fileId}`,
      });

      const backupData = pruneExportData(await fetchBackupData(a.client, a.userId));
      const scanned = scanAttachmentReferences(backupData);
      const chunks: Uint8Array[] = [];
      await buildAttachmentPackage(scanned, (chunk) => { chunks.push(chunk); }, { supabase: a.client });
      const zipBytes = Buffer.concat(chunks.map((c) => Buffer.from(c)));

      const b = await signUp("d");
      // 从 zip 中剥掉 import-files 条目（模拟包内缺失：只留 manifest 与空目录）
      const { unzipSync } = await import("fflate");
      const entries = unzipSync(zipBytes);
      for (const key of Object.keys(entries)) {
        if (key.startsWith("files/import-files/")) delete entries[key];
      }
      const { zipSync } = await import("fflate");
      const rezipped = zipSync(entries as Record<string, Uint8Array>, { level: 0 });
      // manifest 仍申报该文件（缺失才被发现）
      const mapping = await restoreAttachmentPackage(rezipped, {
        supabase: b.client,
        userId: b.userId,
      });
      expect(mapping.missing.length).toBeGreaterThan(0);
      expect(mapping.missing[0].file_key).toContain("import-files/");

      const payload = prepareRestorePayload(
        JSON.parse(JSON.stringify({ format: "organize-backup", version: 7, exportedAt: new Date().toISOString(), manifest: { counts: {}, excluded: [] }, data: backupData }) as never),
        () => crypto.randomUUID(),
        { attachments: mapping },
      );
      const { data: rpcResult, error: rpcError } = await b.client.rpc(
        "restore_backup_v2_full",
        { p_payload: payload },
      );
      expect(rpcError).toBeNull();
      expect((rpcResult as { status: string }).status).toBe("restored");
      // 行恢复成功，但坐标保留旧路径（下载会 404）——缺失如实可查，不假报成功
      const { data: restoredFiles } = await b.client.from("import_files").select("storage_path");
      expect(restoredFiles?.[0]?.storage_path).toBe(pdfPath);
    },
  );
});
