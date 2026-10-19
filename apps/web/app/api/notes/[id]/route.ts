import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import {
  buildNotePatchUpdate,
  noteGetRejection,
  notePatchRejection,
  parseJsonBody,
  resolveNoteDelete,
} from "@/lib/notes/api-mutation";

// GET /api/notes/[id] - 获取单个笔记
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("notes")
    .select("*, reading_item:reading_items(id, title, url, cover_image)")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error) {
    // 0 行（不存在 / 不属于本人）→ 404；真实数据库故障走 serverError，不伪装成「不存在」
    const rejection = noteGetRejection(error);
    if (rejection) {
      return NextResponse.json(
        { error: rejection.error },
        { status: rejection.status }
      );
    }
    return serverError(error);
  }

  return NextResponse.json(data);
}

// PATCH /api/notes/[id] - 更新笔记
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.rejection.error },
      { status: parsed.rejection.status }
    );
  }

  const built = buildNotePatchUpdate(parsed.body);
  if (!built.ok) {
    return NextResponse.json(
      { error: built.rejection.error },
      { status: built.rejection.status }
    );
  }
  const updateData = built.updateData;

  // parent 的存在性/循环校验需要查库，留在 route（纯函数只做类型门槛）
  const parentNoteId = parsed.body.parent_note_id;
  if (typeof parentNoteId === "string") {
    // 循环防护：不能把自己设为自己的父页面，也不能移动到自己的后代下
    if (parentNoteId === id) {
      return NextResponse.json(
        { error: "不能将笔记移动到自身下面" },
        { status: 400 }
      );
    }
    // 从候选 parent 向上遍历祖先链，若命中自己则构成循环
    const { data: ancestors } = await supabase
      .from("notes")
      .select("id, parent_note_id")
      .eq("user_id", user.id)
      .is("deleted_at", null);
    // 额外校验：候选父页面必须存在且未被删除
    const parentExists = (ancestors || []).some(
      (n: { id: string }) => n.id === parentNoteId
    );
    if (!parentExists) {
      return NextResponse.json(
        { error: "父页面不存在或已被删除" },
        { status: 400 }
      );
    }
    const byId = new Map(
      (ancestors || []).map((n: { id: string; parent_note_id: string | null }) => [
        n.id,
        n.parent_note_id,
      ])
    );
    const seen = new Set<string>();
    let cursor: string | null = parentNoteId;
    while (cursor) {
      if (cursor === id) {
        return NextResponse.json(
          { error: "不能将笔记移动到它自己的子孙页面下" },
          { status: 400 }
        );
      }
      if (seen.has(cursor)) break; // 已存在的循环（数据异常），跳出避免死循环
      seen.add(cursor);
      cursor = byId.get(cursor) ?? null;
    }
  }

  // PATCH 会改动编辑器保存快照里的字段（标题/图标/父页面/排版等）。
  // 不递增 content_revision 的话，另一个标签页里打开本笔记的编辑器仍持有
  // 旧 revision，其下一次自动保存会通过乐观锁检查、把这里的修改静默还原
  // （与 046/051 修的版本恢复、块移动问题同根因）。
  // updateData 必非空（空 PATCH 已在 buildNotePatchUpdate 里 400）。
  const { data: current } = await supabase
    .from("notes")
    .select("content_revision")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  updateData.content_revision = Number(current?.content_revision ?? 0) + 1;

  const { data, error } = await supabase
    .from("notes")
    .update(updateData)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    // 0 行（不存在 / 不属于本人）→ 404；真实数据库故障走 serverError，不泄露 message
    const rejection = notePatchRejection(error);
    if (rejection) {
      return NextResponse.json(
        { error: rejection.error },
        { status: rejection.status }
      );
    }
    return serverError(error);
  }

  return NextResponse.json(data);
}

// DELETE /api/notes/[id] - 将笔记移入垃圾箱
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("mutate_trash", {
    p_action: "soft_delete",
    p_resource_type: "note",
    p_ids: [id],
  });

  if (error) {
    console.error("Note soft delete failed:", error.message);
  }

  const result = resolveNoteDelete(error, typeof data === "number" ? data : 0);
  if (!result.ok) {
    const { rejection } = result;
    return NextResponse.json(
      rejection.code
        ? { error: rejection.error, code: rejection.code }
        : { error: rejection.error },
      { status: rejection.status }
    );
  }

  return NextResponse.json({
    success: true,
    affected: result.affected,
  });
}
