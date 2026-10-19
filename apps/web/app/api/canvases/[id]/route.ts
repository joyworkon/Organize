import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { parseJsonBody, validateCanvasPatchBody } from "@/lib/canvas/api-mutation";
import type { CanvasDoc } from "@/lib/canvas/model";

/**
 * GET    /api/canvases/[id] — 读取单个画布文档（含 content 与 revision）。
 * PATCH  /api/canvases/[id] — 原子乐观锁保存（085 canvas_document_patch）：
 *                             expected_revision 过期返回 409 + current.revision。
 * DELETE /api/canvases/[id] — 软删除（进垃圾箱，走 mutate_trash RPC；恢复也在那里）。
 *
 * B1：content 校验先经 ensureCanvasDocV2（v1 自动迁移），落库写迁移后的 v2。
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

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.rejection.error },
      { status: parsed.rejection.status },
    );
  }
  const input = validateCanvasPatchBody(parsed.body);
  if (!input.ok) {
    return NextResponse.json(
      {
        error: input.rejection.error,
        ...(input.rejection.errors ? { errors: input.rejection.errors } : {}),
      },
      { status: input.rejection.status },
    );
  }

  let title = input.title;
  let content: CanvasDoc | undefined = input.content;
  if (title === undefined || content === undefined) {
    // 缺省的一侧用当前行补齐：title 缺省保留原标题；content 缺省为「仅改名」。
    // CAS 仍在 RPC 内原子生效，这里只是读取展示侧缺省值。
    const current = await supabase
      .from("canvas_documents")
      .select("title, content")
      .eq("id", id)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (current.error) return serverError(current.error);
    if (!current.data) return NextResponse.json({ error: "文档不存在" }, { status: 404 });
    if (title === undefined) title = current.data.title as string;
    if (content === undefined) content = current.data.content as CanvasDoc;
  }

  const { data, error } = await supabase.rpc("canvas_document_patch", {
    p_id: id,
    p_title: title,
    p_content: content,
    p_expected_revision: input.expectedRevision,
  });
  if (error) {
    // RPC 入参不合法（22023，如标题超长）属客户端错误 → 400；其余不泄露细节
    if ((error as { code?: string }).code === "22023") {
      return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
    }
    return serverError(error);
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
    return serverError(error);
  }
  const affected = typeof data === "number" ? data : 0;
  if (affected === 0) {
    return NextResponse.json({ error: "文档不存在" }, { status: 404 });
  }
  return NextResponse.json({ success: true, affected });
}
