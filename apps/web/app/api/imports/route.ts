import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
type Supabase = Awaited<ReturnType<typeof createClient>>;

// 禁 lint 噪声：类型别名紧邻使用处
import { createClient } from "@/lib/supabase/server";
import { validateImportBatch } from "@/lib/imports/budgets";
import { isImportError, toImportError } from "@/lib/imports/errors";
import { extractServerDocument } from "@/lib/imports/extract-server";
import { importKind } from "@/lib/imports/kinds";
import { h } from "@/lib/imports/html";
import {
  IMPORT_STALE_THRESHOLD_MS,
  INTERRUPTED_ERROR_MESSAGE,
  isImportRowStale,
} from "@/lib/imports/stale";
import {
  decodeImportHistoryCursor,
  encodeImportHistoryCursor,
  ImportHistoryCursorError,
} from "@/lib/imports/history-cursor";
import type { ImportFileResult, ImportKind } from "@/lib/imports/types";
import {
  recoverStaleImports,
  recomputeTaskStatus,
  toResult,
  type ImportFileRow,
} from "@/lib/imports/recovery-server";
import { collectImportItem } from "@/lib/reading/collect-server";

/**
 * POST /api/imports — 批量文件导入（阶段 D；阶段 1 加固可靠性）。
 *
 * multipart/form-data：files（多文件）+ retryKeys（与 files 一一对应的稳定请求标识）。
 * 可靠性语义（阶段 1）：
 *   - 幂等：同用户同 retryKey 已有非 failed 且新鲜的记录 → 原样返回（双击/网络重发/
 *     并发同键不重复导入；并发建行撞 090 唯一约束时读出赢家行按幂等处理）。
 *   - 中断恢复：进行中（uploading/parsing）但 updated_at 超过 IMPORT_STALE_THRESHOLD_MS
 *     的行视同请求已死，原地重跑（原件 upsert 幂等、正文 URN 内容指纹去重幂等）。
 *   - 任务行惰性创建：纯重试批不产生空任务；结束时全部被触碰的任务按文件现状重算状态，
 *     失败项修好任务即收口（partial → saved）。
 *   - 结果逐文件回传 retryKey，客户端按它配对（禁止按文件名配对——同名文件会错配）。
 * 三份内容分离：原件 → import-files 私有桶；提取正文 → reading_items
 * （经 collectImportItem 统一收集入口）；AI 整理稿（可选）走既有 AI 链路，不在此处。
 */

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }

  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  const retryKeys = form.getAll("retryKeys").map(String);
  const batchError = validateImportBatch(files);
  if (batchError) return NextResponse.json({ error: batchError }, { status: 400 });
  if (retryKeys.some((key) => !key || key.length > 80)) {
    return NextResponse.json({ error: "retryKey 无效" }, { status: 400 });
  }
  if (retryKeys.length && retryKeys.length !== files.length) {
    return NextResponse.json({ error: "retryKeys 与 files 数量不一致" }, { status: 400 });
  }

  // 任务行惰性创建：仅当有文件需要落行时才建（纯重试批不产生空任务）
  let taskId: string | null = null;
  const ensureTask = async (): Promise<string> => {
    if (taskId) return taskId;
    const { data: task, error } = await supabase
      .from("import_tasks").insert({ user_id: user.id, status: "processing" })
      .select("id").single();
    if (error || !task) throw new Error(error?.message ?? "导入任务创建失败");
    const createdId: string = task.id;
    taskId = createdId;
    return createdId;
  };

  const results: ImportFileResult[] = [];
  for (let i = 0; i < files.length; i++) {
    const retryKey = retryKeys[i] ?? `${await ensureTask()}:${i}`;
    results.push(await importOneFile(supabase, user.id, ensureTask, files[i], retryKey));
  }

  // 收口：被触碰的任务全部按文件现状重算（失败项修好 → partial 收口为 saved）
  const touchedTaskIds = [...new Set(results.map((r) => r.taskId))];
  const taskStatuses = new Map<string, string>();
  for (const id of touchedTaskIds) {
    taskStatuses.set(id, await recomputeTaskStatus(supabase, user.id, id));
  }
  if (taskId) {
    const { count } = await supabase
      .from("import_files")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("task_id", taskId);
    if (!count) {
      // 整批都在落行前失败（罕见）：不留空任务行
      await supabase.from("import_tasks").delete().eq("id", taskId).eq("user_id", user.id);
      taskStatuses.delete(taskId);
      taskId = results[0]?.taskId ?? null;
    }
  }
  const primaryTaskId = taskId ?? results[0]?.taskId ?? "";
  return NextResponse.json({
    task: { id: primaryTaskId, status: taskStatuses.get(primaryTaskId) ?? "failed" },
    files: results,
  });
}

