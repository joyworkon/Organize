"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Plus, Trash2, X } from "@/components/icons";
import { toast } from "@/hooks/use-toast";
import { showConfirm, showPrompt } from "@/components/ui/prompt-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  nextVersionsAfterLoad,
  shouldShowHistoryEmpty,
  type VersionsLoadOutcome,
} from "@/lib/notes/note-history-load";
import { historyEscapeAction, historyListMove } from "@/lib/notes/note-history-nav";

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
  /** 可编辑时才提供删除版本。viewer / 未授权不显示。 */
  canEdit?: boolean;
  onClose: () => void;
  /** 退出预览但保持侧栏打开（Esc 第一下） */
  onExitPreview?: () => void;
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
  canEdit = false,
  onClose,
  onExitPreview,
  onSelect,
}: NoteHistoryPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [versions, setVersions] = useState<NoteVersionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingNamed, setSavingNamed] = useState(false);
  const [cursorId, setCursorId] = useState<string | null>(null);
  // 最近一次成功加载的版本列表：刷新失败时保留展示，不拿失败冒充「还没有历史版本」
  const lastSuccessRef = useRef<NoteVersionMeta[] | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const openedFocusRef = useRef(false);
  const aliveRef = useRef(true);
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;

  const loadVersions = useCallback(async () => {
    setLoading(true);
    let outcome: VersionsLoadOutcome<NoteVersionMeta>;
    try {
      const { data, error } = await supabase
        .from("note_versions")
        .select("id, title, message, created_at")
        .eq("note_id", noteId)
        .order("created_at", { ascending: false })
        .limit(500);
      outcome = error
        ? { ok: false }
        : { ok: true, versions: (data || []) as NoteVersionMeta[] };
    } catch {
      outcome = { ok: false };
    }
    const plan = nextVersionsAfterLoad(lastSuccessRef.current, outcome);
    if (!plan.failed) lastSuccessRef.current = plan.versions;
    setVersions(plan.versions);
    setLoadError(plan.loadError);
    setLoading(false);
  }, [noteId, supabase]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 切笔记：上一笔记的版本列表与失败提示不得带入新笔记
  useEffect(() => {
    lastSuccessRef.current = null;
    setVersions([]);
    setLoadError(null);
    setCursorId(null);
  }, [noteId]);

  useEffect(() => {
    if (!open) return;
    // 每次打开重新拉取；先清上一次的失败提示，避免串面板显示旧错误
    setLoadError(null);
    void loadVersions();
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

  const deleteVersion = async (version: NoteVersionMeta) => {
    const ok = await showConfirm({
      title: "删除这个历史版本？",
      description: "此操作不可撤销。",
      confirmText: "删除",
      destructive: true,
    });
    if (!ok || !aliveRef.current || noteIdRef.current !== noteId) return;
    const requestNoteId = noteId;
    let res: Response;
    try {
      res = await fetch(`/api/notes/${noteId}/versions/${version.id}`, { method: "DELETE" });
    } catch {
      if (aliveRef.current && noteIdRef.current === requestNoteId) {
        toast({ title: "删除版本失败", variant: "destructive" });
      }
      return;
    }
    if (!aliveRef.current || noteIdRef.current !== requestNoteId) return;
    if (!res.ok) {
      toast({ title: `删除版本失败（${res.status}）`, variant: "destructive" });
      return;
    }
    setVersions((prev) => {
      const next = prev.filter((item) => item.id !== version.id);
      lastSuccessRef.current = next;
      return next;
    });
    if (cursorId === version.id) setCursorId(null);
    if (activeVersionId === version.id) onExitPreview?.();
    // 删掉当前行后把焦点交回列表，键盘还能继续走
    requestAnimationFrame(() => {
      const list = listRef.current;
      const fallback = list?.querySelector<HTMLElement>('[role="option"][tabindex="0"]')
        ?? list?.querySelector<HTMLElement>('[role="option"]');
      fallback?.focus();
    });
  };

  const groups = useMemo(() => groupByDay(versions), [versions]);
  const flat = useMemo(() => groups.flatMap((group) => group.versions), [groups]);
  const showEmpty = shouldShowHistoryEmpty(versions, loadError, loading);
  const cursorInList = cursorId && flat.some((version) => version.id === cursorId) ? cursorId : null;
  const activeInList = activeVersionId && flat.some((version) => version.id === activeVersionId) ? activeVersionId : null;
  const effectiveCursor = cursorInList ?? activeInList ?? flat[0]?.id ?? null;

  useEffect(() => {
    if (!open) {
      openedFocusRef.current = false;
      return;
    }
    if (openedFocusRef.current || flat.length === 0 || !effectiveCursor) return;
    openedFocusRef.current = true;
    const el = optionRefs.current.get(effectiveCursor);
    el?.focus();
    el?.scrollIntoView?.({ block: "nearest" });
  }, [open, flat, effectiveCursor]);

  useEffect(() => {
    if (!open || !activeVersionId) return;
    optionRefs.current.get(activeVersionId)?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeVersionId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      if (event.defaultPrevented) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (typing && !listRef.current?.contains(target)) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      event.preventDefault();
      if (historyEscapeAction(Boolean(activeVersionId)) === "exit-preview" && onExitPreview) onExitPreview();
      else onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, activeVersionId, onExitPreview, onClose]);

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest(".note-history-delete") && (event.key === "Enter" || event.key === " ")) return;
    const index = effectiveCursor ? flat.findIndex((version) => version.id === effectiveCursor) : -1;
    const move = historyListMove(event.key, index, flat.length);
    if (!move) return;
    event.preventDefault();
    if (!move.preview) return;
    const version = flat[move.index];
    if (!version) return;
    setCursorId(version.id);
    onSelect(version);
    const el = optionRefs.current.get(version.id);
    el?.focus();
    el?.scrollIntoView?.({ block: "nearest" });
  };

  const selectVersion = (version: NoteVersionMeta) => {
    setCursorId(version.id);
    onSelect(version);
  };

  if (!open) return null;

  return (
    <aside className="note-history" aria-label="版本历史">
      <div className="note-history-header">
        <span className="note-history-title">版本历史</span>
        <div className="note-history-header-actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="note-history-named-btn"
            onClick={() => void saveNamedVersion()}
            disabled={savingNamed}
            title="把当前内容保存为一个命名版本（不会被自动清理）"
          >
            {savingNamed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            命名版本
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="note-history-close"
            onClick={onClose}
            aria-label="关闭版本历史"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="note-history-list">
        {loading && versions.length === 0 ? (
          <div className="note-history-empty">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : showEmpty ? (
          <div className="note-history-empty">还没有历史版本；编辑内容后会自动生成快照</div>
        ) : (
          <>
            {loadError && (
              <div
                className="flex items-center justify-between gap-2 px-2.5 py-2 text-xs text-destructive"
                role="alert"
              >
                <span>
                  {loadError}
                  {versions.length > 0 ? "，下方为上次成功加载的版本" : ""}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-destructive hover:text-destructive"
                  onClick={() => void loadVersions()}
                  disabled={loading}
                >
                  重试
                </Button>
              </div>
            )}
            {flat.length > 0 && (
              <div
                ref={listRef}
                className="note-history-listbox"
                role="listbox"
                aria-label="版本列表"
                aria-describedby="note-history-key-help"
                onKeyDown={onListKeyDown}
              >
                <p id="note-history-key-help" className="sr-only">
                  上下箭头切换版本并预览，Home 到最新，End 到最早，Enter 预览。Esc 先退出预览，再按一次关闭侧栏。
                </p>
                {groups.map((group) => (
                  <div key={group.key} className="note-history-group" role="group" aria-label={group.label}>
                    <div className="note-history-day">{group.label}</div>
                    {group.versions.map((version) => {
                      const selected = activeVersionId === version.id;
                      return (
                        <div
                          key={version.id}
                          ref={(node) => {
                            if (node) optionRefs.current.set(version.id, node);
                            else optionRefs.current.delete(version.id);
                          }}
                          id={`note-history-option-${version.id}`}
                          role="option"
                          tabIndex={effectiveCursor === version.id ? 0 : -1}
                          aria-selected={selected}
                          aria-current={selected ? "true" : undefined}
                          data-version-id={version.id}
                          className={cn("note-history-item", selected && "active")}
                          onClick={() => selectVersion(version)}
                        >
                          <span className="note-history-item-time">{timeLabel(version.created_at)}</span>
                          <span className="note-history-item-name">
                            {version.message || version.title || "自动保存"}
                          </span>
                          {version.message && <span className="note-history-badge">命名</span>}
                          {canEdit && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="note-history-delete"
                              aria-label="删除此版本"
                              title="删除此版本"
                              onClick={(event) => {
                                event.stopPropagation();
                                event.preventDefault();
                                void deleteVersion(version);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="note-history-footnote">
        7 天内每小时保留一版，更早每天一版，共保留 90 天；命名版本不会被清理。点击版本可预览与恢复。
      </div>
    </aside>
  );
}
