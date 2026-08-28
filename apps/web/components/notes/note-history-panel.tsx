"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { cn } from "@/lib/utils";

export interface NoteVersionMeta {
  id: string;
  title: string | null;
  message: string | null;
  created_at: string;
}

interface NoteHistoryPanelProps {
  noteId: string;
  open: boolean;
  /** 当前预览中的版本 id（列表高亮用） */
  activeVersionId: string | null;
  onClose: () => void;
  /** 点击某个版本：父级拉取完整内容进入预览 */
  onSelect: (version: NoteVersionMeta) => void;
  /** 保存命名版本后通知父级（如刷新列表计数） */
  onSaved?: () => void;
}

interface DayGroup {
  key: string;
  label: string;
  versions: NoteVersionMeta[];
}

function groupByDay(versions: NoteVersionMeta[]): DayGroup[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups = new Map<string, DayGroup>();
  for (const version of versions) {
    const date = new Date(version.created_at);
    const dayTime = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const dayIndex = Math.round((startOfToday - dayTime) / 86400000);
    let label: string;
    if (dayIndex === 0) label = "今天";
    else if (dayIndex === 1) label = "昨天";
    else {
      label = `${date.getMonth() + 1}月${date.getDate()}日`;
      if (date.getFullYear() !== now.getFullYear()) label = `${date.getFullYear()}年${label}`;
    }
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const group = groups.get(key) || { key, label, versions: [] };
    group.versions.push(version);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

function timeLabel(value: string): string {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function NoteHistoryPanel({
  noteId,
  open,
  activeVersionId,
  onClose,
  onSelect,
}: NoteHistoryPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [versions, setVersions] = useState<NoteVersionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingNamed, setSavingNamed] = useState(false);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("note_versions")
        .select("id, title, message, created_at")
        .eq("note_id", noteId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (!error) setVersions((data || []) as NoteVersionMeta[]);
    } finally {
      setLoading(false);
    }
  }, [noteId, supabase]);

  useEffect(() => {
    if (open) void loadVersions();
  }, [open, loadVersions]);

  const saveNamedVersion = async () => {
    const message = (await showPrompt({ title: "保存命名版本", placeholder: "例如：定稿 / 交付前" }))?.trim();
    if (!message) return;
    setSavingNamed(true);
    try {
      const { data, error } = await supabase.rpc("save_note_named_version", {
        p_note_id: noteId,
        p_message: message,
      });
      const status = Array.isArray(data) ? data[0]?.status : data?.status;
      if (error || status !== "ok") {
        toast({ title: "保存版本失败", variant: "destructive" });
        return;
      }
      toast({ title: "已保存命名版本" });
      await loadVersions();
    } finally {
      setSavingNamed(false);
    }
  };

  const groups = useMemo(() => groupByDay(versions), [versions]);

  if (!open) return null;

  return (
    <aside className="note-history" aria-label="版本历史">
      <div className="note-history-header">
        <span className="note-history-title">版本历史</span>
        <div className="note-history-header-actions">
          <button
            type="button"
            className="note-history-named-btn"
            onClick={() => void saveNamedVersion()}
            disabled={savingNamed}
            title="把当前内容保存为一个命名版本（不会被自动清理）"
          >
            {savingNamed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            命名版本
          </button>
          <button
            type="button"
            className="note-history-close"
            onClick={onClose}
            aria-label="关闭版本历史"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="note-history-list">
        {loading && versions.length === 0 ? (
          <div className="note-history-empty">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : versions.length === 0 ? (
          <div className="note-history-empty">还没有历史版本；编辑内容后会自动生成快照</div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="note-history-group">
              <div className="note-history-day">{group.label}</div>
              {group.versions.map((version) => (
                <button
                  key={version.id}
                  type="button"
                  className={cn(
                    "note-history-item",
                    activeVersionId === version.id && "active"
                  )}
                  onClick={() => onSelect(version)}
                >
                  <span className="note-history-item-time">{timeLabel(version.created_at)}</span>
                  <span className="note-history-item-name">
                    {version.message || version.title || "自动保存"}
                  </span>
                  {version.message && <span className="note-history-badge">命名</span>}
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="note-history-footnote">
        7 天内每小时保留一版，更早每天一版，共保留 90 天；命名版本不会被清理。点击版本可预览与恢复。
      </div>
    </aside>
  );
}
