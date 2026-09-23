import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAIConfig, redactSecret } from "@/lib/ai/server";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { isMockBackend } from "@/lib/env";
import { stripHtmlToText } from "@/lib/collections/digest-text";
import {
  assertDigestBudget,
  digestKey,
  generateDigestArticle,
  DIGEST_MAX_SOURCES,
  type DigestSourceInput,
} from "@/lib/collections/digest-server";
export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

interface Body {
  sourceType?: unknown;
  ids?: unknown;
  /** preview=true 只返回预算与来源清单（生成前预览），不调用 AI、不写库 */
  preview?: unknown;
}

/**
 * POST /api/collections/[id]/digest — 从集合选中的来源生成合并整理稿（阶段 4）。
 *
 * preview=true：只做预算/存在性校验，返回来源清单与字符数（前端预览步骤）。
 * 否则：生成 → 落 reading_item（URN urn:organize:digest:{key}）+ digest_sources 溯源。
 * 幂等：同来源集合同版本（内容 hash 相同）重复提交返回既有整理稿，不重复生成。
 * 长度预算超限 413 明确报错（不静默截断）；AI 未配置 400 明确提示，来源不受影响。
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });
  if (isMockBackend()) {
    return NextResponse.json({ error: "演示模式不调用真实 AI；整理稿生成需要连接后端并配置 AI 服务" }, { status: 501 });
  }

  let body: Body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }

  const sourceType = body.sourceType;
  if (sourceType !== "reading" && sourceType !== "memo" && sourceType !== "file") {
    return NextResponse.json({ error: "sourceType 无效（阶段 4 整理稿基于资料来源，文件经其正文）" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, DIGEST_MAX_SOURCES)
    : [];
  if (!ids.length) return NextResponse.json({ error: "请先勾选要整理的来源" }, { status: 400 });

  // 加载来源正文（RLS 限定本人；他人的 id 加载不到 → 明确报错）
  const sources: DigestSourceInput[] = [];
  for (const sourceId of ids) {
    if (sourceType === "reading") {
      const { data: row } = await supabase
        .from("reading_items").select("id, title, content, url")
        .eq("id", sourceId).maybeSingle();
      if (!row) return NextResponse.json({ error: "来源不存在或不可访问" }, { status: 400 });
      const text = stripHtmlToText(row.content ?? "");
      if (!text) return NextResponse.json({ error: `「${row.title || row.url}」没有可整理的正文` }, { status: 400 });
      sources.push({
        sourceType: "reading", sourceId, label: row.title || "未命名文章",
        text, contentHash: await sha256Hex(text),
      });
    } else if (sourceType === "memo") {
      const { data: row } = await supabase
        .from("memos").select("id, content")
        .eq("id", sourceId).maybeSingle();
      if (!row) return NextResponse.json({ error: "来源不存在或不可访问" }, { status: 400 });
      const text = String(row.content ?? "");
      if (!text.trim()) return NextResponse.json({ error: "选中的速记没有内容" }, { status: 400 });
      sources.push({
        sourceType: "memo", sourceId, label: text.split("\n")[0].slice(0, 40) || "速记",
        text, contentHash: await sha256Hex(text),
      });
    } else {
      // 导入文件：整理其提取正文（有 reading_item_id 时）或文件名占位说明
      const { data: row } = await supabase
        .from("import_files").select("id, file_name, reading_item_id")
        .eq("id", sourceId).maybeSingle();
      if (!row) return NextResponse.json({ error: "来源不存在或不可访问" }, { status: 400 });
      let text = "";
      let label = row.file_name;
      if (row.reading_item_id) {
        const { data: reading } = await supabase
          .from("reading_items").select("content")
          .eq("id", row.reading_item_id).maybeSingle();
        text = stripHtmlToText(reading?.content ?? "");
      }
      if (!text) text = `（该文件没有可提取的正文；文件名：${row.file_name}）`;
      sources.push({ sourceType: "file", sourceId, label, text, contentHash: await sha256Hex(text) });
    }
  }

  // 预算：明确拒绝，不静默截断
  let totalChars: number;
  try {
    totalChars = assertDigestBudget(sources);
  } catch (error) {
    const message = error instanceof Error ? error.message : "来源预算超限";
    const budget = error instanceof Error && error.name === "DigestBudgetError";
    return NextResponse.json({ error: message }, { status: budget ? 413 : 400 });
  }

  const key = await digestKey(sources);

  if (body.preview === true) {
    return NextResponse.json({
      preview: {
        key,
        totalChars,
        sources: sources.map((s) => ({
          sourceType: s.sourceType, sourceId: s.sourceId,
          label: s.label, chars: s.text.length,
        })),
      },
    });
  }

  // 幂等：同来源集合同版本已有整理稿 → 直接返回
  const { data: existing } = await supabase
    .from("reading_items").select("id, title")
    .eq("user_id", user.id).eq("url", `urn:organize:digest:${key}`)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ digestId: existing.id, title: existing.title, reused: true });
  }

  if (!await checkRateLimit(`ai:digest:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: "整理请求过于频繁，请一分钟后再试" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  let secret = "";
  let article;
  try {
    const config = await getAIConfig(supabase, user.id);
    secret = config.apiKey;
    article = await generateDigestArticle(config, { sources });
  } catch (error) {
    return NextResponse.json(
      { error: redactSecret(error instanceof Error ? error.message : "整理稿生成失败", secret) },
      { status: 502 },
    );
  }

  // 落库：整理稿是独立 reading_item（URN 稳定键）+ 溯源行；不改动任何来源
  const { data: inserted, error: insertError } = await supabase
    .from("reading_items")
    .insert({
      user_id: user.id,
      url: `urn:organize:digest:${key}`,
      title: article.title.slice(0, 200),
      content: article.content,
      excerpt: article.excerpt.slice(0, 500),
      cover_image: null,
      reading_status: "unread",
      reading_progress: 0,
    })
    .select("id, title")
    .single();
  if (insertError || !inserted) {
    return NextResponse.json(
      { error: insertError?.message ?? "整理稿保存失败（AI 已生成，可重试复用）" },
      { status: 500 },
    );
  }

  // 溯源：来源与版本指纹（sha256）；失败不影响整理稿本体（重新生成幂等复用）
  const provenanceRows = sources.map((s) => ({
    digest_id: inserted.id,
    user_id: user.id,
    source_type: s.sourceType,
    source_id: s.sourceId,
    content_hash: s.contentHash,
  }));
  await supabase.from("digest_sources").upsert(provenanceRows, {
    onConflict: "digest_id,source_type,source_id",
    ignoreDuplicates: true,
  });

  return NextResponse.json({ digestId: inserted.id, title: inserted.title, reused: false });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
