import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateImportBatch } from "@/lib/imports/budgets";
import { isImportError, toImportError } from "@/lib/imports/errors";
import { extractServerDocument } from "@/lib/imports/extract-server";
import { importKind } from "@/lib/imports/kinds";
import { h } from "@/lib/imports/html";
import type { ImportFileResult, ImportKind } from "@/lib/imports/types";
import { collectImportItem } from "@/lib/reading/collect-server";

/**
 * POST /api/imports — 批量文件导入（阶段 D）。
 *
 * multipart/form-data：files（多文件）+ retryKeys（与 files 一一对应的稳定请求标识）。
 * 执行机制（任务书 §八）：解析在请求内同步完成（预算保证有界），状态逐文件落库，
 * 刷新后 GET /api/imports 恢复；重试复用同一 retryKey，唯一约束幂等，不重复建资料。
 * 每个文件独立成败：单文件失败不影响同批其它文件（部分成功）。
 *
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

  // 任务行（一批一行）；整批失败也保留任务行（failed），刷新后可见
  const { data: task, error: taskError } = await supabase
    .from("import_tasks").insert({ user_id: user.id, status: "processing" })
    .select("id").single();
  if (taskError || !task) {
    return NextResponse.json({ error: taskError?.message ?? "导入任务创建失败" }, { status: 500 });
  }

  const results: ImportFileResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const retryKey = retryKeys[i] ?? `${task.id}:${i}`;
    results.push(await importOneFile(supabase, user.id, task.id, file, retryKey));
  }

  const done = results.filter((r) => r.status !== "pending" && r.status !== "uploading" && r.status !== "parsing");
  const saved = done.filter((r) => r.status === "saved").length;
  const failed = done.filter((r) => r.status === "failed").length;
  const taskStatus = failed === 0 ? "saved" : saved === 0 ? "failed" : "partial";
  await supabase.from("import_tasks").update({ status: taskStatus }).eq("id", task.id);

  return NextResponse.json({ task: { id: task.id, status: taskStatus }, files: results });
}

/** 单文件导入：幂等（retry_key 唯一）→ 原件入私有桶 → 解析 → 统一收集入口。 */
async function importOneFile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  taskId: string,
  file: File,
  retryKey: string,
): Promise<ImportFileResult> {
  const base = {
    fileName: file.name, size: file.size, kind: (importKind(file) ?? "text") as ImportKind,
    pageCount: null as number | null,
  };

  // 幂等：同用户同 retryKey 已有记录 → 直接返回（重试/双击/网络重发不重复导入）
  const { data: existing } = await supabase
    .from("import_files").select("*")
    .eq("user_id", userId).eq("retry_key", retryKey)
    .maybeSingle();
  if (existing && existing.status !== "failed") {
    return {
      id: existing.id, taskId: existing.task_id, fileName: existing.file_name,
      kind: existing.kind as ImportKind, size: Number(existing.size),
      status: existing.status as ImportFileResult["status"],
      error: existing.error, readingItemId: existing.reading_item_id,
      pageCount: existing.page_count, createdAt: existing.created_at,
    };
  }
  // failed 记录 → 原地重跑（复用同一行，不产生第二行）
  const rowId = existing?.id ?? null;

  const kind = importKind(file);
  const fail = async (message: string, codeRowId?: string | null): Promise<ImportFileResult> => {
    const id = codeRowId ?? rowId;
    if (id) {
      await supabase.from("import_files")
        .update({ status: "failed", error: message })
        .eq("id", id).eq("user_id", userId);
    }
    return {
      id: id ?? "pending", taskId, ...base, kind: (kind ?? "text") as ImportKind,
      status: "failed", error: message, readingItemId: null,
      pageCount: null, createdAt: new Date().toISOString(),
    };
  };

  if (!kind) {
    // 格式不支持：不保存原件，明示原因
    if (existing) return fail(`暂不支持「${file.name}」：可导入 TXT / Markdown / CSV / JSON / PDF / DOCX / XLSX、图片与音频；旧版 .doc/.xls 请转换为 .docx/.xlsx`, existing.id);
    return {
      id: "rejected", taskId, ...base,
      status: "failed",
      error: `暂不支持「${file.name}」：可导入 TXT / Markdown / CSV / JSON / PDF / DOCX / XLSX、图片与音频；旧版 .doc/.xls 请转换为 .docx/.xlsx`,
      readingItemId: null, pageCount: null, createdAt: new Date().toISOString(),
    };
  }

  // 建文件行（uploading）
  let row = existing;
  if (!row) {
    const { data: inserted, error } = await supabase
      .from("import_files")
      .insert({
        task_id: taskId, user_id: userId, file_name: file.name,
        mime: file.type || "application/octet-stream", size: file.size,
        kind, retry_key: retryKey, status: "uploading",
      })
      .select("*").single();
    if (error || !inserted) {
      return {
        id: "pending", taskId, ...base, kind,
        status: "failed", error: error?.message ?? "导入记录创建失败",
        readingItemId: null, pageCount: null, createdAt: new Date().toISOString(),
      };
    }
    row = inserted;
  } else {
    await supabase.from("import_files").update({ status: "uploading", error: null })
      .eq("id", row.id).eq("user_id", userId);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // 原件 → 私有桶（敏感原件不随分享公开；090 桶策略限定本人目录）
  const ext = (file.name.split(".").pop() ?? "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "bin";
  const storagePath = `${userId}/${taskId}/${row.id}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("import-files")
    .upload(storagePath, bytes, { contentType: file.type || "application/octet-stream", upsert: true });
  if (uploadError) {
    return fail(`原件上传失败：${uploadError.message}`, row.id);
  }
  await supabase.from("import_files")
    .update({ storage_path: storagePath, status: "parsing" })
    .eq("id", row.id).eq("user_id", userId);

  // 解析（image/audio 无正文步骤：直接 saved 为「原件已存档」）
  if (kind === "image" || kind === "audio") {
    await supabase.from("import_files")
      .update({ status: "saved", error: null })
      .eq("id", row.id).eq("user_id", userId);
    return {
      id: row.id, taskId, ...base, kind, status: "saved", error: null,
      readingItemId: null, pageCount: null, createdAt: row.created_at,
    };
  }

  try {
    const doc = await extractServerDocument(kind, { fileName: file.name, bytes });

    // DOCX 嵌入图片：纳入资产管理（同任务目录存档，正文注明）
    let html = doc.html;
    if (doc.embeddedImages.length) {
      const imgParts: string[] = [];
      for (let n = 0; n < doc.embeddedImages.length; n++) {
        const image = doc.embeddedImages[n];
        const imgExt = (image.mime.split("/")[1] ?? "png").replace(/[^a-zA-Z0-9]/g, "") || "png";
        const imgPath = `${userId}/${taskId}/${row.id}-img${n + 1}.${imgExt}`;
        const { error } = await supabase.storage.from("import-files")
          .upload(imgPath, image.bytes, { contentType: image.mime, upsert: true });
        imgParts.push(h.paragraph(error
          ? `${image.name}：存档失败（${error.message}）`
          : `${image.name}：已存档（导入记录中可下载）`));
      }
      // 图片说明每行 <50 字，不会在正文已通过输出预算的情况下越界
      html = html + imgParts.join("");
    }

    const key = createHash("sha256").update(bytes).digest("hex");
    const collected = await collectImportItem(supabase, userId, {
      key, title: doc.title, html, excerpt: doc.excerpt,
    });
    if (collected.status === "error") {
      // 正文保存失败：原件仍在，行标失败可重试
      return fail(collected.message ?? "正文保存失败", row.id);
    }
    await supabase.from("import_files")
      .update({
        status: "saved", error: null,
        reading_item_id: collected.itemId, page_count: doc.pageCount ?? null,
      })
      .eq("id", row.id).eq("user_id", userId);
    return {
      id: row.id, taskId, ...base, kind,
      status: "saved", error: null, readingItemId: collected.itemId,
      pageCount: doc.pageCount ?? null, createdAt: row.created_at,
    };
  } catch (error) {
    // 扫描型/加密/损坏/超限时：原件保留（storage_path 已落库），明示原因、可重试
    const message = isImportError(error)
      ? error.message
      : toImportError(error).message;
    return fail(message, row.id);
  }
}

// GET /api/imports — 最近导入记录（文件视图恢复用；分页 limit ≤100，缺省 50）
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 100);
  const { data: rows, error } = await supabase
    .from("import_files")
    .select("id, task_id, file_name, kind, size, status, error, reading_item_id, page_count, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const files: ImportFileResult[] = (rows ?? []).map((row) => ({
    id: row.id, taskId: row.task_id, fileName: row.file_name,
    kind: row.kind as ImportKind, size: Number(row.size),
    status: row.status as ImportFileResult["status"],
    error: row.error, readingItemId: row.reading_item_id,
    pageCount: row.page_count, createdAt: row.created_at,
  }));
  return NextResponse.json({ files });
}
