import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function getContext(noteId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "未授权" }, { status: 401 }) };
  const { data: note } = await supabase.from("notes").select("id").eq("id", noteId).eq("user_id", user.id).single();
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext(id);
  if (ctx.error) return ctx.error;
  const body = await request.json();
  const blockId = String(body.blockId || "").trim();
  const text = String(body.body || "").trim();
  if (!blockId || !text || text.length > 5000) return NextResponse.json({ error: "评论内容无效" }, { status: 400 });

  if (body.threadId) {
    const { data: thread } = await ctx.supabase!.from("note_comment_threads").select("id").eq("id", body.threadId).eq("note_id", id).single();
    if (!thread) return NextResponse.json({ error: "评论线程不存在" }, { status: 404 });
    const { data, error } = await ctx.supabase!.from("note_comments").insert({ thread_id: thread.id, user_id: ctx.user!.id, body: text }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  }

  const { data: thread, error: threadError } = await ctx.supabase!
    .from("note_comment_threads")
    .insert({ note_id: id, block_id: blockId, user_id: ctx.user!.id })
    .select()
    .single();
  if (threadError) return NextResponse.json({ error: threadError.message }, { status: 500 });
  const { error: commentError } = await ctx.supabase!.from("note_comments").insert({ thread_id: thread.id, user_id: ctx.user!.id, body: text });
  if (commentError) {
    await ctx.supabase!.from("note_comment_threads").delete().eq("id", thread.id);
    return NextResponse.json({ error: commentError.message }, { status: 500 });
  }
  return NextResponse.json(thread, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext(id);
  if (ctx.error) return ctx.error;
  const body = await request.json();
  if (body.commentId && typeof body.body === "string") {
    const text = body.body.trim();
    if (!text || text.length > 5000) return NextResponse.json({ error: "评论内容无效" }, { status: 400 });
    const { data, error } = await ctx.supabase!.from("note_comments").update({ body: text }).eq("id", body.commentId).eq("user_id", ctx.user!.id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }
  if (body.threadId && typeof body.resolved === "boolean") {
    const { data, error } = await ctx.supabase!.from("note_comment_threads").update({ resolved_at: body.resolved ? new Date().toISOString() : null }).eq("id", body.threadId).eq("note_id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }
  return NextResponse.json({ error: "无效操作" }, { status: 400 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext(id);
  if (ctx.error) return ctx.error;
  const body = await request.json();
  if (body.commentId) {
    const { error } = await ctx.supabase!.from("note_comments").delete().eq("id", body.commentId).eq("user_id", ctx.user!.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (body.threadId) {
    const { error } = await ctx.supabase!.from("note_comment_threads").delete().eq("id", body.threadId).eq("note_id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else return NextResponse.json({ error: "无效操作" }, { status: 400 });
  return NextResponse.json({ success: true });
}
