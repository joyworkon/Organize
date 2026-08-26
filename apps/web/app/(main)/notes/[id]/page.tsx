"use client";

import { useEffect, useState, useRef, useCallback, useMemo, useLayoutEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Editor } from "@tiptap/react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { TipTapEditor, type TransactionSource } from "@/components/editor/tiptap-editor";
import { NoteAttachmentsButton } from "@/components/editor/note-attachments-panel";
import { isOnline, useOnlineStatus } from "@/lib/offline/network";
import { planSaveFailure } from "@/lib/offline/note-sync";
import { NotePageMenu } from "@/components/notes/note-page-menu";
import type { NoteFont } from "@organize/shared";
import { Backlinks } from "@/components/notes/backlinks";
import { NotePageVisuals } from "@/components/notes/note-page-visuals";
import { NotePageComments } from "@/components/notes/note-page-comments";
import { NoteHierarchyBar } from "@/components/notes/note-hierarchy-bar";
import { LinkedTaskBanner } from "@/components/notes/linked-task-banner";
import { useHotkey } from "@/lib/hooks/use-hotkey";
import { NoteChildPages } from "@/components/notes/note-child-pages";
import { NoteMoveDialog } from "@/components/notes/note-move-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLeft, Loader2, Check, FileText, Calendar, Share2, WifiOff } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FavoriteButton } from "@/components/favorite-button";
import { ShareDialog } from "@/components/share/share-dialog";
import { NoteHistoryDialog } from "@/components/notes/note-history-dialog";
import { exportNoteToMarkdown } from "@/components/share/export-button";
import { mutateTrash } from "@/lib/trash/client";
import type { NoteTreeItem } from "@/lib/notes/tree";
import { copyNoteContent } from "@/lib/export/clipboard";
import { extractTaskMutations } from "@/lib/task-link";
import {
  areNoteDraftsEqual,
  clearLocalNoteDraft,
  readLocalNoteDraft,
  writeLocalNoteDraft,
  type NoteDraftSnapshot,
  type StoredNoteDraft,
} from "@/lib/notes/local-draft";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  extractLinksFromContent,
  internalLinkKey,
  type InternalLinkStateRow,
} from "@/lib/note-links";

// 页面级展示偏好按单篇笔记持久化（当前用 localStorage；接真实后端后可换成 notes 表的页面设置字段）。
const fullWidthKey = (id: string) => `organize:note:${id}:fullWidth`;
const fontKey = (id: string) => `organize:note:${id}:font`;
const smallFontKey = (id: string) => `organize:note:${id}:smallFont`;

function isTaskNoteLinkEnabled(): boolean {
  return true;
}

/**
 * 从笔记 content 递归提取所有「绑定块」（有 taskId 的 taskItem），
 * 转成 save_note_with_tasks RPC 所需的 task_mutations。
 * 标题取 taskItem 内首段纯文本；checked=true → status="done"。
 * G0 §3 状态机：此函数只读 content，不改动它。
 */
type NoteDraft = NoteDraftSnapshot;

interface SaveConflict {
  kind: "note" | "task";
  currentRevision: number | null;
  taskId?: string;
  remoteDraft: NoteDraft | null;
  remoteUpdatedAt: string | null;
}

