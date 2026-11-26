"use client";

import { useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * 本地会话里的当前用户 id：离线队列按它隔离存储 key。
 *
 * 读 getSession 而不是 getUser——getUser 要发网络请求，离线时返回 null，会把
 * 「断网时还有待同步的离线笔记」误判成未登录。随 auth 事件更新：登出为 null，
 * 换号换成新账号，所以队列永远不会以上一位的身份被读取或回放。
 */
export function useSessionUserId(supabase: SupabaseClient): string | null {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (active) setUserId(session?.user?.id ?? null);
      })
      .catch(() => {
        // 读不到会话就保持未登录态：队列操作在 userId 为 null 时一律不执行
      });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      active = false;
      void data.subscription.unsubscribe();
    };
  }, [supabase]);

  return userId;
}
