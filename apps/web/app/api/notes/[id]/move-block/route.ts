import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });
  const body = await request.json();
  const targetNoteId = String(body.targetNoteId || "");
  const blockId = String(body.blockId || "");
  if (!targetNoteId || !blockId || targetNoteId === id) return NextResponse.json({ error: "移动目标无效" }, { status: 400 });
  const { error } = await supabase.rpc("move_note_block", {
    p_source_note_id: id,
    p_target_note_id: targetNoteId,
    p_block_id: blockId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json({ success: true });
}
