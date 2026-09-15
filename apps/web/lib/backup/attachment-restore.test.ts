import { describe, expect, it } from "vitest";
import { zipSync, unzipSync } from "fflate";
import { createHash } from "node:crypto";
import {
  ATTACHMENT_PACKAGE_VERSION,
  type AttachmentManifest,
} from "./attachment-package";
import {
  AttachmentRestoreError,
  remapAttachmentReferences,
  restoreAttachmentPackage,
} from "./attachment-restore";
import { prepareRestorePayload } from "./restore";
import { createBackupV2, type BackupData } from "./schema";

// B07-3 恢复侧单测（设计 §5-1/§5-2/§5-3）：
// 校验先行（坏包/zip-slip/炸弹/sha 不符 → 零上传）、包内缺文件与上传失败 → missing
// 不阻断、Storage 重放路径改写、prepareRestorePayload 附件重映射与向后兼容。

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytesOf = (text: string) => new TextEncoder().encode(text);
const OLD_HOST = "https://old-supabase.example.com";
const storageUrl = (bucket: string, path: string) =>
  `${OLD_HOST}/storage/v1/object/public/${bucket}/${path}`;

/** 构造 STORE 包：manifest 最后落包（与导出实现一致） */
function buildPackage(
  files: Record<string, Uint8Array>,
  manifest: Partial<AttachmentManifest> & { files?: AttachmentManifest["files"]; url_map?: AttachmentManifest["url_map"] }
): Uint8Array {
  const fullManifest: AttachmentManifest = {
    package_version: ATTACHMENT_PACKAGE_VERSION,
    created_at: new Date("2026-09-16T00:00:00Z").toISOString(),
    backup_version: 5,
    files: [],
    url_map: [],
    external_urls: [],
    external_urls_truncated: false,
    inline_base64_count: 0,
    total_bytes: 0,
    ...manifest,
  };
  return zipSync(
    { ...files, "manifest.json": bytesOf(JSON.stringify(fullManifest)) },
    { level: 0 }
  );
}

const PNG = bytesOf("PNGDATA-a");
const PDF = bytesOf("PDFDATA-b");
const manifestFile = (key: string, payload: Uint8Array): AttachmentManifest["files"][number] => {
  const [, bucket, ...rest] = key.split("/");
  return {
    key,
    bucket: bucket as "images" | "attachments",
    path: rest.join("/"),
    sha256: sha256(payload),
    size_bytes: payload.length,
    mime_type: bucket === "images" ? "image/png" : "application/pdf",
  };
};

interface UploadRecord {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  mimeType: string;
}

function harness(options: { failUploadFor?: Set<string> } = {}) {
  const uploads: UploadRecord[] = [];
  const uploadObject = async (
    bucket: "images" | "attachments",
    path: string,
    bytes: Uint8Array,
    mimeType: string
  ) => {
    if (options.failUploadFor?.has(path) || options.failUploadFor?.has(`${bucket}/${path}`)) {
      throw new AttachmentRestoreError("storage 500");
    }
    uploads.push({ bucket, path, bytes, mimeType });
  };
  const publicUrl = (bucket: "images" | "attachments", path: string) =>
    `https://new-supabase.example.com/storage/v1/object/public/${bucket}/${path}`;
  return {
    uploads,
    restore: (zip: Uint8Array, extra: Record<string, unknown> = {}) =>
      restoreAttachmentPackage(zip, {
        supabase: {} as never,
        userId: "new-user",
        uploadObject,
        publicUrl,
        uuid: () => `uuid-${uploads.length + 1}`,
        ...extra,
      }),
  };
}

