import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";

// GET /api/memos/tags - F04：标签计数服务端聚合（基于用户全部未删速记，
// 不依赖首页截断的 500 条）。返回 [{ tag, count }] 按数量降序。
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  // 全量拉取 tags 数组列（轻量：仅文本数组，无正文），应用层聚合
  const { data, error } = await supabase
    .from("memos")
    .select("tags")
    .eq("user_id", user.id)
    .is("deleted_at", null);
  if (error) return serverError(error);

  const counts = new Map<string, number>();
  for (const row of data || []) {
    for (const tag of ((row as { tags?: string[] }).tags || [])) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  const result = Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  return NextResponse.json(result);
}
