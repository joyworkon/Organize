import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { generateToken } from "@/lib/share/token";
import type { ShareResourceType } from "@organize/shared";

// POST /api/share - 创建分享
// body: { resource_type: "note" | "reading_item", resource_id: string, expires_at?: string }
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const resourceType = body?.resource_type as ShareResourceType;
  const resourceId: string | undefined = body?.resource_id;
  const expiresAt: string | null = body?.expires_at ?? null;

  if (!resourceId) {
    return NextResponse.json({ error: "缺少 resource_id" }, { status: 400 });
  }
  if (resourceType !== "note" && resourceType !== "reading_item") {
    return NextResponse.json({ error: "resource_type 非法" }, { status: 400 });
  }

  // 校验资源归属当前用户
  const table = resourceType === "note" ? "notes" : "reading_items";
  const { data: resource, error: resourceErr } = await supabase
    .from(table)
    .select("id, user_id")
    .eq("id", resourceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (resourceErr || !resource) {
    return NextResponse.json({ error: "资源不存在或无权分享" }, { status: 404 });
  }

  // 已存在该资源的公开分享则复用（避免生成一堆 token）
  const { data: existing } = await supabase
    .from("shares")
    .select("id, token, is_public, expires_at, created_at")
    .eq("owner_id", user.id)
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ...existing,
      url: `/s/${existing.token}`,
    });
  }

  const token = generateToken();
  const { data, error } = await supabase
    .from("shares")
    .insert({
      owner_id: user.id,
      resource_type: resourceType,
      resource_id: resourceId,
      token,
      is_public: true,
      expires_at: expiresAt,
    })
    .select("id, token, is_public, expires_at, created_at")
    .single();

  if (error) {
    return serverError(error);
  }

  return NextResponse.json({ ...data, url: `/s/${data.token}` }, { status: 201 });
}

// GET /api/share?resource_type=note&resource_id=xxx - 查询某资源的分享状态
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const resourceType = searchParams.get("resource_type") as ShareResourceType;
  const resourceId = searchParams.get("resource_id");

  if (!resourceId || (resourceType !== "note" && resourceType !== "reading_item")) {
    return NextResponse.json({ error: "参数非法" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("shares")
    .select("id, token, is_public, expires_at, created_at")
    .eq("owner_id", user.id)
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .maybeSingle();

  if (error) {
    return serverError(error);
  }

  if (!data) return NextResponse.json(null);
  return NextResponse.json({ ...data, url: `/s/${data.token}` });
}

// DELETE /api/share - 撤销分享
// body: { resource_type, resource_id } 或 { token }
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const resourceType = body?.resource_type as ShareResourceType | undefined;
  const resourceId: string | undefined = body?.resource_id;
  const token: string | undefined = body?.token;

  let query = supabase.from("shares").delete().eq("owner_id", user.id);

  if (token) {
    query = query.eq("token", token);
  } else if (resourceId && (resourceType === "note" || resourceType === "reading_item")) {
    query = query.eq("resource_type", resourceType).eq("resource_id", resourceId);
  } else {
    return NextResponse.json({ error: "需要提供 token 或 (resource_type + resource_id)" }, { status: 400 });
  }

  const { error } = await query;
  if (error) return serverError(error);

  return NextResponse.json({ success: true });
}
