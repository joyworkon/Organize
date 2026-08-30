import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getRequestId, logApiError } from "@/lib/api/logger";

/**
 * 账号删除（P2-02）：登录用户请求永久删除自己的账号。
 *
 * 语义：service role 按 ID 删除 auth.users 行——schema 中全部业务表对
 * auth.users 均为 on delete cascade（001 起的约定，060 时复核为 0 例外），
 * 用户的所有数据随账号一并物理删除，不可恢复。RLS 不需要额外校验：
 * 会话校验（下）证明「删除的就是当前登录用户自己」。
 *
 * 安全：
 * - 必须携带有效会话（access token）；service role 只按「会话用户自己的 id」删除，
 *   请求体不参与定位目标，无法删除他人；
 * - 需要 SUPABASE_SERVICE_ROLE_KEY，未配置时返回 503（env 校验会 warn）。
 */
export async function DELETE(request: NextRequest) {
  const ctx = {
    requestId: getRequestId(request),
    path: "/api/account",
    method: "DELETE",
  };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "账号删除服务未配置（缺 SUPABASE_SERVICE_ROLE_KEY）" },
      { status: 503 }
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    logApiError(error, ctx);
    return NextResponse.json(
      { error: "账号删除失败，请稍后重试或联系支持" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