describe("restoreAttachmentPackage 安全解包", () => {
  const pngKey = "files/images/u1/a.png";
  const pdfKey = "files/attachments/u1/b.pdf";
  const oldUrl = storageUrl("images", "u1/a.png");
  const files = { [pngKey]: PNG, [pdfKey]: PDF };
  const validManifest = {
    package_version: ATTACHMENT_PACKAGE_VERSION,
    files: [manifestFile(pngKey, PNG), manifestFile(pdfKey, PDF)],
    url_map: [{ old_url: oldUrl, file_key: pngKey }],
    external_urls: ["https://cdn.other.com/pic.jpg"],
    external_urls_truncated: false,
    inline_base64_count: 1,
    total_bytes: PNG.length + PDF.length,
  };

  it("happy path：重放到 {userId}/{uuid}.{ext} 新路径，映射与统计齐全", async () => {
    const { restore, uploads } = harness();
    const mapping = await restore(buildPackage(files, validManifest));
    expect(uploads).toHaveLength(2);
    expect(uploads[0].path).toMatch(/^new-user\/uuid-1\.png$/);
    expect(uploads[1].path).toMatch(/^new-user\/uuid-2\.pdf$/);
    expect(uploads[0].bytes).toEqual(PNG);
    expect(mapping.urlMap).toEqual([
      {
        old_url: oldUrl,
        new_url: "https://new-supabase.example.com/storage/v1/object/public/images/new-user/uuid-1.png",
      },
    ]);
    expect(mapping.pathMap.get("images/u1/a.png")?.path).toBe("new-user/uuid-1.png");
    expect(mapping.pathMap.get("attachments/u1/b.pdf")?.newUrl).toContain("/attachments/new-user/uuid-2.pdf");
    expect(mapping.missing).toHaveLength(0);
    expect(mapping.migrated).toEqual({ files: 2, bytes: PNG.length + PDF.length });
  });

  it("zip-slip：`..` 路径段条目 → 校验阶段拒绝，零上传", async () => {
    const { restore, uploads } = harness();
    const evil = buildPackage(
      { "files/images/u1/../evil.png": PNG },
      { files: [manifestFile("files/images/u1/../evil.png", PNG)], url_map: [] }
    );
    await expect(restore(evil)).rejects.toThrow(/白名单|zip-slip/u);
    expect(uploads).toHaveLength(0);
  });

  it("非 STORE 条目（deflate）→ 解压前拒绝", async () => {
    const { restore, uploads } = harness();
    const deflated = zipSync(
      { [pngKey]: PNG, "manifest.json": bytesOf(JSON.stringify({ ...validManifest, files: [manifestFile(pngKey, PNG)], total_bytes: PNG.length })) },
      { level: 9 }
    );
    await expect(restore(deflated)).rejects.toThrow(/非 STORE/u);
    expect(uploads).toHaveLength(0);
  });

  it("解压总量超上限（zip 炸弹防护）→ 解压前拒绝", async () => {
    const { restore, uploads } = harness();
    const big = buildPackage(
      { [pngKey]: PNG, [pdfKey]: PDF },
      { ...validManifest }
    );
    await expect(restore(big, { maxTotalBytes: 8 })).rejects.toThrow(/超过上限/u);
    expect(uploads).toHaveLength(0);
  });

  it("坏包形态：垃圾字节 / 缺 manifest / manifest 非法 JSON → 拒绝且零上传", async () => {
    const { restore, uploads } = harness();
    await expect(restore(bytesOf("not a zip"))).rejects.toThrow(/EOCD/u);
    const noManifest = zipSync({ [pngKey]: PNG }, { level: 0 });
    await expect(restore(noManifest)).rejects.toThrow(/manifest.json 缺失/u);
    const badManifest = zipSync(
      { [pngKey]: PNG, "manifest.json": bytesOf("{broken") },
      { level: 0 }
    );
    await expect(restore(badManifest)).rejects.toThrow(/合法 JSON/u);
    expect(uploads).toHaveLength(0);
  });

  it("manifest 缺字段 / url_map 引用未申报 file_key / 未申报条目 → 拒绝", async () => {
    const { restore, uploads } = harness();
    const missingFields = buildPackage(files, { files: undefined, url_map: [] } as never);
    await expect(restore(missingFields)).rejects.toThrow(/缺 files\/url_map|字段缺失/u);
    const danglingUrlMap = buildPackage(files, {
      ...validManifest,
      url_map: [{ old_url: oldUrl, file_key: "files/images/u1/ghost.png" }],
    });
    await expect(restore(danglingUrlMap)).rejects.toThrow(/未申报的 file_key/u);
    const undeclaredEntry = zipSync(
      { [pngKey]: PNG, [pdfKey]: PDF, "files/images/u1/sneaky.png": PNG, "manifest.json": bytesOf(JSON.stringify({ ...validManifest, total_bytes: PNG.length + PDF.length + PNG.length })) },
      { level: 0 }
    );
    await expect(restore(undeclaredEntry)).rejects.toThrow(/未申报的条目/u);
    expect(uploads).toHaveLength(0);
  });

  it("sha256 与 manifest 不符 → 整包拒绝、零上传（校验先行）", async () => {
    const { restore, uploads } = harness();
    const tampered = buildPackage(files, {
      ...validManifest,
      files: [manifestFile(pngKey, PDF), manifestFile(pdfKey, PDF)],
    });
    await expect(restore(tampered)).rejects.toThrow(/sha256/u);
    expect(uploads).toHaveLength(0);
  });

  it("包内缺文件 → missing（不阻断），其余文件照常重放；missing 带旧 URL", async () => {
    const { restore, uploads } = harness();
    const zip = zipSync({ [pngKey]: PNG, "manifest.json": bytesOf(JSON.stringify({ ...validManifest, total_bytes: PNG.length })) }, { level: 0 });
    const mapping = await restore(zip);
    expect(uploads).toHaveLength(1);
    expect(mapping.missing).toHaveLength(1);
    expect(mapping.missing[0]).toMatchObject({
      file_key: pdfKey,
      reason: "包内缺文件",
    });
    expect(mapping.missing[0].old_urls).toHaveLength(0);
    expect(mapping.migrated.files).toBe(1);
  });

  it("上传失败 → missing（不阻断）不污染其余文件", async () => {
    const { restore, uploads } = harness({ failUploadFor: new Set(["new-user/uuid-1.png"]) });
    const mapping = await restore(buildPackage(files, validManifest));
    expect(mapping.missing).toHaveLength(1);
    expect(mapping.missing[0]).toMatchObject({ file_key: pngKey, reason: expect.stringContaining("上传失败") });
    expect(mapping.missing[0].old_urls).toEqual([oldUrl]);
    expect(mapping.migrated.files).toBe(1);
    expect(mapping.urlMap).toHaveLength(0);
    // uuid 计数器与 uploads 联动仅用于测试可读性：失败后第二个文件成功上传
    expect(uploads).toHaveLength(1);
  });
});

