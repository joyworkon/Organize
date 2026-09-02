import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * 免登录跳转的路径（P2-03）：除登录/回调/公开分享页外，还包含两个
 * 「无 session 的服务端调用方」入口——部署平台与 E2E 探活的 /api/health、
 * 由 GitHub Actions 带 Bearer 触发的 /api/cron/*（该路由自行校验 CRON_SECRET）。
 * 少了它们，真实后端下这两类请求会在到达路由前被 307 重定向到 /login。
 */
export function isAuthExemptPath(pathname: string): boolean {
  return (
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/s/") || // 公开分享页：/s/[token]
    // 匿名可编辑公开链接的快照保存（072）：无登录态可达；权限由 save_public_note
    // 按 token 实时判定（token 即能力），路由另有 token+IP 限流
    pathname.startsWith("/api/public-share/") ||
    // 桌面壳刘海激发器小窗（/desktop/notch）：未登录也要能渲染「登录后可用」
    // 提示（数据接口自行 401）；middleware 重定向会把小窗变成登录页
    pathname.startsWith("/desktop") ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/cron/")
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
