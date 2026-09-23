import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import {
  isCollectionSourceType,
  type CollectionItemView,
} from "@/lib/collections/types";

// GET /api/collections/[id]/items — 集合条目（092 collection_items_query RPC，实时 join 来源）。
//   limit（1–200 缺省 50）、cursor（imp1 同款二元组格式但独立前缀 col1.）、q（标题过滤）。
// POST /api/collections/[id]/items — 加入 { sourceType, ids: string[] }（幂等，重复加入跳过）。
// DELETE /api/collections/[id]/items?sourceType=&id= — 移出。
type Params = { params: Promise<{ id: string }> };

import {
  decodeCollectionCursor,
  encodeCollectionCursor,
  CollectionCursorError,
} from "@/lib/collections/cursor";

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const limitParam = Number(sp.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam >= 1 ? Math.min(limitParam, 200) : 50;
  const q = (sp.get("q") ?? "").trim().slice(0, 200) || null;
  let cursor: { created_at: string; id: string } | null = null;
  try {
    cursor = decodeCollectionCursor(sp.get("cursor"));
  } catch (error) {
    if (error instanceof CollectionCursorError) {
      return NextResponse.json({ error: `cursor 无效：${error.message}` }, { status: 400 });
    }
    throw error;
  }

  const { data, error } = await supabase.rpc("collection_items_query", {
    p_collection_id: id,
    p_limit: limit,
    p_cursor_created: cursor?.created_at ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_q: q,
  });
  if (error) return serverError(error);

  const items: CollectionItemView[] = (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    sourceType: row.source_type as CollectionItemView["sourceType"],
    sourceId: String(row.source_id),
    title: (row.title as string | null) ?? null,
    excerpt: (row.excerpt as string | null) ?? null,
    available: row.available === true,
    readingItemId: (row.reading_item_id as string | null) ?? null,
    fileName: (row.file_name as string | null) ?? null,
    createdAt: String(row.created_at),
  }));
  const last = items.length === limit ? items[items.length - 1] : null;
  return NextResponse.json({
    items,
    nextCursor: last ? encodeCollectionCursor({ created_at: last.createdAt, id: last.id }) : null,
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  let body: { sourceType?: unknown; ids?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }

  if (!isCollectionSourceType(body.sourceType)) {
    return NextResponse.json({ error: "sourceType 无效" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, 100)
    : [];
  if (!ids.length) return NextResponse.json({ error: "ids 不能为空" }, { status: 400 });

  // 集合必须属于当前用户（RLS 双保险）；先验证存在
  const { data: collection } = await supabase
    .from("collections").select("id").eq("id", id).maybeSingle();
  if (!collection) return NextResponse.json({ error: "集合不存在" }, { status: 404 });

  const column =
    body.sourceType === "reading" ? "reading_item_id"
    : body.sourceType === "memo" ? "memo_id"
    : "import_file_id";

  const rows = ids.map((sourceId) => ({
    collection_id: id,
    user_id: user.id,
    [column]: sourceId,
  }));
  // 幂等：092 部分唯一索引 (collection_id, 来源id) 兜底，重复加入 ignore，返回实际新增数
  const { data: inserted, error } = await supabase
    .from("collection_items")
    .upsert(rows, { onConflict: `collection_id,${column}`, ignoreDuplicates: true })
    .select("id");
  if (error) {
    const message = error.code === "23503" ? "来源不存在或不可访问" : error.message;
    return NextResponse.json({ error: message }, { status: error.code === "23503" ? 400 : 500 });
  }
  return NextResponse.json({ added: inserted?.length ?? 0 });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const itemId = sp.get("itemId");
  if (!itemId) return NextResponse.json({ error: "缺少 itemId" }, { status: 400 });

  const { error } = await supabase
    .from("collection_items")
    .delete()
    .eq("id", itemId).eq("collection_id", id).eq("user_id", user.id);
  if (error) return serverError(error);
  return NextResponse.json({ success: true });
}
