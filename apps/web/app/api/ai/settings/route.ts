import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMockBackend } from "@/lib/env";
import { validatePublicUrl } from "@/lib/scraper/url-safety";
import { getAISettingsView } from "@/lib/ai/server";

// GET /api/ai/settings - 设置页展示态（密钥只回掩码，完整密钥不出服务端）
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const view = await getAISettingsView(supabase, user.id);
  return NextResponse.json(view);
}

// PUT /api/ai/settings - 保存配置
// - base_url 保存时即做 SSRF 校验（协议 / 凭据 / 主机名黑名单 / 全部解析地址须公网）
// - api_key 仅在提供非空值时更新（密钥不回读，掩码展示）
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const baseUrl = String(body?.base_url || "").trim().replace(/\/+$/, "");
  const apiKey = String(body?.api_key || "").trim();
  const textModel = String(body?.text_model || "").trim() || null;
  const transcriptionModel = String(body?.transcription_model || "").trim() || null;

  if (!baseUrl) return NextResponse.json({ error: "API 地址为必填项" }, { status: 400 });
  try {
    // 保存时校验（防手滑/防恶意）；使用时 safeAIRequest 还会逐跳复检
    await validatePublicUrl(baseUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "API 地址不允许使用";
    return NextResponse.json({ error: `API 地址不允许使用：${message}` }, { status: 400 });
  }

  const admin = createAdminClient();
  let client: SupabaseClient | null = admin;
  if (!client && isMockBackend()) client = supabase;
  if (!client) return NextResponse.json({ error: "AI 服务未配置（缺少服务端凭据）" }, { status: 503 });

  // 是否已有配置（决定 api_key 缺省时是否报错）
  const { data: existing } = await client!
    .from("user_ai_settings")
    .select("api_key")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!existing?.api_key && !apiKey) {
    return NextResponse.json({ error: "API 密钥为必填项" }, { status: 400 });
  }

  const upsert: Record<string, unknown> = {
    user_id: user.id,
    base_url: baseUrl,
    text_model: textModel,
    transcription_model: transcriptionModel,
    updated_at: new Date().toISOString(),
  };
  if (apiKey) upsert.api_key = apiKey;

  const { error } = await client!
    .from("user_ai_settings")
    .upsert(upsert, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: "保存失败" }, { status: 500 });

  return NextResponse.json({ success: true });
}

// DELETE /api/ai/settings - 清除配置
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const admin = createAdminClient();
  let client: SupabaseClient | null = admin;
  if (!client && isMockBackend()) client = supabase;
  if (!client) return NextResponse.json({ error: "AI 服务未配置（缺少服务端凭据）" }, { status: 503 });

  const { error } = await client!
    .from("user_ai_settings")
    .delete()
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "清除失败" }, { status: 500 });
  return NextResponse.json({ success: true });
}