describe("prepareRestorePayload 附件重映射", () => {
  const pngKey = "files/images/u1/a.png";
  const oldUrl = storageUrl("images", "u1/a.png");
  const newUrl = "https://new-supabase.example.com/storage/v1/object/public/images/new-user/x.png";

  // createBackupV2 要求 29 表键齐全：先铺空表再覆盖测试关注的表
  const emptyTables = Object.fromEntries(
    (
      [
        "reading_items", "notes", "tags", "item_tags", "note_tags", "tasks",
        "task_dependencies", "task_checklists", "task_tags", "lessons", "lesson_tags",
        "highlights", "favorites", "note_versions", "note_comment_threads", "note_comments",
        "note_suggestions", "synced_blocks", "db_databases", "db_rows", "task_lists",
        "task_reminders", "task_attachments", "task_activities", "task_templates",
        "countdown_days", "memos", "task_item_refs", "memo_notes",
      ] as const
    ).map((table) => [table, []])
  ) as unknown as BackupData;

  const NOW = "2026-09-16T00:00:00Z";
  const NOTE_ID = "20000000-0000-4000-8000-000000000001";
  const TASK_ID = "20000000-0000-4000-8000-000000000002";
  const ATT1_ID = "20000000-0000-4000-8000-000000000003";
  const ATT2_ID = "20000000-0000-4000-8000-000000000004";
  const backupData = {
    ...emptyTables,
    notes: [
      {
        id: NOTE_ID,
        title: "笔记",
        reading_item_id: null,
        is_pinned: false,
        created_at: NOW,
        updated_at: NOW,
        content: {
          type: "doc",
          content: [
            { type: "resizableImage", attrs: { src: oldUrl } },
            { type: "paragraph", content: [{ type: "text", text: `外链 ${storageUrl("images", "u1/gone.png")} 与 base64 data:image/png;base64,AAA 保持` }] },
          ],
        },
        cover_url: oldUrl,
        cover_position: 50,
      },
    ],
    task_attachments: [
      { id: ATT1_ID, task_id: TASK_ID, bucket: "images", path: "u1/a.png", name: "a.png", mime_type: "image/png", size_bytes: 1, created_at: NOW },
      { id: ATT2_ID, task_id: TASK_ID, bucket: "images", path: "u1/missing.png", name: "missing.png", mime_type: "image/png", size_bytes: 1, created_at: NOW },
    ],
    tasks: [{
      id: TASK_ID,
      title: "任务",
      description: `见 ${storageUrl("attachments", "u1/b.pdf")}`,
      status: "todo",
      priority: "medium",
      category: "work",
      due_date: null,
      estimated_minutes: null,
      actual_minutes: null,
      reading_item_id: null,
      note_id: null,
      is_pinned: false,
      sort_order: 0,
      completed_at: null,
      created_at: NOW,
      updated_at: NOW,
    }],
  } as unknown as BackupData;

  const mapping = {
    manifest: {
      package_version: 1,
      created_at: "",
      backup_version: 5,
      files: [],
      url_map: [],
      external_urls: [],
      external_urls_truncated: false,
      inline_base64_count: 0,
      total_bytes: 0,
    },
    urlMap: [{ old_url: oldUrl, new_url: newUrl }],
    pathMap: new Map([
      ["images/u1/a.png", { bucket: "images" as const, path: "new-user/x.png", newUrl }],
      [
        "attachments/u1/b.pdf",
        {
          bucket: "attachments" as const,
          path: "new-user/y.pdf",
          newUrl: "https://new-supabase.example.com/storage/v1/object/public/attachments/new-user/y.pdf",
        },
      ],
    ]),
    missing: [{ file_key: "files/images/u1/gone.png", old_urls: [storageUrl("images", "u1/gone.png")], reason: "包内缺文件" }],
    migrated: { files: 1, bytes: 3 },
  };

  const run = (backupData2: BackupData, attachments?: typeof mapping) => {
    let seq = 0;
    const payload = prepareRestorePayload(
      createBackupV2(backupData2),
      () => {
        seq += 1;
        return `20999999-9999-4999-8999-${String(seq).padStart(12, "0")}`;
      },
      attachments ? { attachments } : undefined
    );
    return payload.data;
  };

  it("内容 URL 与 task_attachments 坐标重映射；missing 的 URL 原样保留", () => {
    const data = run(backupData, mapping);
    const note = data.notes[0];
    const img = (note.content as { content: Array<{ attrs?: { src?: string } }> }).content[0];
    expect(img.attrs?.src).toBe(newUrl);
    expect(note.cover_url).toBe(newUrl);
    const text = (note.content as { content: Array<{ content?: Array<{ text?: string }> }> }).content[1]
      .content?.[0].text ?? "";
    // missing 的 URL 原样保留（失效引用如实呈现）
    expect(text).toContain(storageUrl("images", "u1/gone.png"));
    expect((data.task_attachments[0] as { path: string }).path).toBe("new-user/x.png");
    expect((data.task_attachments[1] as { path: string }).path).toBe("u1/missing.png");
    expect((data.tasks[0] as { description: string }).description).toContain(
      "/storage/v1/object/public/attachments/new-user/"
    );
  });

  it("不提供 attachments 时行为与旧版完全一致（向后兼容）", () => {
    const data = run(backupData);
    const note = data.notes[0];
    expect(JSON.stringify(note.content)).toContain(OLD_HOST);
    expect((data.task_attachments[0] as { path: string }).path).toBe("u1/a.png");
  });

  it("remapAttachmentReferences 直接调用：非白名单路径段不替换", () => {
    const payload = { notes: [{ content: `x ${storageUrl("images", "u1/../a.png")} y` }] };
    remapAttachmentReferences(payload, mapping);
    expect((payload.notes[0] as { content: string }).content).toContain("u1/../a.png");
  });
});
