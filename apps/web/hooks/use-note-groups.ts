"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { NoteGroup } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import { NOTE_GROUPS_CHANGED, loadNoteGroups } from "@/lib/notes/groups";

/** 读取当前用户的笔记分组与归属关系；任何地方改动分组后自动刷新 */
export function useNoteGroups(enabled = true) {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [groups, setGroups] = useState<NoteGroup[]>([]);
  const [membership, setMembership] = useState<Map<string, string>>(new Map());
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);
    try {
      const state = await loadNoteGroups(supabase, user.id);
      setGroups(state.groups);
      setMembership(state.membership);
    } catch {
      // 分组表不可用（未迁移等）时退化为「全部未分组」，不影响笔记本身
      setGroups([]);
      setMembership(new Map());
    } finally {
      setLoaded(true);
    }
  }, [supabase]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    const onChange = () => void reload();
    window.addEventListener(NOTE_GROUPS_CHANGED, onChange);
    return () => window.removeEventListener(NOTE_GROUPS_CHANGED, onChange);
  }, [enabled, reload]);

  return { supabase, userId, groups, membership, loaded, reload };
}
