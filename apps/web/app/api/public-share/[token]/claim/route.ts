import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { parseSessionId, shareSessionCookieName } from "@/lib/share/session";

// 认领名额（082）：一次点击最多 1 次，另按 token 兜底防脚本刷
const CLAIM_RATE_LIMIT = 6;
const CLAIM_TOKEN_BACKSTOP = 30;
const CLAIM_RATE_WINDOW_MS = 60_000;

const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 天：够长到不打扰使用者，短到不是长期凭据

/**
 * POST /api/public-share/[token]/claim —— 认领这个公开链接的名额（082）
 *
 * 「锁在认领上，不在打开链接上」是本次能力的核心：链接预览爬虫（微信/Slack 的
 * unfurl）只 GET 不点，因此**不会烧掉链接**——所以认领必须是一个显式的 POST，
 * 由用户在「确认进入」页上真实点击触发。
 *
 * 权限完全由 082 的 claim_share_session 判（行锁 + 计数 + 插入原子完成，并发认领
 * 在分享行上串行化）；本路由只做限流、入参校验、把会话凭证写进 httpOnly cookie，
 * 不引入任何额外授权逻辑。
 *
 * 响应语义：
 *   not_required  该链接没设名额（存量链接）→ 不需要会话，页面直接按现状渲染
 *   ok            拿到名额，Set-Cookie 下发会话凭证
 *   no_quota      名额已被占满（转发给第二个人时的正常结果）
 *   ip_mismatch   名额还有，但本 IP 不在白名单内
 *   forbidden     链接无效/过期/已关闭（不区分，不给存在性探针）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  if (process.env.NEXT_PUBLIC_MOCK_BACKEND === "true") {
    return NextResponse.json({ error: "mock 后端不支持公开链接认领" }, { status: 503 });
  }

  const { token } = await params;
  if (!token || token.length < 16 || token.length > 256) {
    return NextResponse.json({ error: "链接无效" }, { status: 400 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;

  // 双档限流：token+IP 细分 + 单 token 兜底（XFF 可伪造，不可只信 IP，同 072 保存路由）
  if (!(await checkRateLimit(`public-claim:${token}:${ip ?? "noip"}`, CLAIM_RATE_LIMIT, CLAIM_RATE_WINDOW_MS))) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }
  if (!(await checkRateLimit(`public-claim-token:${token}`, CLAIM_TOKEN_BACKSTOP, CLAIM_RATE_WINDOW_MS))) {
    return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
  }

  // claim_id 幂等键：客户端每次认领尝试生成一次并复用，双击/重试/StrictMode 双跑
  // 命中同一 claim_id 时 RPC 返回同一会话，不吃第二个名额
  const raw = await request.text();
  const body: unknown = (() => {
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return null;
    }
  })();
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "请求体非法" }, { status: 400 });
  }
  const bodyClaimId = (body as { claim_id?: unknown }).claim_id;
  const claimId = typeof bodyClaimId === "string" ? parseSessionId(bodyClaimId) : null;
  if (bodyClaimId !== undefined && bodyClaimId !== null && claimId === null) {
    return NextResponse.json({ error: "claim_id 非法" }, { status: 400 });
  }

  // 无会话客户端 = anon 角色；claim_share_session 是 anon 可调的 DEFINER RPC
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_share_session", {
    p_token: token,
    p_ip: ip,
    p_claim_id: claimId,
  });
  if (error) return serverError(error);

  const result = (data ?? {}) as { status?: unknown; session_id?: unknown; remaining?: unknown };
  const status = typeof result.status === "string" ? result.status : "forbidden";
  const sessionId = parseSessionId(typeof result.session_id === "string" ? result.session_id : null);

  const response = NextResponse.json({
    status,
    remaining: typeof result.remaining === "number" ? result.remaining : null,
  });

  if (status === "ok" && sessionId) {
    response.cookies.set(shareSessionCookieName(token), sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_S,
    });
  }

  // 名额被占满 / IP 不符不是服务端错误，用 200 回结果让页面据实显示（不假装成功）
  return response;
}
