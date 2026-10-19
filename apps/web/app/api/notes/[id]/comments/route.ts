import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import type { MutationRejection } from "@/lib/notes/api-mutation";
import {
  commentDeleteRejection,
  commentPatchRejection,
  noteContextRejection,
  parseCommentsDeleteBody,
  parseCommentsPatchBody,
  parseCommentsPostBody,
  threadDeleteRejection,
  threadLookupRejection,
  threadPatchRejection,
} from "@/lib/notes/comments-api";

function reject(rejection: MutationRejection) {
  return NextResponse.json({ error: rejection.error }, { status: rejection.status });
}

async function getContext(noteId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "未授权" }, { status: 401 }) };
  const { data: note, error } = await supabase
    .from("notes")
    .select("id")
    .eq("id", noteId)
    .eq("user_id", user.id)
    .single();
  if (error) {
    // 0 行（不存在 / 不属于本人）→ 404；真实数据库故障走 serverError，不伪装成「不存在」
    const rejection = noteContextRejection(error);
    return { error: rejection ? reject(rejection) : serverError(error) };
  }
  if (!note) return { error: NextResponse.json({ error: "笔记不存在" }, { status: 404 }) };
  return { supabase, user };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext(id);
  if (ctx.error) return ctx.error;
  const blockId = new URL(request.url).searchParams.get("blockId");
  let query = ctx.supabase!
    .from("note_comment_threads")
    .select("*, comments:note_comments(*)")
    .eq("note_id", id)
    .order("created_at", { ascending: true })
    .order("created_at", { referencedTable: "note_comments", ascending: true });
  if (blockId) query = query.eq("block_id", blockId);
  const { data, error } = await query;
  if (error) return serverError(error);
  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext(id);
  if (ctx.error) return ctx.error;
  const parsed = await parseCommentsPostBody(request);
  if (!parsed.ok) return reject(parsed.rejection);
  const { blockId, text, threadId } = parsed.input;

  if (threadId) {
    const { data: thread, error: lookupError } = await ctx.supabase!
      .from("note_comment_threads")
      .select("id")
      .eq("id", threadId)
      .eq("note_id", id)
      .single();
    if (lookupError) {
      const rejection = threadLookupRejection(lookupError);
      return rejection ? reject(rejection) : serverError(lookupError);
    }
    if (!thread) return NextResponse.json({ error: "评论线程不存在" }, { status: 404 });
    const { data, error } = await ctx.supabase!
      .from("note_comments")
      .insert({ thread_id: thread.id, user_id: ctx.user!.id, body: text })
      .select()
      .single();
    if (error) return serverError(error);
    return NextResponse.json(data, { status: 201 });
  }

  const { data: thread, error: threadError } = await ctx.supabase!
    .from("note_comment_threads")
    .insert({ note_id: id, block_id: blockId, user_id: ctx.user!.id })
    .select()
    .single();
  if (threadError) return serverError(threadError);
  const { error: commentError } = await ctx.supabase!
    .from("note_comments")
    .insert({ thread_id: thread.id, user_id: ctx.user!.id, body: text });
  if (commentError) {
    await ctx.supabase!.from("note_comment_threads").delete().eq("id", thread.id);
    return serverError(commentError);
  }
  return NextResponse.json(thread, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext(id);
  if (ctx.error) return ctx.error;
  const parsed = await parseCommentsPatchBody(request);
  if (!parsed.ok) return reject(parsed.rejection);

  if (parsed.input.kind === "edit-comment") {
    const { data, error } = await ctx.supabase!
      .from("note_comments")
      .update({ body: parsed.input.text })
      .eq("id", parsed.input.commentId)
      .eq("user_id", ctx.user!.id)
      .select()
      .single();
    if (error) {
      // 0 行（不存在 / 不是自己的评论）→ 404；真实故障走 serverError，不泄露 message
      const rejection = commentPatchRejection(error);
      return rejection ? reject(rejection) : serverError(error);
    }
    return NextResponse.json(data);
  }

  const { data, error } = await ctx.supabase!
    .from("note_comment_threads")
    .update({ resolved_at: parsed.input.resolved ? new Date().toISOString() : null })
    .eq("id", parsed.input.threadId)
    .eq("note_id", id)
    .select()
    .single();
  if (error) {
    const rejection = threadPatchRejection(error);
    return rejection ? reject(rejection) : serverError(error);
  }
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext(id);
  if (ctx.error) return ctx.error;
  const parsed = await parseCommentsDeleteBody(request);
  if (!parsed.ok) return reject(parsed.rejection);

  if (parsed.input.kind === "comment") {
    const { data, error } = await ctx.supabase!
      .from("note_comments")
      .delete()
      .eq("id", parsed.input.commentId)
      .eq("user_id", ctx.user!.id)
      .select("id");
    if (error) return serverError(error);
    // 0 行 → 404，不再假装 { success: true }
    const rejection = commentDeleteRejection((data || []).length);
    if (rejection) return reject(rejection);
    return NextResponse.json({ success: true });
  }

  const { data, error } = await ctx.supabase!
    .from("note_comment_threads")
    .delete()
    .eq("id", parsed.input.threadId)
    .eq("note_id", id)
    .select("id");
  if (error) return serverError(error);
  const rejection = threadDeleteRejection((data || []).length);
  if (rejection) return reject(rejection);
  return NextResponse.json({ success: true });
}
