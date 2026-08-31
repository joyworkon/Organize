"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildWorkspaceRows, type WorkspaceView } from "@/lib/collab/workspace";

/**
 * 协作空间管理页的数据源（P5 后续产品卡）。
 *
 * 三段直读（RLS 收口，无需专门列表 RPC）：
 *   ① workspaces（kind=team）——成员可见自己参与的空间（063）
 *   ② workspace_members——成员可见成员表（063）
 *   ③ user_profiles——共享空间 ⇒ 档案可见（064），拿姓名/头像
 * 角色判定消费成员行的 role 列（管理面事实源），不在前端重推权限。
 *
 * mock 后端：workspaces / workspace_members 恒为空集（单用户世界没有协作），
 * 页面自然显示空态；管理 RPC 显式报错（P5-02-MOCK），不假成功。
 */
export function useWorkspaces() {
  const supabase = useMemo(() => createClient(), []);
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
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
        setWorkspaces([]);
        setMyUserId(null);
        return;
      }
      setMyUserId(user.id);

      const { data: wsRows, error: wsErr } = await supabase
        .from("workspaces")
        .select("id, name, kind, owner_id, created_at")
        .eq("kind", "team")
        .order("created_at", { ascending: true });
      if (wsErr) throw new Error(wsErr.message);
      const rows = (wsRows || []) as Array<{
        id: string;
        name: string;
        kind: string;
        owner_id: string;
        created_at: string;
      }>;
      if (rows.length === 0) {
        setWorkspaces([]);
        return;
      }

      const wsIds = rows.map((row) => row.id);
      const { data: memberRows, error: memberErr } = await supabase
        .from("workspace_members")
        .select("workspace_id, user_id, role, joined_at")
        .in("workspace_id", wsIds);
      if (memberErr) throw new Error(memberErr.message);

      const memberIds = [
        ...new Set((memberRows || []).map((row) => row.user_id)),
      ];
      const { data: profileRows } = memberIds.length
        ? await supabase
            .from("user_profiles")
            .select("id, display_name, avatar_url")
            .in("id", memberIds)
        : { data: [] };

      setWorkspaces(
        buildWorkspaceRows(rows, memberRows || [], profileRows || [], user.id)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载协作空间失败");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { workspaces, myUserId, loading, error, refresh };
}

/**
 * 侧边栏「协作空间」条件入口用：只要知道「有没有 team 空间」就够了（limit 1）。
 * mock 后端恒为 false，入口自然隐藏——与「与我共享」入口同一约定。
 */
export function useHasTeamWorkspaces(): boolean {
  const supabase = useMemo(() => createClient(), []);
  const [hasTeam, setHasTeam] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { data } = await supabase
        .from("workspaces")
        .select("id")
        .eq("kind", "team")
        .limit(1);
      if (active) setHasTeam((data || []).length > 0);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  return hasTeam;
}
