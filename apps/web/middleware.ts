import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * 免登录跳转的路径（P2-03）：除登录/回调/公开分享页外，还包含两类
 * 「无 cookie session 的服务端调用方」入口——部署平台与 E2E 探活的 /api/health、
 * 由 GitHub Actions 带 Bearer 触发的 /api/cron/*（该路由自行校验 CRON_SECRET），
 * 以及 Chrome 扩展带 Bearer JWT 调用的 /api/extension/*（路由内用 Supabase
 * 验签并按用户 RLS 读写）。少了它们，真实后端下这些请求会在到达路由前被
 * 307 重定向到 /login。
 */
export function isAuthExemptPath(pathname: string): boolean {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/s/") || // 公开分享页：/s/[token]
    pathname === "/api/health" ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/extension/")
  );
}

export async function middleware(request: NextRequest) {
  // 请求 ID（P2-01）：每个请求生成/透传 x-request-id，API 结构化日志与客户端可回溯
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  // 开发假后端模式：跳过鉴权，直接放行（见 .env.local 的 NEXT_PUBLIC_MOCK_BACKEND）
  if (process.env.NEXT_PUBLIC_MOCK_BACKEND === "true") {
    const response = NextResponse.next({ request });
    response.headers.set("x-request-id", requestId);
    return response;
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isAuthExemptPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  supabaseResponse.headers.set("x-request-id", requestId);
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
