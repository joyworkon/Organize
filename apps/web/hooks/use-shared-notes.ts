"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isCollabRole, type CollabRole } from "@/lib/collab/roles";

export interface SharedNoteItem {
  id: string;
  title: string | null;
  icon: string | null;
  updatedAt: string;
  ownerId: string;
  ownerName: string | null;
  ownerAvatarUrl: string | null;
  /** 我对这篇笔记的有效角色（resource_role 结论，前端不自行推导） */
  myRole: CollabRole;
}

interface RawNoteRow {
  id: string;
  title: string | null;
  icon: string | null;
  updated_at: string;
  user_id: string;
}

/**
 * 「与我共享」数据源：非属主笔记里能读到的只有 064 RLS 授权给我的行，
 * 因此 `user_id <> 我` 一次直读就够了——不需要专门的列表 RPC（065 卡面留白的决定）。
 * 我的角色逐条取 resource_role()；属主姓名/头像取 user_profiles
 * （能读到笔记 ⇒ 与属主共享至少一个空间 ⇒ 档案可见，064 的可见集设计）。
 */
export function useSharedNotes(limit = 100) {
  const supabase = useMemo(() => createClient(), []);
  const [notes, setNotes] = useState<SharedNoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setNotes([]);
        return;
      }
      const { data, error: queryErr } = await supabase
        .from("notes")
        .select("id, title, icon, updated_at, user_id")
        .neq("user_id", user.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (queryErr) throw new Error(queryErr.message);
      const rows = (data || []) as RawNoteRow[];

      // mock 后端只有一个账号：neq 过滤后天然为空，不额外发角色/档案查询
      if (rows.length === 0) {
        setNotes([]);
        return;
      }

      const withRoles = await Promise.all(
        rows.map(async (row) => {
          const { data: role } = await supabase.rpc("resource_role", {
            p_resource_type: "note",
            p_resource_id: row.id,
          });
          // RLS 已保证可见 ⇒ 角色必然非空；防御值取 viewer（宁可错杀为只读）
          const myRole = isCollabRole(role) ? role : "viewer";
          return { row, myRole };
        })
      );

      const ownerIds = [...new Set(rows.map((row) => row.user_id))];
      const profiles = new Map<string, { display_name: string | null; avatar_url: string | null }>();
      const { data: profileRows } = await supabase
        .from("user_profiles")
        .select("id, display_name, avatar_url")
        .in("id", ownerIds);
      for (const profile of profileRows || []) {
        profiles.set(profile.id, { display_name: profile.display_name ?? null, avatar_url: profile.avatar_url ?? null });
      }

      setNotes(
        withRoles.map(({ row, myRole }) => ({
          id: row.id,
          title: row.title || null,
          icon: row.icon || null,
          updatedAt: row.updated_at,
          ownerId: row.user_id,
          ownerName: profiles.get(row.user_id)?.display_name ?? null,
          ownerAvatarUrl: profiles.get(row.user_id)?.avatar_url ?? null,
          myRole,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载共享笔记失败");
    } finally {
      setLoading(false);
    }
  }, [limit, supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { notes, loading, error, refresh };
}

/**
 * 侧边栏条件入口用：只要知道「有没有」就够了，limit 1 的最轻查询。
 * mock 后端恒为 false（单账号没有共享行），入口自然隐藏。
 */
export function useHasSharedNotes(): boolean {
  const supabase = useMemo(() => createClient(), []);
  const [hasShared, setHasShared] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { data } = await supabase
        .from("notes")
        .select("id")
        .neq("user_id", user.id)
        .is("deleted_at", null)
        .limit(1);
      if (active) setHasShared((data || []).length > 0);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  return hasShared;
}
