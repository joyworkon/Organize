import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { parseJsonBody, validateCreateBody } from "@/lib/synced-block/api-mutation";

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
    return serverError(error);
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

  // 非法 JSON / content 非数组 / id 非法 → 400，绝不静默创建空区块
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.rejection.error }, { status: parsed.rejection.status });
  }
  const input = validateCreateBody(parsed.body);
  if (!input.ok) {
    return NextResponse.json({ error: input.rejection.error }, { status: input.rejection.status });
  }

  // 允许指定 id（便于与编辑器内 syncedId 对齐），不指定则自动生成
  const { data, error } = await supabase
    .from("synced_blocks")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      user_id: user.id,
      content: input.content,
    })
    .select("id, content, revision, created_at, updated_at")
    .single();

  if (error) {
    // serverError：23505 主键冲突 → 409「数据已存在」；其它 → 500 通用文案（不泄露细节）
    return serverError(error);
  }
  return NextResponse.json(data as SyncedBlockRow, { status: 201 });
}
