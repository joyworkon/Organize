import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { generateToken } from "@/lib/share/token";
import type { ShareResourceType } from "@organize/shared";

// POST /api/share - 创建分享
// body: { resource_type: "note" | "reading_item", resource_id: string,
//         expires_at?: string, access_mode?: "public_read" | "public_edit" }
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
  // 072：三态公开链接。创建时只接受两种公开态（disabled = 不创建），
  // 改模式走 PATCH。
  const accessMode =
    body?.access_mode === "public_edit" ? "public_edit" : "public_read";

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
    .select("id, token, is_public, expires_at, access_mode, created_at")
    .eq("owner_id", user.id)
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .maybeSingle();

  if (existing) {
    // 复用同一 (owner, resource) 的分享行；请求显式带了合法 access_mode 且与现存
    // 不同时，以请求为准对齐（否则 POST public_edit 会拿回 disabled/只读旧行）
    if (
      (body?.access_mode === "public_read" || body?.access_mode === "public_edit") &&
      existing.access_mode !== accessMode
    ) {
      const { data: updated, error: patchErr } = await supabase
        .from("shares")
        // accessMode 归一化后只会是 public_read/public_edit，is_public 必为 true
        .update({ access_mode: accessMode, is_public: true })
        .eq("id", existing.id)
        .eq("owner_id", user.id)
        .select("id, token, is_public, expires_at, access_mode, created_at")
        .single();
      if (patchErr) return serverError(patchErr);
      return NextResponse.json({ ...updated, url: `/s/${updated.token}` });
    }
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
      access_mode: accessMode,
    })
    .select("id, token, is_public, expires_at, access_mode, created_at")
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
    .select("id, token, is_public, expires_at, access_mode, created_at")
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

// PATCH /api/share - 更新分享模式/过期时间（072 可编辑公开链接）
// body: { token } 或 { resource_type, resource_id }，加 access_mode 和/或 expires_at
// access_mode 与 is_public 成对写入，维持 072 的一致性约束（disabled ↔ not is_public）
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const token: string | undefined = body?.token;
  const resourceType = body?.resource_type as ShareResourceType | undefined;
  const resourceId: string | undefined = body?.resource_id;

  if (!token && !(resourceId && (resourceType === "note" || resourceType === "reading_item"))) {
    return NextResponse.json(
      { error: "需要提供 token 或 (resource_type + resource_id)" },
      { status: 400 }
    );
  }
  if (
    body?.access_mode !== undefined &&
    body.access_mode !== "disabled" &&
    body.access_mode !== "public_read" &&
    body.access_mode !== "public_edit"
  ) {
    return NextResponse.json({ error: "access_mode 非法" }, { status: 400 });
  }
  if (
    body?.expires_at !== undefined &&
    body.expires_at !== null &&
    (typeof body.expires_at !== "string" || Number.isNaN(Date.parse(body.expires_at)))
  ) {
    return NextResponse.json({ error: "expires_at 非法" }, { status: 400 });
  }
  if (body?.access_mode === undefined && body?.expires_at === undefined) {
    return NextResponse.json({ error: "缺少要更新的字段" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.access_mode !== undefined) {
    updates.access_mode = body.access_mode;
    // 一致性约束（072）：disabled 必须同时关掉 is_public，公开态必须 is_public=true
    updates.is_public = body.access_mode !== "disabled";
  }
  if (body.expires_at !== undefined) {
    updates.expires_at = body.expires_at;
  }

  let query = supabase.from("shares").update(updates).eq("owner_id", user.id);
  query = token
    ? query.eq("token", token)
    : query.eq("resource_type", resourceType).eq("resource_id", resourceId);

  const { data, error } = await query
    .select("id, token, is_public, expires_at, access_mode, resource_type, resource_id")
    .maybeSingle();
  if (error) return serverError(error);
  if (!data) return NextResponse.json({ error: "分享不存在或无权修改" }, { status: 404 });

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

  const { data, error } = await query.select("access_mode");
  if (error) return serverError(error);

  return NextResponse.json({ success: true, access_mode: data?.[0]?.access_mode ?? null });
}
