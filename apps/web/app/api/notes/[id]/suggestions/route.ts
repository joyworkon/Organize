import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import type { MutationRejection } from "@/lib/notes/api-mutation";
import {
  parseSuggestionsPatchBody,
  parseSuggestionsPostBody,
  suggestionNoteRejection,
  suggestionPatchRejection,
} from "@/lib/notes/suggestions-api";

function reject(rejection: MutationRejection) {
  return NextResponse.json({ error: rejection.error }, { status: rejection.status });
}

async function authorize(noteId: string) {
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
    const rejection = suggestionNoteRejection(error);
    return { error: rejection ? reject(rejection) : serverError(error) };
  }
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
  if (error) return serverError(error);
  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorize(id);
  if (ctx.error) return ctx.error;
  const parsed = await parseSuggestionsPostBody(request);
  if (!parsed.ok) return reject(parsed.rejection);
  const { blockId, originalBlock, proposedBlock } = parsed.input;
  const { data, error } = await ctx.supabase!.from("note_suggestions").insert({
    note_id: id,
    block_id: blockId,
    user_id: ctx.user!.id,
    original_block: originalBlock,
    proposed_block: proposedBlock,
  }).select().single();
  if (error) return serverError(error);
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorize(id);
  if (ctx.error) return ctx.error;
  const parsed = await parseSuggestionsPatchBody(request);
  if (!parsed.ok) return reject(parsed.rejection);
  const { suggestionId, status } = parsed.input;
  const { data, error } = await ctx.supabase!.from("note_suggestions").update({ status }).eq("id", suggestionId).eq("note_id", id).eq("status", "pending").select().single();
  if (error) {
    // 0 行（建议不存在 / 已处理）→ 409；真实故障走 serverError，不泄露 message
    const rejection = suggestionPatchRejection(error);
    return rejection ? reject(rejection) : serverError(error);
  }
  return NextResponse.json(data);
}
