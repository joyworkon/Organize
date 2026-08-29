import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function authorize(noteId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "未授权" }, { status: 401 }) };
  const { data: note } = await supabase.from("notes").select("id").eq("id", noteId).eq("user_id", user.id).single();
  if (!note) return { error: NextResponse.json({ error: "笔记不存在" }, { status: 404 }) };
  return { supabase, user };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorize(id);
  if (ctx.error) return ctx.error;
  const blockId = new URL(request.url).searchParams.get("blockId");
  let query = ctx.supabase!.from("note_suggestions").select("*").eq("note_id", id).order("created_at", { ascending: false });
  if (blockId) query = query.eq("block_id", blockId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorize(id);
  if (ctx.error) return ctx.error;
  const body = await request.json();
  if (!body.blockId || !body.originalBlock || !body.proposedBlock) return NextResponse.json({ error: "建议内容不完整" }, { status: 400 });
  const { data, error } = await ctx.supabase!.from("note_suggestions").insert({
    note_id: id,
    block_id: body.blockId,
    user_id: ctx.user!.id,
    original_block: body.originalBlock,
    proposed_block: body.proposedBlock,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorize(id);
  if (ctx.error) return ctx.error;
  const body = await request.json();
  if (!body.suggestionId || !["accepted", "rejected"].includes(body.status)) return NextResponse.json({ error: "无效状态" }, { status: 400 });
  const { data, error } = await ctx.supabase!.from("note_suggestions").update({ status: body.status }).eq("id", body.suggestionId).eq("note_id", id).eq("status", "pending").select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json(data);
}
