import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { getAIConfig } from "@/lib/ai/server";
import { createAITagGenerator, keywordTagGenerator, type TagSuggestion } from "@/lib/ai/tag-generator";
import type { TaggableResource } from "@organize/shared";

// POST /api/ai/tags/suggest
// body: { resource_type: "note" | "reading_item", resource_id: string, max_tags?: number }
// 返回：TagSuggestion[]
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const resourceType = body?.resource_type as TaggableResource;
  const resourceId: string | undefined = body?.resource_id;
  const maxTags: number = Number(body?.max_tags) || 5;

  if (!resourceId) {
    return NextResponse.json({ error: "缺少 resource_id" }, { status: 400 });
  }
  if (resourceType !== "note" && resourceType !== "reading_item") {
    return NextResponse.json({ error: "resource_type 非法" }, { status: 400 });
  }

  // 拉资源内容（拆开查询避免 supabase 类型推断失败）
  let title = "";
  let rawText = "";
  if (resourceType === "note") {
    const { data: note, error } = await supabase
      .from("notes")
      .select("id, title, content")
      .eq("id", resourceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return serverError(error);
    if (!note) return NextResponse.json({ error: "资源不存在" }, { status: 404 });
    title = note.title || "无标题笔记";
    rawText = extractTextFromTiptap(note.content);
  } else {
    const { data: item, error } = await supabase
      .from("reading_items")
      .select("id, title, content, excerpt")
      .eq("id", resourceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return serverError(error);
    if (!item) return NextResponse.json({ error: "资源不存在" }, { status: 404 });
    title = item.title || "";
    rawText = `${item.excerpt || ""}\n${item.content || ""}`;
  }

  // 拉用户已有的标签（让生成器优先复用）
  const { data: existingTags } = await supabase
    .from("tags")
    .select("name")
    .eq("user_id", user.id);
  const existingNames = (existingTags || []).map((t) => t.name);

  // 调生成器：配置了 AI（设置页或环境变量）就优先用 AI，失败时退化到关键词
  const input = { resourceType, title, text: rawText, existingTagNames: existingNames, maxTags };
  let suggestions: TagSuggestion[];
  try {
    const config = await getAIConfig(supabase, user.id);
    suggestions = await createAITagGenerator(config).generate(input);
  } catch (e) {
    // 未配置 AI 或 AI 调用失败时静默退化到关键词
    console.warn("[ai/tags/suggest] AI 不可用，退化到关键词:", e);
    suggestions = await keywordTagGenerator.generate(input);
  }

  return NextResponse.json({
    suggestions,
    generator: suggestions[0]?.source || "keyword",
  });
}

/**
 * 从 TipTap JSON 递归提取所有 text 节点的文字
 */
function extractTextFromTiptap(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const parts: string[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (typeof node.text === "string") parts.push(node.text);
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  };
  walk(json);
  return parts.join(" ");
}
