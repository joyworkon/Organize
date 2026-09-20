import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
import {
  AttachmentPackageCancelledError,
  AttachmentPackageLimitError,
  buildAttachmentPackage,
  PACKAGE_KEY_PATTERN,
  PACKAGE_MAX_FILES,
  scanAttachmentReferences,
  type ScannedPackage,
} from "./attachment-package";
import type { BackupData } from "./schema";

// B07-2 导出侧单测：四类资源分类（§1.2/§4-2）、扫描白名单、打包护栏与取消（§4-3/4-4）、
// manifest 合同与 zip 完整性（fflate 解包轮转 + STORE method + sha256 复核）。

const URL_BASE = "https://sb.example.com";
const storageUrl = (bucket: string, path: string) =>
  `${URL_BASE}/storage/v1/object/public/${bucket}/${path}`;

const emptyData = (): BackupData =>
  ({
    reading_items: [],
    notes: [],
    tags: [],
    item_tags: [],
    note_tags: [],
    tasks: [],
    task_dependencies: [],
    task_checklists: [],
    task_tags: [],
    lessons: [],
    lesson_tags: [],
    highlights: [],
    favorites: [],
    note_versions: [],
    note_comment_threads: [],
    note_comments: [],
    note_suggestions: [],
    synced_blocks: [],
    db_databases: [],
    db_rows: [],
    task_lists: [],
    task_reminders: [],
    task_attachments: [],
    task_activities: [],
    task_templates: [],
    countdown_days: [],
    memos: [],
    task_item_refs: [],
    memo_notes: [],
    canvas_documents: [],
  }) as unknown as BackupData;

const imgNode = (src: string) => ({
  type: "doc",
  content: [{ type: "resizableImage", attrs: { src } }],
});

describe("scanAttachmentReferences 分类", () => {
  it("A 类：笔记正文 JSON 里的 Storage URL → files + url_map；同 URL 多次出现去重", () => {
    const data = emptyData();
    data.notes = [
      { id: "n1", content: imgNode(storageUrl("images", "u1/1.png")), cover_url: null },
      { id: "n2", content: imgNode(storageUrl("images", "u1/1.png")), cover_url: null },
    ] as never;
    const scanned = scanAttachmentReferences(data);
    expect(scanned.files).toEqual([{ bucket: "images", path: "u1/1.png" }]);
    expect(scanned.urlMap).toEqual([
      { old_url: storageUrl("images", "u1/1.png"), file_key: "files/images/u1/1.png" },
    ]);
    expect(scanned.inlineBase64Count).toBe(0);
  });

  it("A 类：阅读 HTML 正文与 task_attachments 元数据行同归并去重", () => {
    const data = emptyData();
    data.reading_items = [
      {
        id: "r1",
        content: `<figure><img src="${storageUrl("images", "u1/cover.png")}" alt=""></figure>`,
        cover_image: storageUrl("images", "u1/cover.png"),
      },
    ] as never;
    data.task_attachments = [
      { id: "t1", bucket: "attachments", path: "u1/report.pdf" },
      { id: "t2", bucket: "weird-bucket", path: "u1/ignored.bin" },
    ] as never;
    const scanned = scanAttachmentReferences(data);
    expect(scanned.files).toContainEqual({ bucket: "images", path: "u1/cover.png" });
    expect(scanned.files).toContainEqual({ bucket: "attachments", path: "u1/report.pdf" });
    expect(scanned.files.find((f) => f.path === "u1/ignored.bin")).toBeUndefined();
  });

  it("B/D 类：外链进 external_urls；reading_items.url 来源字段不计入", () => {
    const data = emptyData();
    data.reading_items = [
      {
        id: "r1",
        url: "https://example.com/article",
        content: `<img src="https://cdn.other.com/pic.jpg"><a href="https://plain.link">x</a>`,
        cover_image: null,
      },
    ] as never;
    const scanned = scanAttachmentReferences(data);
    expect(scanned.externalUrls).toContain("https://cdn.other.com/pic.jpg");
    expect(scanned.externalUrls).toContain("https://plain.link");
    expect(scanned.externalUrls).not.toContain("https://example.com/article");
  });

  it("C 类：base64 data URL 只计数不打包", () => {
    const data = emptyData();
    data.notes = [
      { id: "n1", content: imgNode("data:image/png;base64,iVBORw0KGgo="), cover_url: null },
    ] as never;
    const scanned = scanAttachmentReferences(data);
    expect(scanned.inlineBase64Count).toBe(1);
    expect(scanned.files).toHaveLength(0);
    expect(scanned.externalUrls).toHaveLength(0);
  });

  it("路径白名单外字符 → 明确报错（B07-3 解包合同的前置保证）", () => {
    const data = emptyData();
    data.task_attachments = [
      { id: "t1", bucket: "images", path: "u1/../evil.png" },
    ] as never;
    expect(() => scanAttachmentReferences(data)).toThrow(/白名单外字符/);
  });
});

// ---- 打包 ----

const bytes = (text: string) => new TextEncoder().encode(text);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const buildToBuffer = async (
  scanned: ScannedPackage,
  options: Partial<Parameters<typeof buildAttachmentPackage>[2]> = {}
) => {
  const chunks: Uint8Array[] = [];
  const result = await buildAttachmentPackage(
    scanned,
    (chunk) => {
      chunks.push(chunk);
    },
    { supabase: {} as never, ...options }
  );
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return { result, zipBytes: merged, chunks };
};

