import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { askAI, getAIConfig } from "@/lib/ai/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });
  const body = await request.json();
  const instruction = String(body.instruction || "").trim();
  const text = String(body.text || "").trim();
  if (!instruction || !text) return NextResponse.json({ error: "指令和原文不能为空" }, { status: 400 });
  try {
    const config = await getAIConfig(supabase, user.id);
    return NextResponse.json({ text: await askAI(config, instruction.slice(0, 1000), text) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI 请求失败" }, { status: 502 });
  }
}