/** 单文件导入：幂等（retry_key 唯一）→ 原件入私有桶 → 解析 → 统一收集入口。 */
async function importOneFile(
  supabase: Supabase,
  userId: string,
  ensureTask: () => Promise<string>,
  file: File,
  retryKey: string,
): Promise<ImportFileResult> {
  const kind = importKind(file);
  const base = {
    fileName: file.name, size: file.size, kind: (kind ?? "text") as ImportKind,
    pageCount: null as number | null,
  };

  // 幂等：同用户同 retryKey 已有记录。新鲜的非 failed 行原样返回（双击/网络重发/他端在途）；
  // stale 的进行中行视同中断 → 原地重跑；failed 行 → 原地重跑。
  const { data: existing } = await supabase
    .from("import_files").select("*")
    .eq("user_id", userId).eq("retry_key", retryKey)
    .maybeSingle();
  const interrupted = !!existing && existing.status !== "failed" && isImportRowStale(existing.updated_at);
  if (existing && existing.status !== "failed" && !interrupted) {
    return toResult(existing as ImportFileRow);
  }
  // failed/中断记录 → 原地重跑（复用同一行，不产生第二行）
  const rowId = existing?.id ?? null;

  const fail = async (message: string): Promise<ImportFileResult> => {
    if (rowId) {
      const { data: updated } = await supabase.from("import_files")
        .update({ status: "failed", error: message })
        .eq("id", rowId).eq("user_id", userId)
        .select("*").single();
      return toResult((updated ?? existing) as ImportFileRow);
    }
    // 无行失败（如不支持格式）：也落一行失败记录——历史完整、任务状态一致、
    // 用户转换格式后可在列表中重试（复用同 retryKey 原地重跑）
    const newTaskId = await ensureTask();
    const { data: inserted, error } = await supabase
      .from("import_files")
      .insert({
        task_id: newTaskId, user_id: userId, file_name: file.name,
        mime: file.type || "application/octet-stream", size: file.size,
        kind: kind ?? "text", retry_key: retryKey, status: "failed", error: message,
      })
      .select("*").single();
    if (error || !inserted) {
      return {
        id: "rejected", taskId: newTaskId, ...base,
        status: "failed", error: message, readingItemId: null,
        pageCount: null, createdAt: new Date().toISOString(), retryKey,
      };
    }
    return toResult(inserted as ImportFileRow);
  };

  if (!kind) {
    return fail(`暂不支持「${file.name}」：可导入 TXT / Markdown / CSV / JSON / PDF / DOCX / XLSX、图片与音频；旧版 .doc/.xls 请转换为 .docx/.xlsx`);
  }

  // 建文件行（uploading）；既有行复用并复位为 uploading（重跑起点）
  let row: ImportFileRow;
  if (!existing) {
    const newTaskId = await ensureTask();
    const { data: inserted, error } = await supabase
      .from("import_files")
      .insert({
        task_id: newTaskId, user_id: userId, file_name: file.name,
        mime: file.type || "application/octet-stream", size: file.size,
        kind, retry_key: retryKey, status: "uploading",
      })
      .select("*").single();
    if (error || !inserted) {
      // 并发同键：090 unique(user_id, retry_key) 兜底——另一请求抢先建行，
      // 读出赢家行按幂等/重跑处理（递归至多一层：赢家行已存在，不再走建行分支）
      if ((error as { code?: string } | null)?.code === "23505") {
        const { data: winner } = await supabase
          .from("import_files").select("*")
          .eq("user_id", userId).eq("retry_key", retryKey)
          .maybeSingle();
        if (winner) return importOneFile(supabase, userId, ensureTask, file, retryKey);
      }
      return {
        id: "pending", taskId: newTaskId, ...base, kind,
        status: "failed", error: error?.message ?? "导入记录创建失败",
        readingItemId: null, pageCount: null, createdAt: new Date().toISOString(), retryKey,
      };
    }
    row = inserted as ImportFileRow;
  } else {
    const { data: reset } = await supabase.from("import_files")
      .update({ status: "uploading", error: null })
      .eq("id", rowId).eq("user_id", userId)
      .select("*").single();
    row = (reset ?? existing) as ImportFileRow;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // 原件 → 私有桶（敏感原件不随分享公开；090 桶策略限定本人目录）
  const ext = (file.name.split(".").pop() ?? "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "bin";
  const storagePath = `${userId}/${row.task_id}/${row.id}.${ext}`;
  // 旧路径与新路径不同（如备份恢复后原件落在 {uid}/{uuid}.ext）：先清旧对象，重试不留孤儿
  if (row.storage_path && row.storage_path !== storagePath) {
    await supabase.storage.from("import-files").remove([row.storage_path]);
  }
  const { error: uploadError } = await supabase.storage
    .from("import-files")
    .upload(storagePath, bytes, { contentType: file.type || "application/octet-stream", upsert: true });
  if (uploadError) {
    return fail(`原件上传失败：${uploadError.message}`);
  }
  await supabase.from("import_files")
    .update({ storage_path: storagePath, status: "parsing" })
    .eq("id", row.id).eq("user_id", userId);

  // 解析（image/audio 无正文步骤：直接 saved 为「原件已存档」）
  if (kind === "image" || kind === "audio") {
    await supabase.from("import_files")
      .update({ status: "saved", error: null })
      .eq("id", row.id).eq("user_id", userId);
    return toResult({ ...row, status: "saved", error: null });
  }

  try {
    const doc = await extractServerDocument(kind, { fileName: file.name, bytes });

    // DOCX 嵌入图片：纳入资产管理（同任务目录存档，路径记入 asset_paths 供
    // 备份打包与删除回收），正文注明
    let html = doc.html;
    if (doc.embeddedImages.length) {
      const imgParts: string[] = [];
      const assetPaths: string[] = [];
      for (let n = 0; n < doc.embeddedImages.length; n++) {
        const image = doc.embeddedImages[n];
        const imgExt = (image.mime.split("/")[1] ?? "png").replace(/[^a-zA-Z0-9]/g, "") || "png";
        const imgPath = `${userId}/${row.task_id}/${row.id}-img${n + 1}.${imgExt}`;
        const { error } = await supabase.storage.from("import-files")
          .upload(imgPath, image.bytes, { contentType: image.mime, upsert: true });
        if (!error) assetPaths.push(imgPath);
        imgParts.push(h.paragraph(error
          ? `${image.name}：存档失败（${error.message}）`
          : `${image.name}：已存档（导入记录中可下载）`));
      }
      // 图片说明每行 <50 字，不会在正文已通过输出预算的情况下越界
      html = html + imgParts.join("");
      await supabase.from("import_files")
        .update({ asset_paths: assetPaths })
        .eq("id", row.id).eq("user_id", userId);
    }

    const key = createHash("sha256").update(bytes).digest("hex");
    const collected = await collectImportItem(supabase, userId, {
      key, title: doc.title, html, excerpt: doc.excerpt,
    });
    if (collected.status === "error") {
      // 正文保存失败：原件仍在，行标失败可重试
      return fail(collected.message ?? "正文保存失败");
    }
    await supabase.from("import_files")
      .update({
        status: "saved", error: null,
        reading_item_id: collected.itemId, page_count: doc.pageCount ?? null,
      })
      .eq("id", row.id).eq("user_id", userId);
    return toResult({
      ...row,
      status: "saved", error: null,
      reading_item_id: collected.itemId, page_count: doc.pageCount ?? null,
    });
  } catch (error) {
    // 扫描型/加密/损坏/超限时：原件保留（storage_path 已落库），明示原因、可重试
    const message = isImportError(error)
      ? error.message
      : toImportError(error).message;
    return fail(message);
  }
}

// GET /api/imports — 导入历史（文件视图恢复用；分页游标，缺省/单页上限 50、limit ≤100）。
// 先做惰性中断回收：超阈值的进行中行标记 failed 并收口任务，列表与事实一致，
// 轮询中的客户端下一拍就能看到可重试的终态（lib/imports/stale.ts 的安全规则）。
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 100);
  let cursor;
  try {
    cursor = decodeImportHistoryCursor(request.nextUrl.searchParams.get("cursor"));
  } catch (error) {
    const message = error instanceof ImportHistoryCursorError ? error.message : "cursor 无效";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await recoverStaleImports(supabase, user.id);

  let query = supabase
    .from("import_files")
    .select("id, task_id, file_name, kind, size, status, error, reading_item_id, page_count, created_at, retry_key, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (cursor) {
    query = query.or(
      `and(created_at.eq.${cursor.created_at},id.lt.${cursor.id}),created_at.lt.${cursor.created_at}`,
    );
  }
  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const files = ((rows ?? []) as ImportFileRow[]).map(toResult);
  const last = files.length === limit ? files[files.length - 1] : null;
  const nextCursor = last
    ? encodeImportHistoryCursor({ created_at: last.createdAt, id: last.id })
    : null;
  return NextResponse.json({ files, nextCursor });
}
