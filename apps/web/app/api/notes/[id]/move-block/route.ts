import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import type { MutationRejection } from "@/lib/notes/api-mutation";
import { moveBlockRpcRejection, parseMoveBlockBody } from "@/lib/notes/move-block-api";

function reject(rejection: MutationRejection) {
  return NextResponse.json({ error: rejection.error }, { status: rejection.status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });
  const parsed = await parseMoveBlockBody(request, id);
  if (!parsed.ok) return reject(parsed.rejection);
  const { targetNoteId, blockId } = parsed.input;
  const { error } = await supabase.rpc("move_note_block", {
    p_source_note_id: id,
    p_target_note_id: targetNoteId,
    p_block_id: blockId,
  });
  if (error) {
    // RPC 主动 raise 的业务错误 → 稳定中文文案；真实故障走 serverError，不回显原始 message
    const rejection = moveBlockRpcRejection(error);
    return rejection ? reject(rejection) : serverError(error);
  }
  return NextResponse.json({ success: true });
}
