import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/synced-blocks/[id] — 原子乐观锁更新（R05，语义见 073 迁移 synced_block_patch）。
 * - 带 expected_revision：服务端单条 UPDATE 内比较；命中返回 200 + 新 revision，
 *   过期返回 409 + current（服务端当前 revision/content，默认不覆盖远端）。
 * - 不带 expected_revision（旧客户端兜底）：覆盖并递增。
 * - 重试同一请求若服务端已写入过：409，由客户端按 current.content 与本地一致判幂等命中。
 */
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
  const body = await request.json().catch(() => ({}));
  const content = Array.isArray(body.content) ? body.content : [];
  const expectedRevision =
    typeof body.expected_revision === "number" && Number.isInteger(body.expected_revision)
      ? body.expected_revision
      : null;

  const { data, error } = await supabase.rpc("synced_block_patch", {
    p_id: id,
    p_content: content,
    p_expected_revision: expectedRevision,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const result = data as {
    status?: string;
    id?: string;
    content?: unknown;
    revision?: number;
    updated_at?: string;
    current?: { revision?: number; content?: unknown };
  } | null;

  if (result?.status === "ok") {
    return NextResponse.json({
      id: result.id,
      content: result.content,
      revision: result.revision,
      updated_at: result.updated_at,
    });
  }
  if (result?.status === "conflict") {
    return NextResponse.json(
      {
        error: "同步区块已被其他修改更新",
        current: {
          revision: result.current?.revision ?? null,
          content: result.current?.content ?? null,
        },
      },
      { status: 409 }
    );
  }
  return NextResponse.json({ error: "同步区块不存在" }, { status: 404 });
}

// DELETE /api/synced-blocks/[id] — 删除同步区块
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
  const { error } = await supabase
    .from("synced_blocks")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
