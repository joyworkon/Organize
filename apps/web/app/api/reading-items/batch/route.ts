import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ReadingStatus } from "@organize/shared";

// PATCH /api/reading-items/batch
// body: { ids: string[], action: "status" | "delete", reading_status?: ReadingStatus, tag_id?: string }
// - action="status"  : 批量修改阅读状态（需 reading_status）
// - action="delete"  : 批量删除
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
  const action: string = body?.action;

  if (ids.length === 0) {
    return NextResponse.json({ error: "ids 不能为空" }, { status: 400 });
  }
  // 防止超大批量：单次最多 200 条
  if (ids.length > 200) {
    return NextResponse.json({ error: "单次最多操作 200 条" }, { status: 400 });
  }

  if (action === "delete") {
    const { error } = await supabase
      .from("reading_items")
      .delete()
      .in("id", ids)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, affected: ids.length });
  }

  if (action === "status") {
    const readingStatus = body?.reading_status as ReadingStatus;
    const validStatuses: ReadingStatus[] = ["unread", "reading", "read"];
    if (!validStatuses.includes(readingStatus)) {
      return NextResponse.json({ error: "reading_status 非法" }, { status: 400 });
    }
    const { error } = await supabase
      .from("reading_items")
      .update({ reading_status: readingStatus })
      .in("id", ids)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, affected: ids.length });
  }

  return NextResponse.json({ error: "未知的 action" }, { status: 400 });
}

// POST /api/reading-items/batch
// body: { ids: string[], tag_id: string } - 批量给多个 reading_item 打同一个标签
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
  const tagId: string = body?.tag_id;

  if (ids.length === 0) {
    return NextResponse.json({ error: "ids 不能为空" }, { status: 400 });
  }
  if (!tagId) {
    return NextResponse.json({ error: "tag_id 不能为空" }, { status: 400 });
  }
  if (ids.length > 200) {
    return NextResponse.json({ error: "单次最多操作 200 条" }, { status: 400 });
  }

  // 校验 tag 归属当前用户
  const { data: tag, error: tagErr } = await supabase
    .from("tags")
    .select("id")
    .eq("id", tagId)
    .eq("user_id", user.id)
    .single();
  if (tagErr || !tag) {
    return NextResponse.json({ error: "标签不存在或无权访问" }, { status: 404 });
  }

  // 批量插入 item_tags，忽略重复（onConflict do nothing）
  const rows = ids.map((itemId) => ({ item_id: itemId, tag_id: tagId }));
  const { error } = await supabase
    .from("item_tags")
    .upsert(rows, { onConflict: "item_id,tag_id", ignoreDuplicates: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, affected: ids.length });
}
