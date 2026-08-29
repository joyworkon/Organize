import { createClient } from "@supabase/supabase-js";

/**
 * 服务端专用 service_role 客户端（绕过 RLS）。
 * 仅可在服务端代码中使用（API 路由 / 定时任务）；不要在浏览器代码中 import。
 * mock 后端模式下返回 null（调用方需处理）。
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
