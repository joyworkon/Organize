import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { summarizeTranscript, transcribeAudio } from "@/lib/ai/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });
  const form = await request.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File)) return NextResponse.json({ error: "未提供录音" }, { status: 400 });
  try {
    const transcript = await transcribeAudio(audio);
    return NextResponse.json(await summarizeTranscript(transcript));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI 速记失败" }, { status: 502 });
  }
}