describe("buildAttachmentPackage", () => {
  const scanned: ScannedPackage = {
    files: [
      { bucket: "images", path: "u1/a.png" },
      { bucket: "attachments", path: "u1/b.pdf" },
    ],
    urlMap: [
      { old_url: storageUrl("images", "u1/a.png"), file_key: "files/images/u1/a.png" },
    ],
    externalUrls: ["https://cdn.other.com/pic.jpg"],
    externalUrlsTruncated: false,
    inlineBase64Count: 2,
  };
  const blobs: Record<string, Uint8Array> = {
    "images/u1/a.png": bytes("PNGDATA-a"),
    "attachments/u1/b.pdf": bytes("PDFDATA-b"),
  };
  const downloader = async (bucket: string, path: string) => {
    const blob = blobs[`${bucket}/${path}`];
    if (!blob) throw new Error(`missing fixture ${bucket}/${path}`);
    return blob;
  };

  it("zip 轮转：manifest 与文件 entry 内容一致、STORE method=0、sha256/size 复核通过", async () => {
    const { result, zipBytes } = await buildToBuffer(scanned, {
      downloadObject: downloader,
      now: () => new Date("2026-09-15T00:00:00Z"),
      appVersion: "1.2.3",
    });

    const unzipped = unzipSync(zipBytes);
    expect(Object.keys(unzipped).sort()).toEqual([
      "files/attachments/u1/b.pdf",
      "files/images/u1/a.png",
      "manifest.json",
    ]);
    expect(Buffer.from(unzipped["files/images/u1/a.png"]).toString()).toBe("PNGDATA-a");
    expect(Buffer.from(unzipped["files/attachments/u1/b.pdf"]).toString()).toBe("PDFDATA-b");

    const manifest = JSON.parse(Buffer.from(unzipped["manifest.json"]).toString("utf8"));
    expect(manifest.package_version).toBe(1);
    expect(manifest.backup_version).toBe(6);
    expect(manifest.app_version).toBe("1.2.3");
    expect(manifest.total_bytes).toBe(result.totalBytes);
    expect(manifest.url_map).toEqual(scanned.urlMap);
    expect(manifest.external_urls).toEqual(scanned.externalUrls);
    expect(manifest.inline_base64_count).toBe(2);
    expect(manifest.files).toHaveLength(2);
    for (const file of manifest.files) {
      expect(PACKAGE_KEY_PATTERN.test(file.key)).toBe(true);
      expect(file.sha256).toBe(sha256(unzipped[file.key]));
      expect(file.size_bytes).toBe(unzipped[file.key].length);
      expect(file.mime_type).toContain("/");
    }

    // STORE：本地文件头 method 偏移 8 = 0（manifest 与首个文件 entry 各验一次）
    for (const name of ["manifest.json", "files/images/u1/a.png"]) {
      const at = zipBytes.findIndex(
        (_, i) =>
          i + 30 < zipBytes.length &&
          Buffer.from(zipBytes.slice(i + 30, i + 30 + name.length)).toString() === name
      );
      expect(at).toBeGreaterThan(-1);
      expect(zipBytes[at + 8]).toBe(0);
      expect(zipBytes[at + 9]).toBe(0);
    }
    expect(result.fileCount).toBe(2);
    expect(result.totalBytes).toBe(18);
  });

  it("文件数超上限 → AttachmentPackageLimitError（不静默截断）", async () => {
    const many: ScannedPackage = {
      ...scanned,
      files: Array.from({ length: 3 }, (_, i) => ({
        bucket: "images" as const,
        path: `u1/f${i}.png`,
      })),
    };
    await expect(
      buildToBuffer(many, { downloadObject: downloader, maxFiles: 2 })
    ).rejects.toBeInstanceOf(AttachmentPackageLimitError);
  });

  it("总字节超上限 → AttachmentPackageLimitError，报错含建议", async () => {
    await expect(
      buildToBuffer(scanned, {
        downloadObject: downloader,
        maxTotalBytes: 8,
      })
    ).rejects.toThrow(/上限/);
    expect(PACKAGE_MAX_FILES).toBe(5_000);
  });

  it("AbortSignal 预先中止 → CancelledError；下载中触发亦中止", async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      buildToBuffer(scanned, { downloadObject: downloader, signal: aborted.signal })
    ).rejects.toBeInstanceOf(AttachmentPackageCancelledError);

    const mid = new AbortController();
    let calls = 0;
    const cancelOnSecond = async (bucket: string, path: string) => {
      calls++;
      if (calls === 2) mid.abort();
      return downloader(bucket, path);
    };
    await expect(
      buildToBuffer(scanned, { downloadObject: cancelOnSecond, signal: mid.signal })
    ).rejects.toBeInstanceOf(AttachmentPackageCancelledError);
  });

  it("下载失败 → 抛错即弃（不产出部分包）", async () => {
    const failing = async (bucket: string, path: string) => {
      if (path === "u1/b.pdf") throw new Error("storage 500");
      return downloader(bucket, path);
    };
    await expect(
      buildToBuffer(scanned, { downloadObject: failing })
    ).rejects.toThrow(/storage 500/);
  });
});
