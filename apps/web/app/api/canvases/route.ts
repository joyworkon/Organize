import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { validateCanvasContent } from "@/lib/canvas/validation";
import type { CanvasDoc } from "@/lib/canvas/model";

/**
 * GET  /api/canvases — 画布文档列表（只读元数据，不拉取大 JSON）。
 * POST /api/canvases — 新建（客户端生成 UUID，幂等：同用户同 ID 返回既有行；
 *                      与其他用户撞 ID 时 409，不泄露存在性也不覆盖）。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const { data, error } = await supabase
    .from("canvas_documents")
    .select("id, title, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return serverError(error);
  return NextResponse.json({ canvases: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  const input = body as { id?: unknown; title?: unknown; content?: unknown };
  const id = typeof input.id === "string" && UUID_RE.test(input.id) ? input.id : null;
  if (!id) {
    return NextResponse.json({ error: "缺少合法的文档 ID" }, { status: 400 });
  }
  const title = typeof input.title === "string" ? input.title.slice(0, 200) : "";

  // 幂等命中：同用户已有同 ID 行 → 返回既有行
  const existing = await supabase
    .from("canvas_documents")
    .select("id, title, content, revision, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing.error) return serverError(existing.error);
  if (existing.data) {
    return NextResponse.json(existing.data, { status: 200 });
  }

  // 内容校验（客户端同一契约先行检查；未知块结构拒绝落库）
  if (input.content !== undefined) {
    const validation = validateCanvasContent(input.content);
    if (!validation.ok) {
      return NextResponse.json(
        { error: "画布内容校验失败", errors: validation.errors },
        { status: 400 },
      );
    }
  }
  const content: CanvasDoc =
    (input.content !== undefined ? (input.content as CanvasDoc) : {
      schemaVersion: 1,
      boards: [],
      freeItems: [],
    });

  const { data, error } = await supabase
    .from("canvas_documents")
    .insert({ id, user_id: user.id, title, content })
    .select("id, title, content, revision, created_at, updated_at")
    .single();

  if (error) {
    // 23505：与其他用户撞 ID——不泄露存在性，返回通用冲突
    if (error.code === "23505") {
      return NextResponse.json({ error: "ID 冲突，请更换 ID 重试" }, { status: 409 });
    }
    return serverError(error);
  }
  return NextResponse.json(data, { status: 201 });
}
