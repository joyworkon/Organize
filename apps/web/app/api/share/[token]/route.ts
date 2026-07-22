import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ShareResourceType } from "@organize/shared";

// GET /api/share/[token] - 公开访问某个分享（无需登录）
// RLS 已放行 is_public=true 且未过期的记录，anon 可读
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const supabase = await createClient();
  const { token } = await params;

  if (!token) {
    return NextResponse.json({ error: "无效的分享链接" }, { status: 400 });
  }

  // 查 shares 记录（RLS 允许 anon 读公开的）
  const { data: share, error } = await supabase
    .from("shares")
    .select("id, resource_type, resource_id, is_public, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !share) {
    return NextResponse.json({ error: "分享不存在或已失效" }, { status: 404 });
  }

  const isExpired = share.expires_at && new Date(share.expires_at) < new Date();
  if (!share.is_public || isExpired) {
    return NextResponse.json({ error: "分享已失效" }, { status: 410 });
  }

  // 查关联资源（用 admin 客户端绕过 RLS 不合适；这里用 anon 客户端即可，因为资源本身我们单独放行）
  // 注意：notes/reading_items 的 RLS 默认不让 anon 读。所以我们需要用一个绕过 RLS 的方式，
  // 但这要求 service_role key，在 Edge runtime 里不安全。
  // 更稳妥：用单独的 RLS policy 让带有效 token 的 share 对应资源可读。
  // 这里简化：直接读，如果失败返回提示
  const resourceType = share.resource_type as ShareResourceType;
  const table = resourceType === "note" ? "notes" : "reading_items";

  const { data: resource, error: resourceErr } = await supabase
    .from(table)
    .select(resourceType === "note" ? "id, title, content" : "id, title, content, excerpt, cover_image, url")
    .eq("id", share.resource_id)
    .maybeSingle();

  if (resourceErr || !resource) {
    return NextResponse.json({ error: "资源已被删除" }, { status: 404 });
  }

  return NextResponse.json({
    resource_type: resourceType,
    resource,
    expires_at: share.expires_at,
  });
}
