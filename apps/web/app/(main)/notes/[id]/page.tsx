"use client";

import { useEffect, useState, useRef, useCallback, useMemo, useLayoutEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Editor } from "@tiptap/react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { TipTapEditor, type TransactionSource } from "@/components/editor/tiptap-editor";
import { NoteAttachmentsButton } from "@/components/editor/note-attachments-panel";
import { isOnline, useOnlineStatus } from "@/lib/offline/network";
import { isNetworkSaveError, planSaveFailure } from "@/lib/offline/note-sync";
import { findNoteCreate, removeNoteCreate } from "@/lib/offline/note-queue";
import { useNoteSaveSession } from "@/hooks/use-note-session";
import { useLinkedTaskSync } from "@/hooks/use-linked-task-sync";
import { deriveNotePageCapabilities } from "@/lib/notes/capabilities";
import { NoteSaveStatus } from "@/components/notes/note-save-status";
import { NoteRecoveryDialog } from "@/components/notes/note-recovery-dialog";
import { NoteConflictDialog } from "@/components/notes/note-conflict-dialog";
import {
  createSupabaseNoteSaveTransport,
  type NoteSaveConflict,
  type NoteSaveSession,
} from "@/lib/notes/note-save-session";
import { enqueueNoteDelete } from "@/lib/offline/note-delete-queue";
import { NotePageMenu } from "@/components/notes/note-page-menu";
import type { NoteFont, Tag } from "@organize/shared";
import { Backlinks } from "@/components/notes/backlinks";
import { NotePageVisuals } from "@/components/notes/note-page-visuals";
import { NotePageComments } from "@/components/notes/note-page-comments";
import { NoteHierarchyBar } from "@/components/notes/note-hierarchy-bar";
import { LinkedTaskBanner } from "@/components/notes/linked-task-banner";
import { useHotkey } from "@/lib/hooks/use-hotkey";
import { NoteChildPages } from "@/components/notes/note-child-pages";
import { NoteMoveDialog } from "@/components/notes/note-move-dialog";
import { NoteTocPanel } from "@/components/notes/note-toc-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLeft, Loader2, Check, FileText, Calendar, Share2, WifiOff, History, Tag as TagIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FavoriteButton } from "@/components/favorite-button";
import { TagSelector } from "@/components/tags/tag-selector";
import { TagBadge } from "@/components/tags/tag-badge";
import { useAllTags, useResourceTags } from "@/components/tags/use-tags";
import { ResourceShareDialog } from "@/components/share/resource-share-dialog";
import { saveRpcNameForRole, type CollabRole } from "@/lib/collab/roles";
import { useNoteCollab, colorFromUserId } from "@/hooks/use-note-collab";
import { NotePresenceBar } from "@/components/notes/note-presence-bar";
import { NoteHistoryPanel, type NoteVersionMeta } from "@/components/notes/note-history-panel";
import { NoteHistoryPreview } from "@/components/notes/note-history-preview";
import { clearLocalNoteDraftForNote } from "@/lib/notes/local-draft";
import { downloadNoteExport } from "@/lib/export/note-export";
import { mutateTrash } from "@/lib/trash/client";
import { appEvents } from "@/lib/plugin/events";
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
const tocKeyFor = (id: string) => `organize:note:${id}:toc`;

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
// 冲突类型由保存会话提供（含 066 last_edit_by 归因）
type SaveConflict = NoteSaveConflict;

