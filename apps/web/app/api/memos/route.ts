import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { parseMemoTags } from "@/lib/memos/tags";

// GET /api/memos - 列出速记（软删除外，时间倒序，可选 ?tag= 筛选、?limit= 截断）
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const tag = params.get("tag");
  // 刘海面板等轻量调用方只取最近几条；1–500 内取整，非法值回落全量上限
  const limitParam = Number(params.get("limit"));
  const limit =
    Number.isInteger(limitParam) && limitParam >= 1 ? Math.min(limitParam, 500) : 500;
  let query = supabase
    .from("memos")
    .select("*")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (tag) query = query.contains("tags", [tag]);

  const { data, error } = await query;
  if (error) return serverError(error);
  return NextResponse.json(data);
}

// POST /api/memos - 新建速记（body: { content }，#标签 由服务端解析）
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const body = await request.json();
  const content = String(body?.content || "").trim();
  if (!content || content.length > 5000) {
    return NextResponse.json({ error: "内容无效（1-5000 字）" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("memos")
    .insert({ user_id: user.id, content, tags: parseMemoTags(content) })
    .select()
    .single();
  if (error) return serverError(error);
  return NextResponse.json(data, { status: 201 });
}
