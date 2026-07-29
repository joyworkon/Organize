import { NextRequest, NextResponse } from "next/server";
import { getPublicShare } from "@/lib/share/public-share";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const share = await getPublicShare(token);
  if (share.state === "missing") {
    return NextResponse.json({ error: "分享不存在或已失效" }, { status: 404 });
  }
  if (share.state === "expired") {
    return NextResponse.json({ error: "分享已失效" }, { status: 410 });
  }

  return NextResponse.json({
    resource_type: share.resource_type,
    resource: share.resource,
    expires_at: share.expires_at,
  });
}
