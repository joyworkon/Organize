"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteGroup } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import {
  NOTE_GROUPS_CHANGED,
  isNoteGroupsTableMissing,
  loadNoteGroups,
  nextGroupsStateAfterLoad,
  type NoteGroupsState,
} from "@/lib/notes/groups";
import { isOnline } from "@/lib/offline/network";
import { toast } from "@/hooks/use-toast";

// 侧栏与笔记页同时挂载会各跑一份 reload，失败时用短冷却去重，避免弹两条一样的 toast
let lastLoadFailureToastAt = 0;
const LOAD_FAILURE_TOAST_COOLDOWN_MS = 5000;

function announceLoadFailure(failure: unknown) {
  const now = Date.now();
  if (now - lastLoadFailureToastAt < LOAD_FAILURE_TOAST_COOLDOWN_MS) return;
  lastLoadFailureToastAt = now;
  toast({
    title: "分组加载失败",
    description: failure instanceof Error ? failure.message : undefined,
    variant: "destructive",
  });
}

/** 读取当前用户的笔记分组与归属关系；任何地方改动分组后自动刷新 */
export function useNoteGroups(enabled = true) {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [groups, setGroups] = useState<NoteGroup[]>([]);
  const [membership, setMembership] = useState<Map<string, string>>(new Map());
  const [loaded, setLoaded] = useState(false);
  /** 最近一次失败的文案；null = 没有失败（含未成功过但未迁移的空态退化） */
  const [loadError, setLoadError] = useState<string | null>(null);
  // 最近一次成功加载的结果：失败时据此保留旧状态，而不是清空伪装成「全部未分组」
  const lastSuccessRef = useRef<NoteGroupsState | null>(null);

  const reload = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);
    let result: NoteGroupsState | null = null;
    let failure: unknown = null;
    try {
      result = await loadNoteGroups(supabase, user.id);
    } catch (err) {
      failure = err;
    }
    if (result) lastSuccessRef.current = result;
    const plan = nextGroupsStateAfterLoad(lastSuccessRef.current, result);
    // 未迁移（表缺失）沿用空态退化，不算失败状态；离线失败由顶栏离线角标表达。
    // 其余失败如实提示——即使保留了旧数据，用户也需要知道看到的是旧数据。
    const tableMissing = plan.failed && isNoteGroupsTableMissing(failure);
    setGroups(plan.groups);
    setMembership(plan.membership);
    setLoadError(plan.failed && !tableMissing ? (failure instanceof Error ? failure.message : "分组加载失败") : null);
    setLoaded(true);
    if (plan.failed && !tableMissing && isOnline()) {
      announceLoadFailure(failure);
    }
  }, [supabase]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    const onChange = () => void reload();
    window.addEventListener(NOTE_GROUPS_CHANGED, onChange);
    return () => window.removeEventListener(NOTE_GROUPS_CHANGED, onChange);
  }, [enabled, reload]);

  return { supabase, userId, groups, membership, loaded, loadError, reload };
}
