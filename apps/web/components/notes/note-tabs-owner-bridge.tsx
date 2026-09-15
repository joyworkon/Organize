"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useOpenTabsStore } from "@/lib/notes/open-tabs-store";

/**
 * C02/A02 账号切换缓存隔离桥（2026-09-15 收尾验证登记的缺陷修复）：
 * 标签页条与侧栏「最近」按登录身份重绑——会话就绪/变更时 rebindOwner，
 * 换人即清空上一账号的笔记标题与 ID；登出即清空。挂在 (main) 布局，
 * 早于任何 openTab 调用的页面渲染（INITIAL_SESSION 在首帧 effects 内到达）。
 */
export function NoteTabsOwnerBridge() {
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    void supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        if (session?.user?.id) {
          useOpenTabsStore.getState().rebindOwner(session.user.id);
        } else {
          useOpenTabsStore.getState().clearForSignOut();
        }
      })
      .catch(() => {});

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        useOpenTabsStore.getState().clearForSignOut();
        return;
      }
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "USER_UPDATED") {
        if (session?.user?.id) {
          useOpenTabsStore.getState().rebindOwner(session.user.id);
        }
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