export default function NoteEditorPage() {
  const params = useParams();
  const router = useRouter();
  const noteId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState<Record<string, unknown> | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [readingItemId, setReadingItemId] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverPosition, setCoverPosition] = useState(50);
  const [parentNoteId, setParentNoteId] = useState<string | null>(null);
  const [allNotes, setAllNotes] = useState<NoteTreeItem[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [pageCommentCount, setPageCommentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [fullWidth, setFullWidth] = useState(false);
  const [font, setFont] = useState<NoteFont>("default");
  const [smallFont, setSmallFont] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recoveryDraft, setRecoveryDraft] = useState<StoredNoteDraft | null>(null);
  const [saveConflict, setSaveConflict] = useState<SaveConflict | null>(null);
  const [contentLinkStates, setContentLinkStates] = useState<Record<string, InternalLinkStateRow>>({});
  // 轻量内联提示（拷贝链接/内容成功等），不依赖全局 Toast。
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const draftRef = useRef<NoteDraft>({
    title: "",
    content: null,
    icon: null,
    cover_url: null,
    cover_position: 50,
    parent_note_id: null,
    full_width: false,
    font_family: "default",
    small_font: false,
  });
  const dirtyRef = useRef(false);
  // 最近一次内容变更的来源（user / hydrate / remote-sync / version-restore / backup-restore）
  const lastSourceRef = useRef<TransactionSource>("user");
  // notes.content_revision（G1 乐观锁），双链 RPC 保存时用
  const contentRevisionRef = useRef(0);
  const userIdRef = useRef<string | null>(null);
  const savingPromiseRef = useRef<Promise<void> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  // 编辑器实例（state 版）：供顶栏附件面板等按编辑器就绪重渲染的组件消费
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  // X1 离线同步：网络状态 + 未同步改动标记 + 自动重试计时
  const online = useOnlineStatus();
  const [offlinePending, setOfflinePending] = useState(false);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  // 幂等键缓存：同一内容批次的重试复用同一 mutation_id（防响应丢失造成重复写入/假冲突）
  const lastAttemptRef = useRef<{ draft: NoteDraft; mutationId: string } | null>(null);

  const loadNoteTree = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("notes")
      .select("id, title, icon, parent_note_id, updated_at")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });
    setAllNotes(
      (data || []).map((note) => ({
        id: note.id,
        title: note.title || null,
        icon: note.icon || null,
        parent_note_id: note.parent_note_id || null,
        updated_at: note.updated_at,
      }))
    );
  }, [supabase]);

  // 加载笔记
  useEffect(() => {
    let active = true;
    async function loadNote() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      userIdRef.current = user.id;
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("id", noteId)
        .eq("user_id", user.id)
        .single();

      if (!active) return;
      if (!error && data) {
        const loadedTitle = data.title || "";
        const loadedContent = data.content || { type: "doc", content: [{ type: "paragraph" }] };
        const dbFullWidth = data.full_width === true;
        const dbFont: NoteFont =
          data.font_family === "serif" || data.font_family === "mono" ? data.font_family : "default";
        const dbSmallFont = data.small_font === true;
        setTitle(loadedTitle);
        setContent(loadedContent);
        setCreatedAt(data.created_at || null);
        setReadingItemId(data.reading_item_id || null);
        setIcon(data.icon || null);
        setCoverUrl(data.cover_url || null);
        setCoverPosition(Number(data.cover_position ?? 50));
        setParentNoteId(data.parent_note_id || null);
        setFullWidth(dbFullWidth);
        setFont(dbFont);
        setSmallFont(dbSmallFont);
        contentRevisionRef.current = Number(data.content_revision ?? 0);
        const remoteDraft: NoteDraft = {
          title: loadedTitle,
          content: loadedContent,
          icon: data.icon || null,
          cover_url: data.cover_url || null,
          cover_position: Number(data.cover_position ?? 50),
          parent_note_id: data.parent_note_id || null,
          full_width: dbFullWidth,
          font_family: dbFont,
          small_font: dbSmallFont,
        };
        draftRef.current = remoteDraft;

        const localDraft = readLocalNoteDraft(localStorage, user.id, noteId);
        if (localDraft) {
          if (areNoteDraftsEqual(localDraft.draft, remoteDraft)) {
            clearLocalNoteDraft(localStorage, user.id, noteId);
          } else {
            setRecoveryDraft(localDraft);
          }
        }

        // 一次性幂等迁移：DB 是默认值且 localStorage 有旧值时，搬入 DB。
        // 成功后 DB 非默认，下次加载条件自动不成立，不会重复迁移。
        try {
          const lw = localStorage.getItem(fullWidthKey(noteId));
          const f = localStorage.getItem(fontKey(noteId));
          const sf = localStorage.getItem(smallFontKey(noteId));
          const hasLocal = lw !== null || f !== null || sf !== null;
          const dbIsDefault = !dbFullWidth && dbFont === "default" && !dbSmallFont;
          if (hasLocal && dbIsDefault) {
            const patch: Partial<Pick<NoteDraft, "full_width" | "font_family" | "small_font">> = {};
            if (lw !== null) {
              const v = lw === "1";
              patch.full_width = v;
              setFullWidth(v);
            }
            if (f === "serif" || f === "mono" || f === "default") {
              patch.font_family = f;
              setFont(f);
            }
            if (sf !== null) {
              const v = sf === "1";
              patch.small_font = v;
              setSmallFont(v);
            }
            Object.assign(draftRef.current, patch);
            dirtyRef.current = true;
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(() => void flushSave(), 500);
          }
        } catch {
          /* localStorage 不可用时跳过迁移 */
        }
      }
      setLoading(false);
      void loadNoteTree();
    }
    void loadNote();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flushSave 仅用于一次性 localStorage→DB 迁移的延迟落盘，加入会导致 mount 重复
  }, [loadNoteTree, noteId, supabase]);

  useEffect(() => {
    const reload = () => void loadNoteTree();
    window.addEventListener("organize:notes-changed", reload);
    return () => window.removeEventListener("organize:notes-changed", reload);
  }, [loadNoteTree]);

  useEffect(() => {
    let active = true;
    const links = extractLinksFromContent(content);
    const noteIds = links.filter((link) => link.type === "note").map((link) => link.url);
    const readingIds = links.filter((link) => link.type === "reading").map((link) => link.url);
    if (noteIds.length === 0 && readingIds.length === 0) {
      setContentLinkStates({});
      return () => {
        active = false;
      };
    }

    void supabase
      .rpc("get_note_content_link_states", {
        p_note_ids: noteIds,
        p_reading_item_ids: readingIds,
      })
      .then(({ data, error }) => {
        if (!active || error || !data) return;
        setContentLinkStates(
          (data as InternalLinkStateRow[]).reduce<Record<string, InternalLinkStateRow>>(
            (states, row) => {
              states[internalLinkKey(row.resource_type, row.resource_id)] = row;
              return states;
            },
            {}
          )
        );
      });

    return () => {
      active = false;
    };
  }, [content, supabase]);

  // G2 反向同步（任务→笔记）：订阅 tasks 表变更，任务状态变了→回勾笔记里对应块。
  // 仅双链开启时生效。注意：editorRef 在 onEditorReady 时才赋值，可能晚于本 effect，
  // 所以不在 effect 顶部 early-return，而是在 applyTaskStatus 内动态读 editorRef.current。
  useEffect(() => {
    if (!isTaskNoteLinkEnabled()) return;

    // 把某 task 状态回写到编辑器里所有同 taskId 的 taskItem（checked = status==='done'）
    const applyTaskStatus = (taskId: string, status: string) => {
      const e = editorRef.current;
      if (!e) return;
      const checked = status === "done";
      let changed = false;
      const tr = e.state.tr;
      e.state.doc.descendants((node, pos) => {
        if (node.type.name === "taskItem" && node.attrs.taskId === taskId && node.attrs.checked !== checked) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
          changed = true;
        }
        return true;
      });
      if (changed) {
        // 系统事务：标 remote-sync，不激活、不进 Undo
        tr.setMeta("transactionSource", "remote-sync");
        tr.setMeta("addToHistory", false);
        e.view.dispatch(tr);
      }
    };

    // 反向同步（任务→笔记）：轮询拉取该笔记涉及的 task 状态对齐 checked。
    // 注意：本地 Supabase dev 的 Realtime 有 signature_error 已知问题（订阅到 SUBSCRIBED 但收不到事件），
    // 生产环境才稳；故本地用轮询（3秒），保证 dev 和生产都能工作。
    const syncFromTasks = async () => {
      const { data: refs } = await supabase
        .from("task_item_refs")
        .select("task_id, tasks!inner(status)")
        .eq("note_id", noteId);
      if (!refs) return;
      for (const r of refs as any[]) {
        const status = r.tasks?.status;
        if (status) applyTaskStatus(r.task_id, status);
      }
    };
    void syncFromTasks();
    const timer = setInterval(() => void syncFromTasks(), 3000);

    return () => clearInterval(timer);
  }, [noteId, supabase]);

  useEffect(() => {
    let active = true;
    void supabase
      .from("note_comment_threads")
      .select("id, resolved_at")
      .eq("note_id", noteId)
      .eq("block_id", "__page__")
      .then(({ data }) => {
        if (!active) return;
        setPageCommentCount(
          (data || []).filter((thread) => !thread.resolved_at).length
        );
      });
    return () => {
      active = false;
    };
  }, [noteId, supabase]);

  const persistCurrentDraft = useCallback((baseRevision = contentRevisionRef.current) => {
    const userId = userIdRef.current;
    if (!userId) return;
    writeLocalNoteDraft(localStorage, userId, noteId, baseRevision, {
      ...draftRef.current,
    });
  }, [noteId]);

  // 所有保存统一走带 revision 的原子 RPC，并串行排空保存期间产生的后续改动。
  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    // 刚执行过"恢复历史版本"：本地草稿已被服务端快照替代，跳过兜底保存，
    // 否则卸载时的 flushSave 会把旧草稿写回，盖掉刚恢复的内容。
    try {
      if (sessionStorage.getItem(`organize:skip-flush:${noteId}`)) {
        sessionStorage.removeItem(`organize:skip-flush:${noteId}`);
        dirtyRef.current = false;
        const userId = userIdRef.current;
        if (userId) clearLocalNoteDraft(localStorage, userId, noteId);
        return;
      }
    } catch { /* sessionStorage 不可用时按正常流程 */ }
    if (savingPromiseRef.current) return savingPromiseRef.current;
    const promise = (async () => {
      setSaving(true);
      setSaveError("");
      // X1：离线时不发起 RPC（必然失败），保留草稿等 online 事件触发同步；
      // 顶栏离线角标负责可见反馈，不占用 saveError。
      if (!isOnline()) {
        if (dirtyRef.current) {
          persistCurrentDraft();
          setOfflinePending(true);
        }
        return;
      }
      while (dirtyRef.current) {
        dirtyRef.current = false;
        const snapshot = { ...draftRef.current };
        const { mutations } =
          isTaskNoteLinkEnabled() && lastSourceRef.current === "user"
            ? extractTaskMutations(snapshot.content)
            : { mutations: [] };
        // 幂等键：与上次尝试的内容一致（自动重试场景）时复用同一 mutation_id，
        // 服务端 save_mutation_log 命中直接返回上次结果，不会重复写入或误报冲突。
        const lastAttempt = lastAttemptRef.current;
        const mutationId =
          lastAttempt && areNoteDraftsEqual(lastAttempt.draft, snapshot)
            ? lastAttempt.mutationId
            : crypto.randomUUID();
        lastAttemptRef.current = { draft: snapshot, mutationId };
        const { data: rpcResult, error: rpcErr } = await supabase.rpc("save_note_with_tasks", {
          p_note_id: noteId,
          p_content: snapshot.content,
          p_expected_note_revision: contentRevisionRef.current,
          p_title: snapshot.title,
          p_task_mutations: mutations.length > 0 ? mutations : null,
          // 前端尚未维护任务 sync_version 缓存，传 null 只对笔记执行乐观锁。
          p_expected_task_revisions: null,
          p_mutation_id: mutationId,
          p_note_snapshot: snapshot,
        });
        const result = rpcResult as {
          status?: string;
          note_revision?: number;
          current_revision?: number;
          task_id?: string;
        } | null;
        const status = result?.status;

        if (status === "conflict_note" || status === "conflict_task") {
          dirtyRef.current = true;
          persistCurrentDraft();
          const { data: remote } = await supabase
            .from("notes")
            .select("*")
            .eq("id", noteId)
            .single();
          const remoteDraft: NoteDraft | null = remote
            ? {
                title: remote.title || "",
                content: remote.content || null,
                icon: remote.icon || null,
                cover_url: remote.cover_url || null,
                cover_position: Number(remote.cover_position ?? 50),
                parent_note_id: remote.parent_note_id || null,
                full_width: remote.full_width === true,
                font_family:
                  remote.font_family === "serif" || remote.font_family === "mono"
                    ? remote.font_family
                    : "default",
                small_font: remote.small_font === true,
              }
            : null;
          setSaveConflict({
            kind: status === "conflict_note" ? "note" : "task",
            currentRevision:
              typeof result?.current_revision === "number"
                ? result.current_revision
                : remote
                  ? Number(remote.content_revision ?? 0)
                  : null,
            taskId: result?.task_id,
            remoteDraft,
            remoteUpdatedAt: remote?.updated_at || null,
          });
          setSaveError("检测到其他位置的修改，请处理保存冲突");
          break;
        }

        if (rpcErr || status !== "ok" || typeof result?.note_revision !== "number") {
          dirtyRef.current = true;
          persistCurrentDraft();
          // X1：失败分类——网络错误自动重试（指数退避）/离线等 online 事件/其他错误不自动重试
          const action = planSaveFailure({
            error: rpcErr,
            retries: retryCountRef.current,
            online: isOnline(),
          });
          if (action.type === "retry") {
            retryCountRef.current += 1;
            setOfflinePending(true);
            setSaveError(
              `网络异常，${Math.round(action.delayMs / 1000)} 秒后自动重试（第 ${retryCountRef.current} 次）`
            );
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              void flushSaveRef.current?.();
            }, action.delayMs);
          } else if (action.type === "wait-online") {
            setOfflinePending(true);
            setSaveError("");
          } else {
            setSaveError("保存失败，本地草稿已保留，请检查网络后重试");
          }
          break;
        }
        // 成功：复位重试状态与离线标记
        retryCountRef.current = 0;
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        setOfflinePending(false);
        contentRevisionRef.current = result.note_revision;
        setSaveConflict(null);
        setLastSaved(new Date());
        if (!dirtyRef.current && areNoteDraftsEqual(draftRef.current, snapshot)) {
          const userId = userIdRef.current;
          if (userId) clearLocalNoteDraft(localStorage, userId, noteId);
        }
        window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      }
    })().finally(() => {
      setSaving(false);
      savingPromiseRef.current = null;
    });
    savingPromiseRef.current = promise;
    return promise;
  }, [noteId, persistCurrentDraft, supabase]);

  // X1：flushSave 的最新引用，供重试定时器 / online 事件回调安全调用
  const flushSaveRef = useRef<typeof flushSave | null>(null);
  useEffect(() => {
    flushSaveRef.current = flushSave;
  }, [flushSave]);

  // X1：联网后立即同步未保存改动；离线时若有改动则展示待同步标记
  useEffect(() => {
    if (online) {
      if (dirtyRef.current) void flushSaveRef.current?.();
    } else if (dirtyRef.current) {
      setOfflinePending(true);
    }
  }, [online]);

  // X1：卸载时清理重试定时器（保存本身的 pagehide/unmount 兜底在下方 effect）
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const queueSave = useCallback(() => {
    dirtyRef.current = true;
    persistCurrentDraft();
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => void flushSave(), 900);
  }, [flushSave, persistCurrentDraft]);

  const applyDraftToPage = useCallback((draft: NoteDraft) => {
    setTitle(draft.title);
    setContent(draft.content);
    setIcon(draft.icon);
    setCoverUrl(draft.cover_url);
    setCoverPosition(draft.cover_position);
    setParentNoteId(draft.parent_note_id);
    setFullWidth(draft.full_width);
    setFont(draft.font_family);
    setSmallFont(draft.small_font);
    draftRef.current = { ...draft };
    lastSourceRef.current = "user";
    editorRef.current?.commands.setContent(
      draft.content || { type: "doc", content: [{ type: "paragraph" }] },
      false
    );
  }, []);

  const restoreLocalDraft = useCallback(() => {
    if (!recoveryDraft) return;
    contentRevisionRef.current = recoveryDraft.baseRevision;
    applyDraftToPage(recoveryDraft.draft);
    setRecoveryDraft(null);
    queueSave();
  }, [applyDraftToPage, queueSave, recoveryDraft]);

  const discardLocalDraft = useCallback(() => {
    const userId = userIdRef.current;
    if (userId) clearLocalNoteDraft(localStorage, userId, noteId);
    setRecoveryDraft(null);
  }, [noteId]);

  const reloadRemoteVersion = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    dirtyRef.current = false;
    const userId = userIdRef.current;
    if (userId) clearLocalNoteDraft(localStorage, userId, noteId);
    setSaveConflict(null);
    window.location.reload();
  }, [noteId]);

  const overwriteRemoteVersion = useCallback(() => {
    if (!saveConflict || saveConflict.currentRevision === null) return;
    contentRevisionRef.current = saveConflict.currentRevision;
    setSaveConflict(null);
    setSaveError("");
    dirtyRef.current = true;
    persistCurrentDraft(saveConflict.currentRevision);
    void flushSave();
  }, [flushSave, persistCurrentDraft, saveConflict]);

  const keepLocalCopy = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaveError("未登录，无法保留副本");
      return;
    }
    const snapshot = { ...draftRef.current };
    const { data, error } = await supabase
      .from("notes")
      .insert({
        user_id: user.id,
        ...snapshot,
        title: snapshot.title ? `${snapshot.title}（冲突副本）` : "冲突副本",
      })
      .select("id")
      .single();
    if (error || !data) {
      setSaveError("创建本地副本失败，请重试");
      return;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    dirtyRef.current = false;
    clearLocalNoteDraft(localStorage, user.id, noteId);
    setSaveConflict(null);
    router.push(`/notes/${data.id}`);
  }, [noteId, router, supabase]);

  const updatePageMetadata = useCallback(
    (patch: Partial<Pick<NoteDraft, "icon" | "cover_url" | "cover_position" | "parent_note_id">>) => {
      if ("icon" in patch) setIcon(patch.icon ?? null);
      if ("cover_url" in patch) setCoverUrl(patch.cover_url ?? null);
      if ("cover_position" in patch) setCoverPosition(patch.cover_position ?? 50);
      if ("parent_note_id" in patch) setParentNoteId(patch.parent_note_id ?? null);
      Object.assign(draftRef.current, patch);
      setAllNotes((notes) =>
        notes.map((note) =>
          note.id === noteId
            ? {
                ...note,
                icon: "icon" in patch ? patch.icon ?? null : note.icon,
                parent_note_id:
                  "parent_note_id" in patch
                    ? patch.parent_note_id ?? null
                    : note.parent_note_id,
              }
            : note
        )
      );
      queueSave();
    },
    [noteId, queueSave]
  );

  useEffect(() => {
    const handlePageHide = () => void flushSave();
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      void flushSave();
    };
  }, [flushSave]);

  // 标题始终是不含换行的单字符串（T3）：把粘贴进来的换行折叠成空格。
  const handleTitleChange = (raw: string) => {
    const newTitle = raw.replace(/\s*\n\s*/g, " ");
    setTitle(newTitle);
    draftRef.current.title = newTitle;
    setAllNotes((notes) =>
      notes.map((note) => (note.id === noteId ? { ...note, title: newTitle } : note))
    );
    queueSave();
  };

  // 标题自动增高：支持超长标题换行、随内容增高（T3）。
  const autoGrowTitle = useCallback(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    autoGrowTitle();
  }, [title, fullWidth, loading, autoGrowTitle]);

  // T1/T2：在标题里按回车，把拆分点之后的文字迁移到正文顶部的新段落。
  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    // 输入法组合态下回车只是确认候选词，不触发拆分。
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();

    const el = event.currentTarget;
    // 选区起点作为拆分点：选中内容连同其后文字一并进入正文（不静默丢字）。
    const splitAt = el.selectionStart ?? title.length;
    const before = title.slice(0, splitAt);
    const after = title.slice(splitAt);

    setTitle(before);
    draftRef.current.title = before;
    setAllNotes((notes) =>
      notes.map((note) => (note.id === noteId ? { ...note, title: before } : note))
    );

    const editor = editorRef.current;
    if (editor) {
      const first = editor.state.doc.firstChild;
      const firstIsEmptyParagraph = first?.type.name === "paragraph" && first.content.size === 0;
      if (after.length === 0 && firstIsEmptyParagraph) {
        // 正文顶部已是可直接进入的空段落，复用它，避免堆叠多个空块。
        editor.chain().focus("start").run();
      } else {
        // 在正文最前面插入新段落，旧内容整体顺延；光标落在迁移文字末尾。
        editor
          .chain()
          .insertContentAt(0, {
            type: "paragraph",
            content: after ? [{ type: "text", text: after }] : [],
          })
          .setTextSelection(1 + after.length)
          .focus()
          .run();
      }
    }

    queueSave();
  };

  const toggleFullWidth = () => {
    const next = !fullWidth;
    setFullWidth(next);
    draftRef.current.full_width = next;
    queueSave();
  };

  const changeFont = (next: NoteFont) => {
    setFont(next);
    draftRef.current.font_family = next;
    queueSave();
  };

  const toggleSmallFont = () => {
    const next = !smallFont;
    setSmallFont(next);
    draftRef.current.small_font = next;
    queueSave();
  };

  // 轻量内联提示：显示一条短消息，2 秒后自动消失。
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // ⌘/Ctrl+S 立即保存（编辑器内也生效，阻止浏览器默认"保存网页"弹窗）
  useHotkey([
    {
      key: "s",
      metaKey: true,
      ctrlKey: false,
      allowInInput: true,
      handler: () => { void flushSave().then(() => showToast("已保存")); },
    },
    {
      key: "s",
      ctrlKey: true,
      metaKey: false,
      allowInInput: true,
      handler: () => { void flushSave().then(() => showToast("已保存")); },
    },
  ]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("已复制链接");
    } catch {
      showToast("复制失败，请手动复制地址栏链接");
    }
  }, [showToast]);

  const copyContent = useCallback(async () => {
    // 优先使用编辑器当前内容（draftRef 由 onUpdate 实时同步），回退到初始 content
    const json = editorRef.current?.getJSON?.() ?? draftRef.current.content ?? content ?? null;
    const result = await copyNoteContent(title, json);
    if (result.success) {
      showToast(result.usedFallback ? "已复制页面内容（纯文本）" : "已复制页面内容");
    } else {
      showToast("复制失败");
    }
  }, [title, content, showToast]);

  const duplicateNote = useCallback(async () => {
    // 创建副本前先把当前改动落库，保证副本拿到最新内容。
    await flushSave();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        showToast("未登录，无法创建副本");
        return;
      }
      const { data, error } = await supabase
        .from("notes")
        .insert({
          user_id: user.id,
          title: title ? `${title} 副本` : "无标题笔记 副本",
          content: draftRef.current.content ?? content,
          icon,
          cover_url: coverUrl,
          cover_position: coverPosition,
          parent_note_id: parentNoteId,
          full_width: fullWidth,
          font_family: font,
          small_font: smallFont,
        })
        .select()
        .single();
      if (error || !data) {
        showToast("创建副本失败");
        return;
      }
      // 软导航到副本，保住 mock 后端的内存数据。
      router.push(`/notes/${data.id}`);
    } catch {
      showToast("创建副本失败");
    }
  }, [
    flushSave,
    supabase,
    title,
    content,
    icon,
    coverUrl,
    coverPosition,
    parentNoteId,
    router,
    showToast,
    fullWidth,
    font,
    smallFont,
  ]);

  /** 导出当前页为 Markdown（先落库保证导出最新内容） */
  const exportMarkdown = useCallback(async () => {
    await flushSave();
    exportNoteToMarkdown(noteId, title || undefined);
  }, [flushSave, noteId, title]);

  /** 删除当前页（移入垃圾箱，可恢复） */
  const deleteNote = useCallback(async () => {
    if (!window.confirm("将这篇笔记移入垃圾箱？")) return;
    try {
      await mutateTrash("note", [noteId], "soft_delete");
      router.push("/notes");
    } catch {
      showToast("删除失败");
    }
  }, [noteId, router, showToast]);

  /** 移动笔记：先更新本地状态，再交给统一 revision 保存处理。 */
  const handleMove = useCallback(
    async (nextParentId: string | null) => {
      if (nextParentId === parentNoteId) return;
      setParentNoteId(nextParentId);
      draftRef.current.parent_note_id = nextParentId;
      setAllNotes((notes) =>
        notes.map((n) =>
          n.id === noteId ? { ...n, parent_note_id: nextParentId } : n
        )
      );
      window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      queueSave();
    },
    [noteId, parentNoteId, queueSave]
  );

  const handleContentUpdate = (newContent: Record<string, unknown>, source: TransactionSource) => {
    setContent(newContent);
    draftRef.current.content = newContent;
    // 记录本次变更来源，供 flushSave 在 G2 后续逻辑里区分：
    // user → 走原子 RPC(激活 legacy / 生成 task mutation)；系统事务 → 跳过任务激活。
    lastSourceRef.current = source;
    queueSave();

    // G2 legacy 激活：双链开 + user-edit 时，给无 taskId 的 taskItem 建任务回填 taskId。
    // 系统事务(hydrate/远端/版本/备份恢复)不激活——见 docs/g0-protocol.md §4。
    if (isTaskNoteLinkEnabled() && source === "user") {
      void activateLegacyTaskItems(newContent);
    }
  };

  /** 扫描 content 里无 taskId 的 taskItem，批量建任务并回填 taskId 到编辑器节点。 */
  const activateLegacyTaskItems = async (doc: Record<string, unknown>) => {
    const editor = editorRef.current;
    if (!editor) return;
    // 收集所有 legacy taskItem 的 {pos, blockId, title, checked}。
    // 注意：运行时新插入的 taskItem 可能 attrs 里没有 id（block id），
    // UniqueID 扩展只在 mount 时给历史 JSON 补 id，不会给新插入节点补。
    // 所以这里若无 id，先生成一个，随 taskId 一起回填。
    const genBlockId = () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `block-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const legacy: { pos: number; blockId: string; title: string; checked: boolean }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "taskItem" && !node.attrs.taskId) {
        let title = "";
        node.forEach((child) => {
          if (child.type.name === "paragraph") {
            title = child.textContent || "";
            return false;
          }
          return true;
        });
        legacy.push({ pos, blockId: String(node.attrs.id || genBlockId()), title: title || "未命名任务", checked: node.attrs.checked === true });
      }
      return true;
    });
    if (legacy.length === 0) return;
    // 超 20 项先不自动激活（任务书：超过 20 项先预览确认；此处先跳过，后续 G3 加预览 UI）
    if (legacy.length > 20) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 批量建任务，拿回 taskId
    const inserts = legacy.map((l) => ({
      user_id: user.id,
      title: l.title,
      status: l.checked ? "done" : "todo",
      reference_managed: true,
    }));
    const { data: created, error } = await supabase.from("tasks").insert(inserts).select("id").returns<{ id: string }[]>();
    if (error || !created || created.length !== legacy.length) return;

    // 回填 taskId（及缺失的 block id）到编辑器节点（setNodeMarkup，触发新一次 onUpdate——
    // 此时已有 taskId，flushSave 的 RPC 会建 task_item_refs）。标 source='hydrate' 避免回填本身再触发激活循环。
    const tr = editor.state.tr;
    legacy.forEach((l, i) => {
      const node = editor.state.doc.nodeAt(l.pos);
      if (node && node.type.name === "taskItem") {
        // 同时补 block id（若无），taskId 来自新建的任务
        tr.setNodeMarkup(l.pos, undefined, { ...node.attrs, id: l.blockId, taskId: created[i].id });
      }
    });
    tr.setMeta("transactionSource", "hydrate");
    tr.setMeta("addToHistory", false); // 激活回填不进 Undo（系统操作）
    editor.view.dispatch(tr);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!content) {
    return (
      <EmptyState
        icon={FileText}
        title="笔记不存在"
        description="笔记可能已被删除或链接无效"
        action={
          <Link href="/notes">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              返回笔记列表
            </Button>
          </Link>
        }
      />
    );
  }

  const contentClassName = fullWidth
    ? "mx-auto w-full max-w-none px-4 md:px-10"
    : "mx-auto w-full max-w-3xl px-4 md:px-6";

  return (
    <div
      className={cn(
        "note-page mx-auto max-w-none",
        font === "serif" && "note-page-serif",
        font === "mono" && "note-page-mono",
        smallFont && "note-page-small"
      )}
    >
      {/* Notion 风格顶栏：全宽吸顶 */}
      <div className="note-topbar">
        <div className="note-topbar-inner">
          <div className="note-topbar-group note-topbar-nav">
            <Link href="/notes" className="note-topbar-back" title="返回笔记列表">
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">返回</span>
            </Link>
            <NoteHierarchyBar
              noteId={noteId}
              title={title}
              icon={icon}
              parentNoteId={parentNoteId}
              notes={allNotes}
              onParentChange={(nextParentId) =>
                updatePageMetadata({ parent_note_id: nextParentId })
              }
            />
          </div>
          <div className="note-topbar-group note-topbar-actions">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {!online && (
                <span className="flex items-center gap-1" role="status">
                  <WifiOff className="h-3 w-3" />
                  离线中{offlinePending ? " · 更改将在联网后同步" : ""}
                </span>
              )}
              {saveError ? (
                <span className="text-destructive">{saveError}</span>
              ) : saving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  保存中...
                </>
              ) : lastSaved ? (
                <>
                  <Check className="h-3 w-3 text-green-500" />
                  已保存 {lastSaved.toLocaleTimeString("zh-CN")}
                </>
              ) : null}
            </div>
            <FavoriteButton targetType="note" targetId={noteId} />
            <NoteAttachmentsButton editor={editorInstance} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShareDialogOpen(true)}
              title="分享"
            >
              <Share2 className="h-4 w-4" />
            </Button>
            <NotePageMenu
              fullWidth={fullWidth}
              onToggleFullWidth={toggleFullWidth}
              font={font}
              onFontChange={changeFont}
              smallFont={smallFont}
              onToggleSmallFont={toggleSmallFont}
              onCopyLink={copyLink}
              onCopyContent={copyContent}
              onDuplicate={duplicateNote}
              onMove={() => setMoveDialogOpen(true)}
              onShowHistory={() => setHistoryOpen(true)}
              onExport={() => void exportMarkdown()}
              onDelete={() => void deleteNote()}
            />
          </div>
        </div>
      </div>

      <NotePageVisuals
        noteId={noteId}
        contentClassName={contentClassName}
        icon={icon}
        coverUrl={coverUrl}
        coverPosition={coverPosition}
        commentsOpen={commentsOpen}
        commentCount={pageCommentCount}
        onIconChange={(nextIcon) => updatePageMetadata({ icon: nextIcon })}
        onCoverChange={(nextCover) =>
          updatePageMetadata({ cover_url: nextCover })
        }
        onCoverPositionChange={(nextPosition) =>
          updatePageMetadata({ cover_position: nextPosition })
        }
        onToggleComments={() => setCommentsOpen((open) => !open)}
        onError={showToast}
      />

      <div className={cn(contentClassName, "note-page-main pt-2")}>
        {/* 标题：自动增高、不限长度；回车执行 T1/T2 而非插入换行 */}
        <textarea
          ref={titleRef}
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onKeyDown={handleTitleKeyDown}
          onInput={autoGrowTitle}
          placeholder="笔记标题"
          rows={1}
          className="note-title w-full resize-none overflow-hidden break-words bg-transparent px-0 py-2 text-2xl font-bold leading-tight outline-none placeholder:text-muted-foreground"
        />

        {/* 创建时间 */}
        {createdAt && (
          <div className="note-meta-row flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            创建于 {new Date(createdAt).toLocaleDateString("zh-CN")}
          </div>
        )}

        {/* 关联任务横幅：有待办指向本笔记时显示回跳入口 */}
        <LinkedTaskBanner noteId={noteId} />

        {commentsOpen && (
          <NotePageComments
            noteId={noteId}
            onCountChange={setPageCommentCount}
          />
        )}

        {/* 编辑器 */}
        <TipTapEditor
          key={noteId}
          noteId={noteId}
          noteTitle={title}
          content={content}
          onUpdate={handleContentUpdate}
          noteTree={allNotes}
          internalLinkStates={contentLinkStates}
          onEditorReady={(editor) => {
            editorRef.current = editor;
            setEditorInstance(editor);
          }}
        />

        <NoteChildPages noteId={noteId} notes={allNotes} />

        {/* 反向链接 & 关联阅读 */}
        <Backlinks noteId={noteId} readingItemId={readingItemId} />
      </div>

      {/* 轻量内联提示 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      <Dialog open={recoveryDraft !== null} onOpenChange={() => {}}>
        <DialogContent hideCloseButton>
          <DialogHeader>
            <DialogTitle>发现未保存的本地草稿</DialogTitle>
            <DialogDescription>
              上次编辑可能因断网或页面意外关闭而未保存。请选择恢复草稿或使用服务器版本。
            </DialogDescription>
          </DialogHeader>
          {recoveryDraft && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{recoveryDraft.draft.title || "无标题"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                本地修改于 {new Date(recoveryDraft.updatedAt).toLocaleString("zh-CN")}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={discardLocalDraft}>
              使用服务器版本
            </Button>
            <Button onClick={restoreLocalDraft}>恢复本地草稿</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saveConflict !== null} onOpenChange={() => {}}>
        <DialogContent hideCloseButton>
          <DialogHeader>
            <DialogTitle>笔记存在保存冲突</DialogTitle>
            <DialogDescription>
              另一页面或设备已修改这篇笔记。当前内容没有丢失，并已保存在本地。
            </DialogDescription>
          </DialogHeader>
          {saveConflict && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
                <p className="text-xs font-medium text-muted-foreground">当前本地版本</p>
                <p className="mt-1 truncate text-sm font-medium">
                  {draftRef.current.title || "无标题"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  内容大小 {JSON.stringify(draftRef.current.content || {}).length} 字符
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs font-medium text-muted-foreground">服务器版本</p>
                <p className="mt-1 truncate text-sm font-medium">
                  {saveConflict.remoteDraft?.title || "无标题"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  内容大小 {JSON.stringify(saveConflict.remoteDraft?.content || {}).length} 字符
                  {saveConflict.remoteUpdatedAt
                    ? ` · ${new Date(saveConflict.remoteUpdatedAt).toLocaleString("zh-CN")}`
                    : ""}
                </p>
              </div>
            </div>
          )}
          {saveConflict?.kind === "task" && (
            <p className="text-xs text-destructive">
              关联任务已被删除或发生变化，无法安全覆盖。请保留副本或重新加载服务器版本。
            </p>
          )}
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button variant="outline" onClick={reloadRemoteVersion}>
              重新加载服务器版本
            </Button>
            <Button variant="outline" onClick={() => void keepLocalCopy()}>
              保留为新副本
            </Button>
            {saveConflict?.kind === "note" && (
              <Button variant="destructive" onClick={overwriteRemoteVersion}>
                用本地版本覆盖
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShareDialog
        resourceType="note"
        resourceId={noteId}
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
      />

      <NoteMoveDialog
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        noteId={noteId}
        noteTitle={title}
        currentParentId={parentNoteId}
        notes={allNotes}
        onConfirm={handleMove}
      />

      <NoteHistoryDialog
        noteId={noteId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  );
}
