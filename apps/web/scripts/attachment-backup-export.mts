// B07-2 附件可携带备份导出（真实后端，脚本形态——设计 §7-d 默认：脚本先行）
//
// 用法（前置：本地 Supabase 运行中）：
//   cd apps/web && npx tsx scripts/attachment-backup-export.mts --email <邮箱> --password <密码>
// 或显式注入（CI/远端）：
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   npx tsx scripts/attachment-backup-export.mts --email ... --password ... [--out-dir ...]
//
// 产出（成对交付，缺一不构成完整备份）：
//   <out-dir>/organize-backup-v5.json        # 现有 v5 元数据备份（createBackupV2）
//   <out-dir>/organize-files-<时间戳>.zip    # A 类附件本体 + manifest.json（B07-3 恢复消费）
//
// 说明：外链图片/失效外链不打包（external_urls 如实声明）；base64 内联自包含只计数。
// 中断（Ctrl-C / 超限 / 下载失败）即丢弃半成品 zip，不产出部分包。
// mock 后端下不可用（Storage 不存在），脚本只面向真实后端。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AttachmentPackageCancelledError,
  buildAttachmentPackage,
  scanAttachmentReferences,
} from "../lib/backup/attachment-package";
import { createBackupV2 } from "../lib/backup/schema";
import { fetchBackupData, pruneExportData } from "../lib/backup/export-data";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const status = JSON.parse(execSync("supabase status -o json", { encoding: "utf8" }));
const SB_URL = process.env.SUPABASE_URL ?? status.API_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? status.ANON_KEY;

const email = arg("email");
const password = arg("password");
if (!email || !password) {
  console.error("用法: npx tsx scripts/attachment-backup-export.mts --email <邮箱> --password <密码> [--out-dir <目录>]");
  process.exit(1);
}
const outDir = resolve(arg("out-dir") ?? "attachment-backup-output");

const supabase: SupabaseClient = createClient(SB_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
if (signInError) throw new Error(`登录失败: ${signInError.message}`);
const userId = signIn.user!.id;
console.log(`已登录 ${email}（${userId}），目标目录 ${outDir}`);

const pkg = JSON.parse(
  (await import("node:fs")).readFileSync(join(fileURLToPath(new URL("../package.json", import.meta.url))), "utf8")
) as { version?: string };

const runId = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const jsonPath = join(outDir, "organize-backup-v5.json");
const zipPath = join(outDir, `organize-files-${runId}.zip`);

const controller = new AbortController();
process.on("SIGINT", () => {
  console.log("\n收到中断，取消打包…");
  controller.abort();
});

let stream: ReturnType<typeof createWriteStream> | null = null;
try {
  await mkdir(outDir, { recursive: true });

  console.log("拉取备份数据（RLS 用户会话）…");
  const data = pruneExportData(await fetchBackupData(supabase, userId));
  const backup = createBackupV2(data);
  await import("node:fs/promises").then((fs) => fs.writeFile(jsonPath, JSON.stringify(backup)));
  console.log(`✓ 元数据 JSON → ${jsonPath}`);

  console.log("扫描附件引用…");
  const scanned = scanAttachmentReferences(data);
  console.log(
    `  A 类附件 ${scanned.files.length} 个 / url_map ${scanned.urlMap.length} 条；` +
      `外链(不打包) ${scanned.externalUrls.length} 条${scanned.externalUrlsTruncated ? "（截断）" : ""}；` +
      `base64 内联 ${scanned.inlineBase64Count} 处`
  );
  if (scanned.files.length === 0) {
    console.log("无 A 类附件，跳过文件包（v5 JSON 已含全部元数据）");
    process.exit(0);
  }

  console.log("下载并打包（STORE 流式，可 Ctrl-C 取消）…");
  stream = createWriteStream(zipPath);
  // 单一持久 error 监听（每 chunk 挂 once 会触发 MaxListeners 告警）；
  // 失败在下一个 chunk 边界或 end 时浮出
  let streamFailure: Error | null = null;
  stream!.on("error", (err) => {
    streamFailure = err;
  });
  const writeChunk = (chunk: Uint8Array): Promise<void> =>
    new Promise((resolveChunk, rejectChunk) => {
      if (streamFailure) {
        rejectChunk(streamFailure);
        return;
      }
      // write() 返回 true = 已入缓冲可继续；false = 缓冲满等 drain
      if (stream!.write(chunk)) resolveChunk();
      else stream!.once("drain", resolveChunk);
    });

  const result = await buildAttachmentPackage(scanned, writeChunk, {
    supabase,
    signal: controller.signal,
    appVersion: pkg.version,
  });
  await new Promise<void>((resolveStream, rejectStream) => {
    stream!.end(resolveStream);
    stream!.once("error", rejectStream);
  });
  stream = null;

  console.log(`✓ 文件包 → ${zipPath}`);
  console.log(
    `完成：${result.fileCount} 个附件 / ${(result.totalBytes / 1024 / 1024).toFixed(2)} MB；` +
      `恢复时需同时提供 JSON + zip 两个文件（B07-3）`
  );
} catch (error) {
  stream?.destroy();
  stream = null;
  if (error instanceof AttachmentPackageCancelledError) {
    await rm(zipPath, { force: true });
    console.error("已取消：半成品 zip 已丢弃");
    process.exit(130);
  }
  await rm(zipPath, { force: true });
  console.error(`导出失败（半成品 zip 已丢弃）:`, error instanceof Error ? error.message : error);
  process.exit(1);
}
