import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPublicShare } from "@/lib/share/public-share";
import { parseSessionId, shareSessionCookieName } from "@/lib/share/session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  // 与 /s/[token] 页面同口径：带上本设备的会话凭证（082），否则设了名额的链接
  // 在这里会被判成 claim_required，拿不到内容
  const cookieStore = await cookies();
  const sessionId = parseSessionId(cookieStore.get(shareSessionCookieName(token))?.value);
  const share = await getPublicShare(token, { sessionId });

  if (share.state === "missing") {
    return NextResponse.json({ error: "分享不存在或已失效" }, { status: 404 });
  }
  if (share.state === "expired") {
    return NextResponse.json({ error: "分享已失效" }, { status: 410 });
  }
  if (share.state === "claim_required") {
    // 403 而非 404：链接是有效的，只是本设备还没认领名额——调用方应去
    // /api/public-share/<token>/claim 认领后重试，不该被误导成「链接坏了」
    return NextResponse.json(
      { error: "需要先确认进入", state: "claim_required", access_mode: share.access_mode },
      { status: 403 }
    );
  }

  return NextResponse.json({
    resource_type: share.resource_type,
    resource: share.resource,
    expires_at: share.expires_at,
  });
}
