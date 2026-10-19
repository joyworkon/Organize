"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildWorkspaceRows, type WorkspaceView } from "@/lib/collab/workspace";
import {
  nextMemberProfilesAfterLoad,
  type MemberProfileRow,
} from "@/lib/collab/member-names-load";
import {
  nextSidebarPresenceAfterLoad,
  SIDEBAR_HAS_TEAM_WORKSPACES_LOAD_ERROR_HINT,
  type PresenceLoadOutcome,
} from "@/lib/layout/sidebar-collab-presence-load";

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
  const lastProfilesRef = useRef<MemberProfileRow[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [namesLoadError, setNamesLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        lastProfilesRef.current = [];
        setWorkspaces([]);
        setMyUserId(null);
        setNamesLoadError(null);
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
        lastProfilesRef.current = [];
        setWorkspaces([]);
        setNamesLoadError(null);
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
      const { data: profileRows, error: profileErr } = memberIds.length
        ? await supabase
            .from("user_profiles")
            .select("id, display_name, avatar_url")
            .in("id", memberIds)
        : { data: [], error: null };
      const plan = nextMemberProfilesAfterLoad({
        previousProfiles: lastProfilesRef.current,
        data: profileRows,
        error: profileErr,
      });
      if (!plan.loadError) lastProfilesRef.current = plan.profiles;
      setNamesLoadError(plan.loadError);

      setWorkspaces(
        buildWorkspaceRows(rows, memberRows || [], plan.profiles, user.id)
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

  return { workspaces, myUserId, loading, error, namesLoadError, refresh };
}

/**
 * 侧边栏「协作空间」条件入口用：只要知道「有没有 team 空间」就够了（limit 1）。
 * mock 后端恒为 false，入口自然隐藏——与「与我共享」入口同一约定。
 */
export function useHasTeamWorkspaces(): {
  has: boolean;
  loadError: string | null;
  refresh: () => void;
} {
  const supabase = useMemo(() => createClient(), []);
  const lastHasRef = useRef<boolean | null>(null);
  const requestIdRef = useRef(0);
  const [presence, setPresence] = useState<{
    has: boolean;
    loadError: string | null;
  }>({ has: false, loadError: null });

  const refresh = useCallback(() => {
    const requestId = ++requestIdRef.current;
    void (async () => {
      let outcome: PresenceLoadOutcome;
      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        if (authError) {
          outcome = { ok: false, error: SIDEBAR_HAS_TEAM_WORKSPACES_LOAD_ERROR_HINT };
        } else if (!user) {
          outcome = { ok: true, has: false };
        } else {
          const { data, error } = await supabase
            .from("workspaces")
            .select("id")
            .eq("kind", "team")
            .limit(1);
          outcome = error
            ? { ok: false, error: SIDEBAR_HAS_TEAM_WORKSPACES_LOAD_ERROR_HINT }
            : { ok: true, has: (data || []).length > 0 };
        }
      } catch {
        outcome = { ok: false, error: SIDEBAR_HAS_TEAM_WORKSPACES_LOAD_ERROR_HINT };
      }
      if (requestId !== requestIdRef.current) return;
      const next = nextSidebarPresenceAfterLoad(lastHasRef.current, outcome);
      if (outcome.ok) lastHasRef.current = outcome.has;
      setPresence(next);
    })();
  }, [supabase]);

  useEffect(() => {
    refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

  return { ...presence, refresh };
}
