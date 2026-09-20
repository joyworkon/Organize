import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { validateCanvasContent } from "@/lib/canvas/validation";
import type { CanvasDoc } from "@/lib/canvas/model";

/**
 * GET    /api/canvases/[id] — 读取单个画布文档（含 content 与 revision）。
 * PATCH  /api/canvases/[id] — 原子乐观锁保存（085 canvas_document_patch）：
 *                             expected_revision 过期返回 409 + current.revision。
 * DELETE /api/canvases/[id] — 软删除（进垃圾箱，走 mutate_trash RPC；恢复也在那里）。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  const { data, error } = await supabase
    .from("canvas_documents")
    .select("id, title, content, revision, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return serverError(error);
  if (!data) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.slice(0, 200) : "";
  const content = body.content as CanvasDoc | undefined;
  if (content !== undefined) {
    const validation = validateCanvasContent(content);
    if (!validation.ok) {
      return NextResponse.json(
        { error: "画布内容校验失败", errors: validation.errors },
        { status: 400 },
      );
    }
  }
  if (content === undefined) {
    // 仅改名：也走 CAS，避免与内容保存互相覆盖
    const current = await supabase
      .from("canvas_documents")
      .select("content")
      .eq("id", id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (current.error) return serverError(current.error);
    if (!current.data) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    body.content = current.data.content;
  }
  const expectedRevision =
    typeof body.expected_revision === "number" && Number.isFinite(body.expected_revision)
      ? Math.trunc(body.expected_revision)
      : null;

  const { data, error } = await supabase.rpc("canvas_document_patch", {
    p_id: id,
    p_title: title,
    p_content: body.content,
    p_expected_revision: expectedRevision,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const result = data as {
    status?: string;
    revision?: number;
    updated_at?: string;
    current?: { revision?: number };
  } | null;

  if (result?.status === "ok") {
    return NextResponse.json({
      id,
      revision: result.revision,
      updated_at: result.updated_at,
    });
  }
  if (result?.status === "conflict") {
    return NextResponse.json(
      {
        error: "画布已被其他标签页或设备修改",
        current: { revision: result.current?.revision ?? null },
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ error: "文档不存在" }, { status: 404 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  // 软删除必须走 RPC：RLS update 隐式检查 deleted_at is null 会拒绝直写软删行
  const { data, error } = await supabase.rpc("mutate_trash", {
    p_action: "soft_delete",
    p_resource_type: "canvas_document",
    p_ids: [id],
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const affected = typeof data === "number" ? data : 0;
  if (affected === 0) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  return NextResponse.json({ success: true, affected });
}
