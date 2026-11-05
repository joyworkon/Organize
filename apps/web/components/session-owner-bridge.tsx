"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useOpenTabsStore } from "@/lib/notes/open-tabs-store";
import {
  bindRecentSearchesOwner,
  unbindRecentSearchesOwner,
} from "@/lib/search/recent-searches";

/**
 * 账号切换客户端缓存隔离桥（C02/A02 缓存隔离收口，2026-09-15 缺陷登记的修复扩展）：
 * 会话就绪/变更时把登录身份同步给所有按账号隔离的本地缓存，换人即清空上一账号的数据、
 * 登出即清空。目前覆盖：笔记标签页条与侧栏「最近」（open-tabs store）、
 * 命令面板最近搜索（recent-searches）。挂在 (main) 布局，
 * 早于任何读取这些缓存的页面渲染（INITIAL_SESSION 在首帧 effects 内到达）。
 * 新增按账号隔离的本地缓存时在这里追加 rebind/clear，不要再挂一套 auth 监听。
 */
export function SessionOwnerBridge() {
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const bindOwner = (userId: string) => {
      useOpenTabsStore.getState().rebindOwner(userId);
      bindRecentSearchesOwner(userId);
    };
    const clearCaches = () => {
      useOpenTabsStore.getState().clearForSignOut();
      unbindRecentSearchesOwner();
    };

    void supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        if (session?.user?.id) {
          bindOwner(session.user.id);
        } else {
          clearCaches();
        }
      })
      .catch(() => {});

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        clearCaches();
        return;
      }
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "USER_UPDATED") {
        if (session?.user?.id) {
          bindOwner(session.user.id);
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
