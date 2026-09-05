import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface SyncedBlockRow {
  id: string;
  content: unknown;
  revision?: number;
  created_at?: string;
  updated_at?: string;
}

// GET /api/synced-blocks — 列出当前用户的同步区块（可选 ids 批量查询）
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const idsParam = searchParams.get("ids");
  let query = supabase
    .from("synced_blocks")
    .select("id, content, revision, created_at, updated_at")
    .eq("user_id", user.id);

  if (idsParam) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length) return NextResponse.json([]);
    query = query.in("id", ids);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data as SyncedBlockRow[]);
}

// POST /api/synced-blocks — 创建一个同步区块
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const content = Array.isArray(body.content) ? body.content : [];
  // 允许指定 id（便于与编辑器内 syncedId 对齐），不指定则自动生成
  const id = typeof body.id === "string" && body.id.length ? body.id : undefined;

  const { data, error } = await supabase
    .from("synced_blocks")
    .insert({
      ...(id ? { id } : {}),
      user_id: user.id,
      content,
    })
    .select("id, content, revision, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data as SyncedBlockRow, { status: 201 });
}
