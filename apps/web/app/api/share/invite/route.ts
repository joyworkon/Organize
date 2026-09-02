import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverError } from "@/lib/api/error";
import { getRequestId, logApiError } from "@/lib/api/logger";
import { rateLimit } from "@/lib/api/rate-limit";
import { generateToken } from "@/lib/share/token";
import { validateInvitePayload } from "@/lib/share/invite";

const INVITE_EXPIRES_DAYS = 7;
const INVITE_RATE_LIMIT = 20; // 每用户每小时最多 20 封邀请（真实发信端点必须限流）

// POST /api/share/invite - 邀请未注册邮箱（Track A，071）
//
// 流程：校验 → resource_role 须 owner（与 071 RLS with check 同口径，先给友好 403）
// → workspace_id 须属调用者所有（往空间加人只有空间 owner 能做）→ 缺省则以调用者
// 身份 create_workspace 新建协作空间 → 插 share_invites（pending，7 天过期）
// → admin.auth.admin.inviteUserByEmail 发邀请邮件（redirectTo 兑现页）→ 回填
// invited_user_id。
// mock 后端：如实 503（DoD：mock 下不假成功）。
export async function POST(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_MOCK_BACKEND === "true") {
    return NextResponse.json({ error: "mock 后端不支持邮箱邀请" }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  // 邀请邮件走 admin.auth.admin.inviteUserByEmail，必须持有 service role
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "邀请服务未配置（缺 SUPABASE_SERVICE_ROLE_KEY）" },
      { status: 503 }
    );
  }

  if (!rateLimit(`invite:${user.id}`, INVITE_RATE_LIMIT, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "邀请发送过于频繁，请稍后再试" }, { status: 429 });
  }

  const parsed = validateInvitePayload(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const invite = parsed.value;

  const { data: role, error: roleErr } = await supabase.rpc("resource_role", {
    p_resource_type: invite.resource_type,
    p_resource_id: invite.resource_id,
  });
  if (roleErr) return serverError(roleErr);
  if (role !== "owner") {
    return NextResponse.json({ error: "只有资源所有者能发送邀请" }, { status: 403 });
  }

  let createdWorkspaceId: string | null = null;
  if (invite.workspace_id) {
    // 邀请会把对方拉进该空间（= 授予空间内全部已授权资源的角色），
    // 只有空间 owner 能做——选了别人的空间在源头就拒绝（071 RLS 同款谓词）
    const { data: ws } = await supabase
      .from("workspaces")
      .select("owner_id")
      .eq("id", invite.workspace_id)
      .maybeSingle();
    if (!ws || ws.owner_id !== user.id) {
      return NextResponse.json({ error: "只有空间所有者能邀请人加入该空间" }, { status: 403 });
    }
  } else {
    const { data: wsId, error: wsErr } = await supabase.rpc("create_workspace", {
      p_name: invite.new_workspace_name || "协作空间",
      p_invitees: [],
    });
    if (wsErr) return serverError(wsErr);
    createdWorkspaceId = wsId as string;
  }

  const token = generateToken();
  const { error: insErr } = await supabase
    .from("share_invites")
    .insert({
      resource_type: invite.resource_type,
      resource_id: invite.resource_id,
      workspace_id: invite.workspace_id ?? createdWorkspaceId!,
      access_role: invite.access_role,
      email: invite.email,
      invited_by: user.id,
      token,
      status: "pending",
      expires_at: new Date(Date.now() + INVITE_EXPIRES_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    });
  if (insErr) return serverError(insErr);

  const origin = new URL(request.url).origin;
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    invite.email,
    {
      redirectTo: `${origin}/auth/callback?next=/invites/${token}`,
    }
  );
  if (inviteErr || !invited?.user) {
    // 邮件没发出去就不留预授权半状态（删除刚建的行与本次新建的空空间）；
    // 错误细节只进服务端日志，不回显给客户端（GoTrue 的报错可能带 SMTP 配置信息）
    logApiError(inviteErr, {
      requestId: getRequestId(request),
      path: "/api/share/invite",
      method: "POST",
    });
    const { error: delErr } = await supabase
      .from("share_invites")
      .delete()
      .eq("token", token)
      .eq("invited_by", user.id);
    if (delErr) logApiError(delErr, { path: "/api/share/invite", method: "POST" });
    if (createdWorkspaceId) {
      const { error: wsDelErr } = await supabase
        .from("workspaces")
        .delete()
        .eq("id", createdWorkspaceId);
      if (wsDelErr) logApiError(wsDelErr, { path: "/api/share/invite", method: "POST" });
    }
    return NextResponse.json({ error: "邀请邮件发送失败，请稍后重试" }, { status: 502 });
  }

  await supabase
    .from("share_invites")
    .update({ invited_user_id: invited.user.id })
    .eq("token", token)
    .eq("invited_by", user.id);

  return NextResponse.json({ status: "invited", email: invite.email });
}
