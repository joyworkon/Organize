import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * 浏览器扩展登录端点：代理 Supabase 邮箱密码登录与 token 刷新。
 *
 * 扩展只需配置 Organize 站点地址，不需要知道 Supabase URL / anon key；
 * middleware 对 /api/extension/* 豁免 cookie 鉴权（同 /api/cron 模式），
 * 由本路由自行验证凭据。mock 后端或未配置 Supabase 时明确返回 501。
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function backend() {
  if (process.env.NEXT_PUBLIC_MOCK_BACKEND === "true") return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function unavailable() {
  return NextResponse.json(
    { error: "当前环境未连接 Supabase，浏览器扩展登录不可用" },
    { status: 501, headers: CORS_HEADERS }
  );
}

export async function POST(request: NextRequest) {
  let body: {
    action?: "login" | "refresh";
    email?: string;
    password?: string;
    refresh_token?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "无效的请求体" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const supabase = backend();
  if (!supabase) return unavailable();

  const toPayload = (
    session: { access_token: string; refresh_token: string; expires_at?: number | null } | null,
    user: { id: string; email?: string | null } | null
  ) =>
    NextResponse.json(
      {
        access_token: session?.access_token,
        refresh_token: session?.refresh_token,
        expires_at: session?.expires_at ?? null,
        user: user ? { id: user.id, email: user.email ?? null } : null,
      },
      { headers: CORS_HEADERS }
    );

  if (body.action === "refresh") {
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
    if (!refreshToken) {
      return NextResponse.json(
        { error: "缺少 refresh_token" },
        { status: 400, headers: CORS_HEADERS }
      );
    }
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session) {
      return NextResponse.json(
        { error: error?.message || "登录已过期，请重新登录" },
        { status: 401, headers: CORS_HEADERS }
      );
    }
    return toPayload(data.session, data.user);
  }

  // 默认 login
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json(
      { error: "请输入邮箱和密码" },
      { status: 400, headers: CORS_HEADERS }
    );
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data?.session) {
    return NextResponse.json(
      { error: error?.message || "登录失败，请检查邮箱与密码" },
      { status: 401, headers: CORS_HEADERS }
    );
  }
  return toPayload(data.session, data.user);
}
