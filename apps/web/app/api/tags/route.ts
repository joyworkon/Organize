import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";

// GET /api/tags - 列出当前用户的所有标签（带使用计数）
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  // 一次性查出标签 + 两个关联表的使用计数
  const { data: tags, error: tagsError } = await supabase
    .from("tags")
    .select("id, name, created_at")
    .eq("user_id", user.id)
    .order("name", { ascending: true });

  if (tagsError) {
    return NextResponse.json({ error: tagsError.message }, { status: 500 });
  }

  const [itemTagsRes, noteTagsRes, taskTagsRes, lessonTagsRes] = await Promise.all([
    supabase.from("item_tags").select("tag_id"),
    supabase.from("note_tags").select("tag_id"),
    supabase.from("task_tags").select("tag_id"),
    supabase.from("lesson_tags").select("tag_id"),
  ]);

  const countMap = new Map<string, { note_count: number; reading_item_count: number; task_count: number; lesson_count: number }>();
  for (const row of itemTagsRes.data || []) {
    const entry = countMap.get(row.tag_id) || { note_count: 0, reading_item_count: 0, task_count: 0, lesson_count: 0 };
    entry.reading_item_count += 1;
    countMap.set(row.tag_id, entry);
  }
  for (const row of noteTagsRes.data || []) {
    const entry = countMap.get(row.tag_id) || { note_count: 0, reading_item_count: 0, task_count: 0, lesson_count: 0 };
    entry.note_count += 1;
    countMap.set(row.tag_id, entry);
  }
  for (const row of taskTagsRes.data || []) {
    const entry = countMap.get(row.tag_id) || { note_count: 0, reading_item_count: 0, task_count: 0, lesson_count: 0 };
    entry.task_count += 1;
    countMap.set(row.tag_id, entry);
  }
  for (const row of lessonTagsRes.data || []) {
    const entry = countMap.get(row.tag_id) || { note_count: 0, reading_item_count: 0, task_count: 0, lesson_count: 0 };
    entry.lesson_count += 1;
    countMap.set(row.tag_id, entry);
  }

  const result = (tags || []).map((t) => ({
    id: t.id,
    user_id: user.id,
    name: t.name,
    ...(countMap.get(t.id) || { note_count: 0, reading_item_count: 0, task_count: 0, lesson_count: 0 }),
  }));

  return NextResponse.json(result);
}

// POST /api/tags - 创建标签（同 user 下 name 唯一，冲突时返回已有）
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const name: string = (body?.name ?? "").toString().trim();

  if (!name) {
    return NextResponse.json({ error: "标签名不能为空" }, { status: 400 });
  }
  if (name.length > 32) {
    return NextResponse.json({ error: "标签名最长 32 字符" }, { status: 400 });
  }

  // upsert：同用户同名标签已存在则直接返回那条（unique(user_id, name)）
  const { data, error } = await supabase
    .from("tags")
    .upsert({ user_id: user.id, name }, { onConflict: "user_id,name" })
    .select("id, name")
    .single();

  if (error) {
    return serverError(error);
  }

  return NextResponse.json(data, { status: 201 });
}
