import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { validateCollectionName, type CollectionSummary } from "@/lib/collections/types";

// GET /api/collections — 集合列表（含计数，created_at DESC）。
// POST /api/collections — 新建集合 { name }。
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const { data: rows, error } = await supabase
    .from("collections")
    .select("id, name, created_at, updated_at, collection_items(count)")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);
  if (error) return serverError(error);

  const collections: CollectionSummary[] = (rows ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    name: String(row.name),
    itemCount: Number(
      Array.isArray(row.collection_items)
        ? (row.collection_items as Array<{ count?: number }>)[0]?.count ?? 0
      : 0,
    ),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
  return NextResponse.json({ collections });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  let body: { name?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }

  const nameError = validateCollectionName(body.name);
  if (nameError) return NextResponse.json({ error: nameError }, { status: 400 });

  const { data: row, error } = await supabase
    .from("collections")
    .insert({ name: String(body.name).trim() })
    .select("id, name, created_at, updated_at")
    .single();
  if (error || !row) return serverError(error ?? new Error("创建失败"));

  return NextResponse.json({
    collection: {
      id: row.id, name: row.name,
      itemCount: 0, createdAt: row.created_at, updatedAt: row.updated_at,
    } satisfies CollectionSummary,
  });
}
