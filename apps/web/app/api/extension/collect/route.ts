import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scrapeUrl as serverScrapeUrl } from "@/lib/scraper";
import { collectForExtension } from "@/lib/extension/collect";
import type { MediaLinkInput } from "@/lib/extension/media";

/**
 * 浏览器扩展收集端点：Bearer JWT 鉴权（/api/cron 同款「middleware 豁免 +
 * 路由自校验」模式），复用 collectForExtension 的统一收集语义
 * （规范化 → 去重 → 服务端抓取 → 8 字段插入 + 媒体小节）。
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function unauthorized(message = "登录已过期，请重新登录") {
  return NextResponse.json({ error: message }, { status: 401, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_MOCK_BACKEND === "true") {
    return NextResponse.json(
      { error: "mock 后端模式不支持浏览器扩展收集" },
      { status: 501, headers: CORS_HEADERS }
    );
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: "服务端未配置 Supabase" },
      { status: 501, headers: CORS_HEADERS }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return unauthorized("缺少访问令牌");

  // 以用户 JWT 作为请求身份：auth.getUser(token) 验签，RLS 按该用户生效
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) return unauthorized();

  let body: { url?: unknown; title?: unknown; mediaLinks?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "无效的请求体" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (typeof body.url !== "string" || !body.url.trim()) {
    return NextResponse.json(
      { error: "缺少页面 URL" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const result = await collectForExtension(
    { supabase, scrapeUrl: serverScrapeUrl },
    {
      userId: user.id,
      rawUrl: body.url,
      pageTitle: typeof body.title === "string" ? body.title : null,
      mediaLinks: Array.isArray(body.mediaLinks)
        ? (body.mediaLinks as MediaLinkInput[])
        : null,
    }
  );

  if (result.status === "error") {
    const status = result.errorReason === "invalid-url" ? 400 : 502;
    return NextResponse.json(
      { ...result, error: result.message ?? "保存失败" },
      { status, headers: CORS_HEADERS }
    );
  }
  return NextResponse.json(result, { headers: CORS_HEADERS });
}
