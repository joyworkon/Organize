import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chatCompletion, getAIConfig } from "@/lib/ai/server";
import { parseJsonFromModel, sanitizeAiProposals } from "@/lib/notes/auto-group";

// POST /api/notes/auto-group — 用 AI 按主题给笔记提分组建议（只返回建议，不落库）。
// 请求体：{ notes: [{ id, title, text }] }（客户端已截断正文）；
// 返回：{ groups: GroupProposal[], source: "ai" }。AI 未配置 → 409 { code: "AI_UNAVAILABLE" }，
// 客户端据此改用本地关键词分组。笔记 id 先按 RLS 校验归属，模型只能在这些 id 里分配。
const MAX_NOTES = 200;
const TEXT_PER_NOTE = 160;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const input = Array.isArray(body?.notes) ? (body.notes as Array<Record<string, unknown>>) : [];
  const notes = input
    .filter((n) => typeof n?.id === "string")
    .slice(0, MAX_NOTES)
    .map((n) => ({
      id: String(n.id),
      title: String(n.title || "").slice(0, 80),
      text: String(n.text || "").replace(/\s+/g, " ").slice(0, TEXT_PER_NOTE),
    }));
  if (notes.length < 2) return NextResponse.json({ groups: [], source: "ai" });

  const { data: owned, error } = await supabase
    .from("notes")
    .select("id")
    .eq("user_id", user.id)
    .in(
      "id",
      notes.map((n) => n.id)
    );
  if (error) return NextResponse.json({ error: "读取笔记失败" }, { status: 500 });
  const knownIds = new Set((owned || []).map((row: { id: string }) => row.id));

  let config;
  try {
    config = await getAIConfig(supabase, user.id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI 服务未配置", code: "AI_UNAVAILABLE" },
      { status: 409 }
    );
  }

  const system =
    "你是笔记整理助手。根据笔记标题和开头内容，按主题把笔记分成 2-8 个组。" +
    "组名用简短的中文名词短语（2-8 个字）。每篇笔记最多进一个组；主题不明确的笔记不要硬分。" +
    '只输出 JSON：{"groups":[{"name":"组名","noteIds":["id1","id2"]}]}，不要任何解释。';
  const userPrompt = notes
    .filter((n) => knownIds.has(n.id))
    .map((n) => `- id: ${n.id}\n  标题: ${n.title || "（无标题）"}\n  内容: ${n.text || "（空）"}`)
    .join("\n");

  try {
    const output = await chatCompletion(config, system, userPrompt);
    const groups = sanitizeAiProposals(parseJsonFromModel(output), knownIds);
    return NextResponse.json({ groups, source: "ai" });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "AI 分组失败" }, { status: 502 });
  }
}