export default function NoteEditorPage() {
  const params = useParams();
  const router = useRouter();
  const noteId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  // 页面属性：标签（note_tags，经 /api/notes/[id]/tags 增删，hook 内乐观更新）
  const { tags: allTagOptions, refresh: refreshAllTags } = useAllTags();
  const { tags: noteTags, addTag: addNoteTag, removeTag: removeNoteTag } = useResourceTags("note", noteId);
  // 展示用补全颜色：GET /api/notes/[id]/tags 只回 id/name，颜色从全量标签对齐
  const displayNoteTags = useMemo(
    () =>
      noteTags.map((t) => ({
        ...t,
        color: t.color ?? allTagOptions.find((o) => o.id === t.id)?.color,
      })),
    [noteTags, allTagOptions]
  );

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
  /** 加载失败原因：not-found=在线确认不存在；offline=离线导致查询失败（服务器可能有数据） */
  const [loadFailure, setLoadFailure] = useState<"not-found" | "offline" | null>(null);
  const [fullWidth, setFullWidth] = useState(true);
  const [font, setFont] = useState<NoteFont>("default");
  const [smallFont, setSmallFont] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<
    (NoteVersionMeta & { content: Record<string, unknown> | null }) | null
  >(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [recoveryDraft, setRecoveryDraft] = useState<StoredNoteDraft | null>(null);
  // 协作角色（P5-02 卡 4）：null=未判定；viewer 只读，editor 走 v2 保存，owner 走 v1 主链。
  // ref 供 flushSave 等闭包读取，避免角色变化重建保存回调打断在途保存。
  const [noteRole, setNoteRole] = useState<CollabRole | null>(null);
  const noteRoleRef = useRef<CollabRole | null>(null);
  // 实时协作会话（P5-03，ADR 0003）：显式配置 NEXT_PUBLIC_COLLAB_WS_URL 且真实后端时启用
  const collabConfigured =
    Boolean(process.env.NEXT_PUBLIC_COLLAB_WS_URL)
    && process.env.NEXT_PUBLIC_MOCK_BACKEND !== "true";
  // 协作出席/光标的身份（档案名 + 按 uid 哈希取色）；解析完成才建立会话
  const [collabUser, setCollabUser] = useState<{ name: string; color: string } | null>(null);
  const collab = useNoteCollab({
    noteId,
    enabled: collabConfigured,
    displayName: collabUser?.name ?? "",
  });
  // 传给编辑器的协作会话对象：记忆化，避免每次渲染重建导致编辑器反复重初始化
  // seedContent = DB 加载时的原始内容（编辑器挂载期的 UniqueID 回填等会把
  // content state 覆盖成空文档，不能用作空房间播种源）
  const [seedContent, setSeedContent] = useState<Record<string, unknown> | null>(null);
  const editorCollab = useMemo(
    () =>
      collab.provider && collabUser
        ? { provider: collab.provider, user: collabUser, seedContent }
        : null,
    [collab.provider, collabUser, seedContent]
  );
  const collabConnectedRef = useRef(false);
  useEffect(() => {
    collabConnectedRef.current = collab.connected && collab.synced;
  }, [collab.connected, collab.synced]);
  // 会话建立条件：ws 地址已配置 + 自己的出席身份已解析（档案名查不到回退邮箱前缀）
  useEffect(() => {
    if (!collabConfigured || collabUser) return;
    let active = true;
    void (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user || !active) return;
      let name = user.email?.split("@")[0] || "用户";
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.display_name) name = profile.display_name;
      if (active) setCollabUser({ name, color: colorFromUserId(user.id) });
    })();
    return () => {
      active = false;
    };
  }, [collabConfigured, collabUser, supabase]);
  const [contentLinkStates, setContentLinkStates] = useState<Record<string, InternalLinkStateRow>>({});
  // 轻量内联提示（拷贝链接/内容成功等），不依赖全局 Toast。
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const draftRef = useRef<NoteDraft>({
    title: "",
    content: null,
    icon: null,
    cover_url: null,
    cover_position: 50,
    parent_note_id: null,
    full_width: true,
    font_family: "default",
    small_font: false,
  });
  const userIdRef = useRef<string | null>(null);
  const editorRef = useRef<Editor | null>(null);
  // R07：保存会话（revision/mutation 幂等键/重试/冲突/排空循环全部内聚）
  const [accountId, setAccountId] = useState<string | null>(null);
  // 注水载荷用 state（ref 变化不会触发注水 effect 重跑——P0-1 修复）。
  // 携带 noteId：只在「已成功加载的笔记 === 当前笔记」时注水，防止失败路径拿旧稿注水。
  const [loadedRevision, setLoadedRevision] = useState<{ noteId: string; revision: number } | null>(null);
  const migrationRef = useRef<Partial<Pick<NoteDraft, "full_width" | "font_family" | "small_font">> | null>(null);
  // 编辑器实例（state 版）：供顶栏附件面板等按编辑器就绪重渲染的组件消费
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  // X1 离线同步：网络状态（未同步标记由保存会话派生）
  const online = useOnlineStatus();

  // R07：保存会话。accountId 就绪后创建；noteId/accountId 任一变化即换代（旧会话销毁）
  const { session: saveSession, ui: sessionUi } = useNoteSaveSession({
    noteId,
    accountId,
    draftRef,
    getRole: () => noteRoleRef.current,
    isCollabActive: () => collabConnectedRef.current,
    isOnline: () => isOnline(),
    isTaskNoteLinkEnabled,
    createTransport: () => createSupabaseNoteSaveTransport(supabase, noteId),
    consumeSkipFlush: () => {
      try {
        const key = `organize:skip-flush:${noteId}`;
        if (sessionStorage.getItem(key)) {
          sessionStorage.removeItem(key);
          return true;
        }
      } catch { /* sessionStorage 不可用时按正常流程 */ }
      return false;
    },
    onSaved: (info) => appEvents.emit("note:saved", info),
  });
  // R08.5：角色能力集中派生（真实权限收口仍在保存 RPC / RLS）
  const capabilities = deriveNotePageCapabilities(noteRole);
  // 统一派生的保存 UI 状态（旧名保留为派生常量，页面 JSX 无需改写）
  const saving = sessionUi?.phase === "saving";
  const saveError = sessionUi?.saveError ?? "";
  const lastSaved = sessionUi?.lastSavedAt ?? null;
  const saveConflict = sessionUi?.conflict ?? null;
  const offlinePending = sessionUi?.offlinePending ?? false;
  const localDraftPersistFailed = sessionUi?.localPersistence === "failed";
  const pendingSyncedBlocks = sessionUi?.pendingChildBlocks ?? 0;

  // 轻量内联提示：显示一条短消息，2 秒后自动消失。
  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2000);
  }, []);

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

  // 协作角色判定（P5-02 卡 4）：属主无需 RPC（行的 user_id 即事实）；
  // 协作者调 063 的唯一判定入口 resource_role，拿不到有效结论时按 viewer 处理
  //（宁可只读也不误写）。前端不自行推导角色。
  const resolveCollabRole = useCallback(
    async (id: string): Promise<CollabRole> => {
      const { data: role } = await supabase.rpc("resource_role", {
        p_resource_type: "note",
        p_resource_id: id,
      });
      return role === "owner" || role === "editor" || role === "viewer" ? role : "viewer";
    },
    [supabase]
  );

  // 加载笔记
  useEffect(() => {
    let active = true;
    async function loadNote() {
      // 切换笔记：保存协议状态（幂等键/重试/冲突/revision）由保存会话换代处理；
      // 旧会话已在 hook effect 中 destroy，在途保存与重试定时器全部失效
      setLoadFailure(null);
      noteRoleRef.current = null;
      setNoteRole(null);
      setSeedContent(null);
      // X1：getSession 读本地会话（无网络请求）——离线打开「待同步的离线创建笔记」
      // 时 getUser 会返回 null，导致队列回退初始化与草稿持久化（userIdRef）都不执行
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        setLoading(false);
        return;
      }
      userIdRef.current = user.id;
      setAccountId(user.id);
      // 064 RLS：属主行与「被授权共享给我」的行都能按 id 读到；不再限定 user_id，
      // 协作者打开共享笔记靠这里放行（写路径仍由保存 RPC 按角色收口）。
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .eq("id", noteId)
        .single();

      if (!active) return;
      if (!error && data) {
        const loadedRole: CollabRole =
          data.user_id === user.id ? "owner" : await resolveCollabRole(noteId);
        noteRoleRef.current = loadedRole;
        setNoteRole(loadedRole);
        const loadedTitle = data.title || "";
        const loadedContent = data.content || { type: "doc", content: [{ type: "paragraph" }] };
        setSeedContent(loadedContent);
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
        setLoadedRevision({ noteId, revision: Number(data.content_revision ?? 0) });
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
        appEvents.emit("note:opened", { noteId, title: loadedTitle });

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
        // 协作 viewer 跳过：排版偏好写不进别人的笔记，标脏只会造成永远的「未保存」。
        if (loadedRole !== "viewer") {
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
              // 会话就绪后由 hydration effect 打补丁并入队保存（一次性幂等迁移）
              migrationRef.current = patch;
            }
          } catch {
            /* localStorage 不可用时跳过迁移 */
          }
        }
      } else {
        // X1-2B：服务端查不到（尚未回放的离线创建，或离线打开）→ 用队列载荷初始化编辑器；
        // 联网后 flushSave 的「先落创建再走乐观锁保存」管线负责落库。
        const pending = findNoteCreate(localStorage, noteId);
        if (pending) {
          const pendingNote = pending.note as { title?: unknown; content?: unknown };
          const initTitle = typeof pendingNote.title === "string" ? pendingNote.title : "";
          const initContent =
            (pendingNote.content as Record<string, unknown> | null) ||
            { type: "doc", content: [{ type: "paragraph" }] };
          setTitle(initTitle);
          setContent(initContent);
          setSeedContent(initContent);
          setCreatedAt(new Date(pending.created_at).toISOString());
          setLoadedRevision({ noteId, revision: 0 });
          draftRef.current = {
            title: initTitle,
            content: initContent,
            icon: null,
            cover_url: null,
            cover_position: 50,
            parent_note_id: null,
            full_width: true,
            font_family: "default",
            small_font: false,
          };
        } else if (!isOnline()) {
          // 离线打开一篇服务器上已有的笔记：查询失败≠笔记不存在，
          // 明确告知离线不可读，联网后重新进入本页即可恢复
          setLoadFailure("offline");
        } else {
          setLoadFailure("not-found");
        }
      }
      // 版本恢复的「跳过卸载兜底」标志只该被恢复前那一次 flushSave 消费。
      // 本页加载完成后 draftRef 已与服务端一致，不清掉的话（从列表页恢复后
      // 跳转过来时标志无人消费）用户首次编辑会被它静默吞掉。
      try {
        sessionStorage.removeItem(`organize:skip-flush:${noteId}`);
      } catch { /* sessionStorage 不可用时忽略 */ }
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

  // G2 反向同步（任务→笔记）：R08 抽离至 useLinkedTaskSync——
  // 无引用笔记不产生 3 秒轮询；不可见暂停、聚焦/可见立即同步、请求不重叠
  useLinkedTaskSync({
    noteId,
    enabled: isTaskNoteLinkEnabled(),
    getEditor: () => editorRef.current,
    supabase,
  });

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

  // ---- R07：保存统一走保存会话（dirty/revision/幂等键/重试/冲突内聚于会话） ----
  const queueSave = useCallback(() => {
    saveSession?.queueSave();
  }, [saveSession]);

  const flushSave = useCallback((): Promise<boolean> => {
    if (!saveSession) return Promise.resolve(true);
    return saveSession.flushSaved();
  }, [saveSession]);

  // 会话就绪后的注水：以加载到的 revision 为乐观锁基准，并消化一次性排版迁移。
  // loadedRevision 是 state：loadNote 成功拿到数据后必然触发本 effect（P0-1 修复）。
  // 每个会话只注水一次；noteId 不匹配（失败路径残留的旧值）不注水。
  const hydratedForRef = useRef<{ session: NoteSaveSession } | null>(null);
  useEffect(() => {
    if (!saveSession) return;
    if (!loadedRevision || loadedRevision.noteId !== noteId) return;
    if (hydratedForRef.current?.session === saveSession) return;
    hydratedForRef.current = { session: saveSession };
    saveSession.hydrate(draftRef.current, loadedRevision.revision);
    const patch = migrationRef.current;
    if (patch) {
      migrationRef.current = null;
      saveSession.patchDraft(patch);
      saveSession.queueSave();
    }
    // 离线创建滞留队列：在线→立即补交创建；离线→如实点亮“待同步”（不制造 dirty）
    if (findNoteCreate(localStorage, noteId)) {
      if (isOnline()) saveSession.queueSave();
      else saveSession.markOfflinePending();
    }
  }, [saveSession, loadedRevision, draftRef, noteId]);

  // X1：联网后立即同步未保存改动（含滞留的离线创建）；断网瞬间如实点亮待同步
  useEffect(() => {
    if (!saveSession) return;
    if (online) {
      if (saveSession.isDirty() || findNoteCreate(localStorage, noteId)) void saveSession.flush();
    } else if (saveSession.isDirty()) {
      saveSession.markOfflinePending();
    }
  }, [online, noteId, saveSession]);

  // R05：同步块待同步状态聚合——存在未同步块时页面不得宣称全部已同步
  useEffect(() => {
    saveSession?.setPendingChildBlocks(0);
    const pendingMap = new Map<string, boolean>();
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ syncedId: string; pending: boolean }>).detail;
      if (!detail?.syncedId) return;
      pendingMap.set(detail.syncedId, detail.pending);
      saveSession?.setPendingChildBlocks(
        Array.from(pendingMap.values()).filter(Boolean).length
      );
    };
    window.addEventListener("organize:synced-block-status", handler);
    return () => window.removeEventListener("organize:synced-block-status", handler);
  }, [noteId, saveSession]);

  // 仅内存修改未落库时，关闭/刷新前用标准 beforeunload 提醒。
  // 只是辅助：不声称移动端关页一定能拦截；本机草稿兜底由会话的 queueSave 负责。
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!saveSession?.isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveSession]);

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
    // 就地合并（保持草稿对象身份——保存会话按身份绑定归属；整体替换会被视为切稿）
    Object.assign(draftRef.current, draft);
    editorRef.current?.commands.setContent(
      draft.content || { type: "doc", content: [{ type: "paragraph" }] },
      false
    );
  }, []);

  const restoreLocalDraft = useCallback(() => {
    if (!recoveryDraft) return;
    saveSession?.restoreDraft(recoveryDraft.draft, { baseRevision: recoveryDraft.baseRevision });
    applyDraftToPage(recoveryDraft.draft);
    setRecoveryDraft(null);
    queueSave();
  }, [applyDraftToPage, queueSave, recoveryDraft, saveSession]);

  const discardLocalDraft = useCallback(() => {
    saveSession?.discardLocalDraft();
    setRecoveryDraft(null);
  }, [saveSession]);

  const reloadRemoteVersion = useCallback(() => {
    saveSession?.resolveConflictReloadRemote();
    window.location.reload();
  }, [saveSession]);

  const overwriteRemoteVersion = useCallback(() => {
    saveSession?.resolveConflictOverwriteRemote();
  }, [saveSession]);

  const keepLocalCopy = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      showToast("未登录，无法保留副本");
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
      showToast("创建本地副本失败，请重试");
      return;
    }
    // 副本已建立：清理本会话的冲突状态与本地草稿，跳转副本页
    saveSession?.resolveConflictReloadRemote();
    router.push(`/notes/${data.id}`);
  }, [router, supabase, saveSession, showToast]);

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

  // 新建/无标题笔记：加载完成后自动聚焦标题（光标闪动），便于立即输入。
  const titleAutoFocusedRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !content || title) return;
    if (titleAutoFocusedRef.current === noteId) return;
    titleAutoFocusedRef.current = noteId;
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [loading, content, title, noteId]);

  // 顶部标签页条 / 侧边栏「最近」：笔记加载完成后及标题、图标变化时回填展示信息。
  // noteLoaded 是布尔值（而非 content 对象），避免每次击键都重复派发事件。
  const noteLoaded = !loading && content !== null;
  useEffect(() => {
    if (!noteLoaded) return;
    window.dispatchEvent(
      new CustomEvent("organize:note-tab", {
        detail: { id: noteId, title, icon },
      })
    );
  }, [noteLoaded, noteId, title, icon]);

  // 目录开关初始值：localStorage 记忆，默认关闭
  useEffect(() => {
    try {
      setTocOpen(localStorage.getItem(tocKeyFor(noteId)) === "1");
    } catch { /* 默认关闭 */ }
  }, [noteId]);

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

  // 目录开关：持久化到 localStorage（纯 UI 状态，不入库）
  const toggleToc = useCallback(() => {
    setTocOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(tocKeyFor(noteId), next ? "1" : "0");
      } catch { /* localStorage 不可用时仅内存态 */ }
      return next;
    });
  }, [noteId]);

  const closeToc = useCallback(() => {
    setTocOpen(false);
    try {
      localStorage.setItem(tocKeyFor(noteId), "0");
    } catch { /* ignore */ }
  }, [noteId]);

  // ---- 版本历史：预览 / 恢复 ----
  const selectPreviewVersion = useCallback(
    async (version: NoteVersionMeta) => {
      const { data, error } = await supabase
        .from("note_versions")
        .select("content")
        .eq("id", version.id)
        .single();
      if (error || !data) {
        showToast("加载版本失败");
        return;
      }
      setPreviewVersion({
        ...version,
        content: (data.content ?? null) as Record<string, unknown> | null,
      });
    },
    [supabase, showToast]
  );

  const exitPreview = useCallback(() => setPreviewVersion(null), []);

  const restorePreviewVersion = useCallback(async () => {
    if (!previewVersion) return;
    if (!window.confirm("恢复这个版本？当前内容会先自动保存为一个新版本（恢复可撤销）。")) return;
    const res = await fetch(`/api/notes/${noteId}/versions/${previewVersion.id}`, {
      method: "POST",
    });
    if (!res.ok) {
      showToast(`恢复失败（${res.status}）`);
      return;
    }
    try {
      // 恢复成功后整页刷新；跳过卸载时的本地草稿兜底保存，
      // 否则未落库的草稿会把刚恢复的内容盖掉
      clearLocalNoteDraftForNote(localStorage, noteId);
      sessionStorage.setItem(`organize:skip-flush:${noteId}`, "1");
    } catch { /* sessionStorage 不可用时忽略 */ }
    window.location.href = `/notes/${noteId}`;
  }, [noteId, previewVersion, showToast]);

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
      handler: () => {
        // 按保存结果如实提示：离线/冲突/失败时 flushSave 返回 false，
        // 此时顶部已有对应状态（离线角标/冲突框/错误条），toast 不再谎报"已保存"
        void flushSave().then((saved) => showToast(saved ? "已保存" : "尚未同步，请注意顶栏保存状态"));
      },
    },
    {
      key: "s",
      ctrlKey: true,
      metaKey: false,
      allowInInput: true,
      handler: () => {
        // 按保存结果如实提示：离线/冲突/失败时 flushSave 返回 false，
        // 此时顶部已有对应状态（离线角标/冲突框/错误条），toast 不再谎报"已保存"
        void flushSave().then((saved) => showToast(saved ? "已保存" : "尚未同步，请注意顶栏保存状态"));
      },
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

  /** 导出当前页为 Markdown：点击瞬间捕获本地快照，不依赖网络保存成功。
   *  同步捕获 title/content 后立即渲染下载，没有 await 间隙——
   *  即使随后快速切换笔记，也不会读到另一篇笔记的 refs。 */
  const exportMarkdown = useCallback(() => {
    const snapshot = {
      title: draftRef.current.title || title || "",
      content:
        editorRef.current?.getJSON?.() ?? draftRef.current.content ?? content ?? null,
    };
    const rendered = downloadNoteExport(snapshot);
    // 导出成功只说明下载已触发；未同步改动仍保持 dirty，不清草稿、不动冲突状态
    const warningSuffix = rendered.warnings.some((w) => w.code === "database-rows-excluded")
      ? "；数据库块仅导出引用"
      : "";
    showToast(
      (saveSession?.isDirty() ? "已导出当前内容，云端仍待同步" : "已导出当前内容") + warningSuffix
    );
  }, [content, saveSession, showToast, title]);

  /** 删除当前页（移入垃圾箱，可恢复） */
  const deleteNote = useCallback(async () => {
    if (!window.confirm("将这篇笔记移入垃圾箱？")) return;
    // 掐灭滞留的自动保存：防抖/重试定时器与 dirty 一并清除，
    // 删除瞬间之后的草稿不再发往已进垃圾箱的笔记（服务端 RPC 有软删校验兜底）。
    const suppressAutosave = () => saveSession?.suppressAutosave();
    // X1：离线删除——仍在离线创建队列里的笔记（服务端还没有）直接丢弃草稿；
    // 服务端已有笔记入删除队列，联网回放 mutate_trash RPC
    const offlineDelete = () => {
      suppressAutosave();
      window.dispatchEvent(
        new CustomEvent("organize:note-tab-remove", { detail: { id: noteId } })
      );
      if (findNoteCreate(localStorage, noteId)) {
        removeNoteCreate(localStorage, noteId);
      } else {
        enqueueNoteDelete(localStorage, noteId);
      }
      showToast("已离线删除，联网后自动同步");
      router.push("/notes");
    };
    if (!isOnline()) {
      offlineDelete();
      return;
    }
    try {
      await mutateTrash("note", [noteId], "soft_delete");
      suppressAutosave();
      window.dispatchEvent(
        new CustomEvent("organize:note-tab-remove", { detail: { id: noteId } })
      );
      // 仍在离线创建队列里的笔记（服务端还没有）：必须同步移出队列，
      // 否则联网回放会把这篇已删除的笔记重新插进服务端（列表页也会一直显示它）
      removeNoteCreate(localStorage, noteId);
      router.push("/notes");
    } catch (error) {
      // X1：网络错误按离线删除处理——入队待回放
      if (isNetworkSaveError(error)) {
        offlineDelete();
        return;
      }
      showToast("删除失败");
    }
  }, [noteId, router, saveSession, showToast]);

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
    // 来源与标脏/排空判定内聚在保存会话：remote-sync 不标脏不排队（CRDT 收敛语义）
    saveSession?.setContent(newContent, source);
    if (source !== "remote-sync") {
      queueSave();
    }

    // G2 legacy 激活：双链开 + user-edit 时，给无 taskId 的 taskItem 建任务回填 taskId。
    // 系统事务(hydrate/远端/版本/备份恢复)不激活——见 docs/g0-protocol.md §4。
    if (isTaskNoteLinkEnabled() && source === "user") {
      void activateLegacyTaskItems(newContent);
    }
  };

  /** 扫描 content 里无 taskId 的 taskItem，批量建任务并回填 taskId 到编辑器节点。
   *  加在途互斥：auth.getUser + 批量 insert 的网络窗口内，回填尚未发生，
   *  连续编辑会重复收集同一批「无 taskId」块并重复建任务（孤儿由 orphaned 回收兜底但过程脏）。 */
  const activateLegacyInFlightRef = useRef(false);
  const activateLegacyTaskItems = async (doc: Record<string, unknown>) => {
    if (activateLegacyInFlightRef.current) return;
    activateLegacyInFlightRef.current = true;
    try {
      await runLegacyActivation();
    } finally {
      activateLegacyInFlightRef.current = false;
    }
  };
  const runLegacyActivation = async (): Promise<void> => {
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

  // 页面信息统计：字数（去空白字符数）与块数（顶层块总数），供三点菜单底部展示。
  // 必须放在 loading/!content 提前 return 之前，保证 hooks 顺序稳定。
  const { wordCount, blockCount } = useMemo(() => {
    if (!content || typeof content !== "object") return { wordCount: 0, blockCount: 0 };
    const doc = content as { type?: string; content?: unknown[] };
    const blocks = Array.isArray(doc.content) ? doc.content.length : 0;
    let textLen = 0;
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const record = node as { type?: string; text?: unknown; content?: unknown[] };
      if (record.type === "text" && typeof record.text === "string") {
        textLen += record.text.replace(/\s/g, "").length;
      }
      for (const child of record.content || []) walk(child);
    };
    walk(content);
    return { wordCount: textLen, blockCount: blocks };
  }, [content]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!content) {
    // 离线打开一篇服务器上完好的笔记时，查询必然失败——不能误报"笔记不存在"
    const offlineUnavailable = loadFailure === "offline";
    return (
      <EmptyState
        icon={FileText}
        title={offlineUnavailable ? "离线暂不可读" : "笔记不存在"}
        description={
          offlineUnavailable
            ? "当前无网络连接，联网后将自动恢复阅读与编辑"
            : "笔记可能已被删除或链接无效"
        }
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

  // 标签增删：TagSelector 回传全量列表，与当前 diff 出新增/移除；新建标签走 name 创建
  const handleNoteTagsChange = async (next: Pick<Tag, "id" | "name" | "color">[]) => {
    const currentIds = new Set(noteTags.map((t) => t.id));
    const nextIds = new Set(next.map((t) => t.id));
    let changed = false;
    for (const t of next) {
      if (currentIds.has(t.id)) continue;
      changed = true;
      if (t.id.startsWith("new:")) {
        const createdId = await addNoteTag({ name: t.name });
        if (createdId) void refreshAllTags();
      } else {
        await addNoteTag({ id: t.id, name: t.name });
      }
    }
    for (const t of noteTags) {
      if (nextIds.has(t.id)) continue;
      changed = true;
      await removeNoteTag(t.id);
    }
    if (changed) {
      // 标签变化影响列表页徽标筛选（notes-changed）与侧边栏标签快捷列表（tags-changed）
      window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      window.dispatchEvent(new CustomEvent("organize:tags-changed"));
    }
  };

  const handleRemoveNoteTag = async (tagId: string) => {
    await removeNoteTag(tagId);
    window.dispatchEvent(new CustomEvent("organize:notes-changed"));
    window.dispatchEvent(new CustomEvent("organize:tags-changed"));
  };

  const contentClassName = fullWidth
    ? "mx-auto w-full max-w-none px-4 md:px-10"
    : "mx-auto w-full max-w-3xl px-4 md:px-6";

  return (
      <div
        className={cn(
          "note-page mx-auto max-w-none",
          font === "serif" && "note-page-serif",
          font === "mono" && "note-page-mono",
          smallFont && "note-page-small",
          tocOpen && "note-page-toc-open",
          historyOpen && "note-page-history-open"
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
            <NoteSaveStatus
              online={online}
              offlinePending={offlinePending}
              pendingSyncedBlocks={pendingSyncedBlocks}
              saveError={saveError}
              saving={saving}
              lastSaved={lastSaved}
              isViewer={capabilities.isViewer}
            />
            <div className="hidden md:flex items-center">
              <NotePresenceBar peers={collab.peers} />
            </div>
            <div className="hidden md:flex items-center">
              <FavoriteButton targetType="note" targetId={noteId} />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHistoryOpen((open) => !open)}
              title="版本历史"
              className={cn("hidden md:inline-flex", historyOpen && "text-primary bg-primary/10")}
            >
              <History className="h-4 w-4" />
            </Button>
            <div className="hidden md:inline-flex">
              <NoteAttachmentsButton editor={editorInstance} />
            </div>
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
              tocOpen={tocOpen}
              onToggleToc={toggleToc}
              onCopyLink={copyLink}
              onCopyContent={copyContent}
              onDuplicate={duplicateNote}
              onMove={() => setMoveDialogOpen(true)}
              onShowHistory={() => setHistoryOpen(true)}
              onExport={() => void exportMarkdown()}
              onDelete={() => void deleteNote()}
              wordCount={wordCount}
              blockCount={blockCount}
              lastEditedAt={lastSaved}
            />
          </div>
        </div>
      </div>

      {/* 本机草稿写入失败：持续错误条（不自动消失），提供 R02 的本地快照导出入口 */}
      {localDraftPersistFailed && (
        <div
          className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300"
          role="alert"
        >
          <span>本机草稿未能保存，请导出当前内容或保持页面打开</span>
          <button
            type="button"
            onClick={exportMarkdown}
            className="shrink-0 underline underline-offset-2 hover:opacity-80"
          >
            导出当前内容
          </button>
        </div>
      )}

      {/* 标题区（图标/封面/评论 + 标题）与目录同处一个 hover 域：鼠标移入标题时显示三个「添加」操作 */}
      <div className="note-page-title-zone">
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
            readOnly={capabilities.isViewer}
            onChange={(e) => handleTitleChange(e.target.value)}
            onKeyDown={handleTitleKeyDown}
            onInput={autoGrowTitle}
            placeholder="无标题笔记"
            rows={1}
            className="note-title w-full resize-none overflow-hidden break-words bg-transparent px-0 py-2 text-2xl font-bold leading-tight outline-none"
          />
        </div>
      </div>

      <div className={cn(contentClassName, "note-page-body")}>
        {/* 创建时间 */}
        {createdAt && (
          <div className="note-meta-row flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            创建于 {new Date(createdAt).toLocaleDateString("zh-CN")}
          </div>
        )}

        {/* 标签：Notion 式页面属性行，徽标可点 X 移除，「标签」打开选择器（支持输入新名直接创建）。
            note_tags 各人一份（按调用者记 user_id），editor 可以打自己的标签；viewer 只读 */}
        <div className="note-meta-row flex flex-wrap items-center gap-1.5">
          {displayNoteTags.map((t) => (
            <TagBadge key={t.id} tag={t} size="sm" onRemove={capabilities.canModifyTags ? () => void handleRemoveNoteTag(t.id) : undefined} />
          ))}
          {capabilities.canModifyTags && (
            <TagSelector
              selected={noteTags}
              options={allTagOptions}
              onChange={(next) => void handleNoteTagsChange(next)}
            >
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <TagIcon className="h-3 w-3" />
                标签
              </button>
            </TagSelector>
          )}
        </div>

        {/* 关联任务横幅：有待办指向本笔记时显示回跳入口 */}
        <LinkedTaskBanner noteId={noteId} />

        {commentsOpen && (
          <NotePageComments
            noteId={noteId}
            onCountChange={setPageCommentCount}
          />
        )}

        {/* 编辑器 / 历史版本预览 */}
        {previewVersion ? (
          <div className="note-history-view">
            <div className="note-history-banner">
              <span className="note-history-banner-text">
                正在查看{" "}
                {new Date(previewVersion.created_at).toLocaleString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                的版本{previewVersion.message ? ` · ${previewVersion.message}` : ""}
              </span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => void restorePreviewVersion()}>
                  恢复此版本
                </Button>
                <Button size="sm" variant="ghost" onClick={exitPreview}>
                  退出预览
                </Button>
              </div>
            </div>
            <NoteHistoryPreview
              versionContent={(previewVersion.content ?? null) as never}
              currentContent={(content ?? null) as never}
            />
          </div>
        ) : (
          <TipTapEditor
            key={noteId}
            noteId={noteId}
            noteTitle={title}
            content={content}
            editable={capabilities.canEdit}
            collab={editorCollab}
            onUpdate={handleContentUpdate}
            noteTree={allNotes}
            internalLinkStates={contentLinkStates}
            onEditorReady={(editor) => {
              editorRef.current = editor;
              setEditorInstance(editor);
            }}
          />
        )}

        {/* 反向链接 & 关联阅读 */}
        <Backlinks noteId={noteId} readingItemId={readingItemId} />

        {/* 子页面：始终在笔记最底部（flex 布局 margin-top:auto 推底） */}
        <NoteChildPages noteId={noteId} notes={allNotes} />
      </div>

      {/* 页面目录：右侧固定栏，与正文之间灰色竖线分隔 */}
      {tocOpen && (
        <NoteTocPanel editor={editorInstance} content={content} onClose={closeToc} />
      )}

      {/* 轻量内联提示 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      <NoteRecoveryDialog
        recoveryDraft={recoveryDraft}
        onRestore={restoreLocalDraft}
        onDiscard={discardLocalDraft}
      />

      <NoteConflictDialog
        conflict={saveConflict}
        localDraftPersistFailed={localDraftPersistFailed}
        localTitle={draftRef.current.title}
        localContentSize={JSON.stringify(draftRef.current.content || {}).length}
        onOverwriteRemote={overwriteRemoteVersion}
        onReloadRemote={reloadRemoteVersion}
        onKeepLocalCopy={() => void keepLocalCopy()}
      />

      <ResourceShareDialog
        resourceType="note"
        resourceId={noteId}
        myRole={noteRole ?? "owner"}
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

      <NoteHistoryPanel
        noteId={noteId}
        open={historyOpen}
        activeVersionId={previewVersion?.id ?? null}
        onClose={() => {
          setHistoryOpen(false);
          setPreviewVersion(null);
        }}
        onSelect={(version) => void selectPreviewVersion(version)}
      />
    </div>
  );
}
