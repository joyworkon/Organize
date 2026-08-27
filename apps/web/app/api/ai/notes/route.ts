import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAIConfig, summarizeTranscript, transcribeAudio } from "@/lib/ai/server";
import { AI_RATE_LIMITS, checkRateLimit } from "@/lib/ai/rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });
  const limit = checkRateLimit(`ai:notes:${user.id}`, AI_RATE_LIMITS.notes);
  if (!limit.allowed) {
    return NextResponse.json({ error: "AI 速记请求过于频繁，请稍后再试" }, {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) },
    });
  }
  const form = await request.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File)) return NextResponse.json({ error: "未提供录音" }, { status: 400 });
  try {
    const config = await getAIConfig(supabase, user.id);
    const transcript = await transcribeAudio(config, audio);
    return NextResponse.json(await summarizeTranscript(config, transcript));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI 速记失败" }, { status: 502 });
  }
}
