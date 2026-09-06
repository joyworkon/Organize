import type { NoteDraftSnapshot } from "@/lib/notes/local-draft";
import {
  areNoteDraftsEqual,
  clearLocalNoteDraft,
  writeLocalNoteDraft,
  type DraftWriteResult,
} from "@/lib/notes/local-draft";
import { isNetworkSaveError, planSaveFailure } from "@/lib/offline/note-sync";
import { findNoteCreate, removeNoteCreate, type PendingNoteCreate } from "@/lib/offline/note-queue";
import type { TransactionSource } from "@/lib/collab/transaction-source";
import { extractTaskMutations } from "@/lib/task-link";
import { saveRpcNameForRole, type CollabRole } from "@/lib/collab/roles";

/**
 * 笔记保存会话（R07）：把「dirty / revision / mutation 幂等键 / 重试退避 / 冲突 / 离线 /
 * 排空循环」从页面抽成可注入、可测试的核心。页面只消费会话接口与派生 UI 状态。
 *
 * 行为契约（与抽离前的页面保存管线逐条对应）：
 * - 会话以 generation 隔离：noteId 切换 = 新会话 + 旧会话 destroy()；旧会话的在途保存
 *   循环、重试定时器回调一律不再生效，也不能污染新会话状态。
 * - flush 排空循环：每轮快照复制 → 幂等键复用（同内容重试复用 mutationId）→ 按角色/
 *   协作状态选 RPC（协作在线 v2 + expected=null；否则 owner/editor 角色链）→
 *   冲突不自动覆盖、失败按 planSaveFailure 分类（退避重试 / 等联网 / 明确报错）。
 * - 任务 mutation 只在 user 来源 + 双链开关开启时提取（hydrate/remote-sync/恢复不触发）。
 * - 本地草稿：编辑即持久化；云端成功且草稿与快照一致时清除；写入失败如实上报。
 * - 生命周期：debounce 定时器、重试定时器由会话管理并在 destroy 时清理。
 */

export type { CollabRole };

export interface ConflictActor {
  kind: "self" | "collaborator" | "unknown";
  name: string | null;
}

export interface NoteSaveConflict {
  kind: "note" | "task";
  currentRevision: number | null;
  taskId?: string;
  remoteDraft: NoteDraftSnapshot | null;
  remoteUpdatedAt: string | null;
  actor: ConflictActor;
}

/** 保存通道：页面注入 supabase 适配实现；测试注入 fake。 */
export interface NoteSaveTransport {
  /** 原子保存 RPC（v1 乐观锁 / v2 协作快照），返回 { data, error } 形状 */
  save(input: {
    rpcName: string;
    pNoteId: string;
    pContent: unknown;
    pExpectedNoteRevision: number | null;
    pTitle: string;
    pTaskMutations: unknown[] | null;
    pMutationId: string;
    pNoteSnapshot: NoteDraftSnapshot;
  }): Promise<{
    data: {
      status?: string;
      note_revision?: number;
      current_revision?: number;
      task_id?: string;
    } | null;
    error: unknown;
  }>;
  /** 冲突时拉服务端当前草稿（含 066 last_edit_by 与 revision） */
  fetchRemoteDraft(): Promise<{
    draft: NoteDraftSnapshot;
    lastEditBy: string | null;
    contentRevision: number;
    updatedAt: string | null;
  } | null>;
  fetchProfileName(userId: string): Promise<string | null>;
  /** 离线创建队列 */
  findPendingCreate(): PendingNoteCreate | null;
  removePendingCreate(): void;
  insertPendingCreate(note: Record<string, unknown>): Promise<{ error: unknown }>;
}

export interface NoteSaveSessionDeps {
  noteId: string;
  accountId: string;
  /** 共享草稿持有者：页面与此处操作同一对象（保持既有页面读写模式） */
  draftRef: { current: NoteDraftSnapshot };
  /** 角色 / 协作 / 在线状态取活跃值（会话不缓存，判定以调用时刻为准） */
  getRole(): CollabRole | null;
  isCollabActive(): boolean;
  isOnline(): boolean;
  /** 任务↔笔记双链开关（G2 legacy 行为保持） */
  isTaskNoteLinkEnabled(): boolean;
  transport: NoteSaveTransport;
  /** 历史/版本恢复的「跳过卸载兜底」标志（sessionStorage 语义），flush 时消费 */
  consumeSkipFlush(): boolean;
  timers: {
    setTimeout(handler: () => void, timeoutMs: number): ReturnType<typeof setTimeout>;
    clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  };
  randomId(): string;
  /** 保存 debounce 间隔（页面既有 900ms；测试可注入 0） */
  debounceMs: number;
  callbacks: {
    onUiState(): void;
    onNotesChanged(): void;
    onSaved(info: { noteId: string; title: string }): void;
    /** 一次性迁移等场景的延迟落盘（历史行为：500ms） */
  };
}

export type NoteFlushResult =
  | { status: "saved"; revision: number }
  | { status: "not-needed" }
  | { status: "offline-pending" }
  | { status: "conflict"; conflict: NoteSaveConflict }
  | { status: "error"; message: string }
  | { status: "superseded" };

/** 统一派生的 UI 状态（R07.5）：页面不再用互不约束的散 flag 拼文案 */
export type NoteSavePhase =
  | "clean"
  | "dirty"
  | "saving"
  | "local-only"
  | "conflict"
  | "error";

export interface NoteSaveUiState {
  phase: NoteSavePhase;
  lastSavedAt: Date | null;
  saveError: string;
  offlinePending: boolean;
  conflict: NoteSaveConflict | null;
  /** 本机草稿写入是否失败（R03） */
  localPersistence: "ok" | "failed";
  /** 子块（同步块等）待同步计数（R05 页面聚合计数透传） */
  pendingChildBlocks: number;
}

export interface NoteSaveSession {
  readonly noteId: string;
  readonly accountId: string;
  // ---- 草稿 ----
  getDraft(): NoteDraftSnapshot;
  patchDraft(patch: Partial<NoteDraftSnapshot>, opts?: { markDirty?: boolean }): void;
  setContent(content: NoteDraftSnapshot["content"], source: TransactionSource): void;
  /** 恢复历史版本 / 本地草稿：整体替换草稿并复位来源 */
  restoreDraft(draft: NoteDraftSnapshot, opts?: { baseRevision?: number; skipNextFlush?: boolean }): void;
  hydrate(draft: NoteDraftSnapshot, revision: number): void;
  exportSnapshot(): NoteDraftSnapshot;
  isDirty(): boolean;
  getRevision(): number;
  // ---- 保存 ----
  queueSave(): void;
  /** 当前是否有排空等待（含在途）；⌘S 等入口据此防抖 */
  hasPendingWork(): boolean;
  flush(): Promise<NoteFlushResult>;
  /** 兼容便捷：saved/not-needed = true */
  flushSaved(): Promise<boolean>;
  markOfflinePending(): void;
  setPendingChildBlocks(count: number): void;
  // ---- 生命周期 ----
  /** 停掉防抖/重试定时器并清 dirty（删除笔记前防“删除瞬间之后的草稿写回”） */
  suppressAutosave(): void;
  // ---- 冲突 ----
  resolveConflictOverwriteRemote(): void;
  resolveConflictReloadRemote(): void;
  clearConflict(): void;
  // ---- 本机草稿 ----
  clearLocalDraft(): void;
  discardLocalDraft(): void;
  // ---- 生命周期 ----
  destroy(): void;
  getUiState(): NoteSaveUiState;
}

export function createNoteSaveSession(deps: NoteSaveSessionDeps): NoteSaveSession {  const { noteId, accountId, draftRef, transport, callbacks } = deps;

  // ---- 内部状态（页面不再直接管理）----
  let destroyed = false;
  // 草稿对象身份绑定：页面切换笔记会整体替换 draftRef.current（新对象），
  // 旧会话的排空循环此时必须立即失效——即使 destroy 尚未执行（兜底 flush 在途中）。
  // 页面内的就地修改（Object.assign / 属性赋值）保持同一对象身份，不受影响。
  let boundDraft = draftRef.current;
  const draftOwnershipLost = () => draftRef.current !== boundDraft;
  let dirty = false;
  let revision = 0;
  let lastSource: TransactionSource = "user";
  let savingPromise: Promise<NoteFlushResult> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;
  let lastAttempt: { draft: NoteDraftSnapshot; mutationId: string } | null = null;
  let conflict: NoteSaveConflict | null = null;
  let localPersistence: "ok" | "failed" = "ok";
  let pendingChildBlocks = 0;
  const ui: NoteSaveUiState = {
    phase: "clean",
    lastSavedAt: null,
    saveError: "",
    offlinePending: false,
    conflict: null,
    localPersistence: "ok",
    pendingChildBlocks: 0,
  };

  function notifyUi() {
    ui.phase = destroyed
      ? "clean"
      : conflict
        ? "conflict"
        : savingPromise
          ? "saving"
          : dirty
            ? (deps.isOnline() ? "dirty" : "local-only")
            : ui.saveError
              ? "error"
              : "clean";
    ui.conflict = conflict;
    ui.localPersistence = localPersistence;
    ui.pendingChildBlocks = pendingChildBlocks;
    callbacks.onUiState();
  }

  function persistDraft(baseRevision = revision): DraftWriteResult | null {
    if (destroyed) return null;
    const result = writeLocalNoteDraft(localStorage, accountId, noteId, baseRevision, {
      ...draftRef.current,
    });
    localPersistence = result.status === "ok" ? "ok" : "failed";
    notifyUi();
    return result;
  }

  function setSaveError(message: string) {
    ui.saveError = message;
    notifyUi();
  }

  function clearRetry() {
    retryCount = 0;
    if (retryTimer) {
      deps.timers.clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  /** 排空循环单轮：一次原子 RPC 保存。返回是否继续处理冲突以外的失败。 */
  async function runSaveRound(): Promise<
    | { kind: "ok"; revision: number }
    | { kind: "conflict"; conflict: NoteSaveConflict }
    | { kind: "failed"; message: string }
    | { kind: "superseded" }
  > {
    // 已切换会话：dirty/draft 归属新笔记，绝不能把新草稿写到旧会话 id 下
    if (destroyed || draftOwnershipLost()) return { kind: "superseded" };
    dirty = false;
    const snapshot: NoteDraftSnapshot = { ...draftRef.current };
    const mutations =
      deps.isTaskNoteLinkEnabled() && lastSource === "user"
        ? extractTaskMutations(snapshot.content)
        : { mutations: [] as unknown[] };
    // 幂等键：与上次尝试内容一致（自动重试场景）时复用同一 mutation_id
    const mutationId =
      lastAttempt && areNoteDraftsEqual(lastAttempt.draft, snapshot)
        ? lastAttempt.mutationId
        : deps.randomId();
    lastAttempt = { draft: snapshot, mutationId };

    const collabActive = deps.isCollabActive();
    const role = deps.getRole() ?? "owner";
    const rpcName = collabActive ? "save_note_with_tasks_v2" : saveRpcNameForRole(role);
    const { data: result, error: rpcErr } = await transport.save({
      rpcName,
      pNoteId: noteId,
      pContent: snapshot.content,
      pExpectedNoteRevision: collabActive ? null : revision,
      pTitle: snapshot.title,
      pTaskMutations: mutations.mutations.length > 0 ? mutations.mutations : null,
      pMutationId: mutationId,
      pNoteSnapshot: snapshot,
    });
    // RPC 期间切换了会话：任何补救/回写都不得发生
    if (destroyed || draftOwnershipLost()) return { kind: "superseded" };
    const status = result?.status;

    if (status === "conflict_note" || status === "conflict_task") {
      dirty = true;
      persistDraft();
      const remote = await transport.fetchRemoteDraft();
      if (destroyed) return { kind: "superseded" };
      // 归因冲突对方（066 last_edit_by）
      let actor: ConflictActor = { kind: "unknown", name: null };
      const lastEditBy = remote?.lastEditBy ?? null;
      if (lastEditBy && lastEditBy === accountId) {
        actor = { kind: "self", name: null };
      } else if (lastEditBy) {
        const name = await transport.fetchProfileName(lastEditBy);
        if (destroyed) return { kind: "superseded" };
        if (name) actor = { kind: "collaborator", name };
      }
      const built: NoteSaveConflict = {
        kind: status === "conflict_note" ? "note" : "task",
        currentRevision:
          typeof result?.current_revision === "number"
            ? result.current_revision
            : remote
              ? remote.contentRevision
              : null,
        taskId: result?.task_id,
        remoteDraft: remote?.draft ?? null,
        remoteUpdatedAt: remote?.updatedAt ?? null,
        actor,
      };
      return { kind: "conflict", conflict: built };
    }

    if (rpcErr || status !== "ok" || typeof result?.note_revision !== "number") {
      dirty = true;
      persistDraft();
      const action = planSaveFailure({
        error: rpcErr,
        retries: retryCount,
        online: deps.isOnline(),
      });
      if (action.type === "retry") {
        retryCount += 1;
        ui.offlinePending = true;
        setSaveError(
          `网络异常，${Math.round(action.delayMs / 1000)} 秒后自动重试（第 ${retryCount} 次）`
        );
        if (retryTimer) deps.timers.clearTimeout(retryTimer);
        retryTimer = deps.timers.setTimeout(() => {
          retryTimer = null;
          void self.flush();
        }, action.delayMs);
        return { kind: "failed", message: ui.saveError };
      }
      if (action.type === "wait-online") {
        ui.offlinePending = true;
        setSaveError("");
        return { kind: "failed", message: "" };
      }
      setSaveError("保存失败，请检查网络后重试；当前内容仍在页面上，可随时导出");
      return { kind: "failed", message: ui.saveError };
    }

    // 成功
    clearRetry();
    ui.offlinePending = false;
    revision = result.note_revision;
    setSaveError("");
    ui.lastSavedAt = new Date();
    conflict = null;
    if (!dirty && areNoteDraftsEqual(draftRef.current, snapshot)) {
      clearLocalNoteDraft(localStorage, accountId, noteId);
      // 云端已确认：本机草稿写入失败与否不再有影响
      localPersistence = "ok";
    }
    callbacks.onSaved({ noteId, title: snapshot.title });
    callbacks.onNotesChanged();
    return { kind: "ok", revision: result.note_revision };
  }

  const self: NoteSaveSession = {
    noteId,
    accountId,
    getDraft: () => draftRef.current,
    patchDraft(patch, opts) {
      Object.assign(draftRef.current, patch);
      if (opts?.markDirty !== false) {
        dirty = true;
        notifyUi();
      }
    },
    setContent(content, source) {
      if (destroyed || draftOwnershipLost()) return;
      draftRef.current.content = content;
      lastSource = source;
      // 协作远端事务不标脏不排队：内容由 CRDT 收敛，快照由打字端落库
      if (source !== "remote-sync") {
        dirty = true;
        notifyUi();
      }
    },
    restoreDraft(draft, opts) {
      if (opts?.skipNextFlush) {
        // 历史恢复：卸载兜底 flush 不得把旧草稿写回；下次 flush 直接消费该标志
        dirty = false;
        try {
          sessionStorage.setItem(`organize:skip-flush:${noteId}`, "1");
        } catch { /* sessionStorage 不可用时忽略 */ }
      }
      Object.assign(draftRef.current, draft);
      if (typeof opts?.baseRevision === "number") revision = opts.baseRevision;
      lastSource = "user";
      notifyUi();
    },
    hydrate(draft, baseRevision) {
      if (destroyed) return;
      // 注水时重绑当前草稿对象：loadNote 在会话创建后整体替换 draftRef.current
      //（异步时序），绑定必须跟随最终对象，否则 queueSave 永久失效（R07 复审补丁的竞态）。
      boundDraft = draftRef.current;
      Object.assign(draftRef.current, draft);
      revision = baseRevision;
      dirty = false;
      lastSource = "user";
      notifyUi();
    },
    exportSnapshot() {
      return { ...draftRef.current };
    },
    isDirty: () => dirty,
    getRevision: () => revision,
    queueSave() {
      if (destroyed || draftOwnershipLost()) return;
      dirty = true;
      persistDraft();
      if (saveTimer) deps.timers.clearTimeout(saveTimer);
      saveTimer = deps.timers.setTimeout(() => {
        saveTimer = null;
        void self.flush();
      }, deps.debounceMs);
      notifyUi();
    },
    hasPendingWork: () => dirty || savingPromise !== null,
    async flush() {
      if (destroyed || draftOwnershipLost()) return { status: "superseded" };
      if (saveTimer) {
        deps.timers.clearTimeout(saveTimer);
        saveTimer = null;
      }
      // 协作 viewer 只读：编辑器已禁输入，不存在可落库改动
      if (deps.getRole() === "viewer") return { status: "not-needed" };
      // 历史恢复后：本地草稿已被服务端快照替代，跳过兜底保存
      try {
        if (deps.consumeSkipFlush()) {
          dirty = false;
          clearLocalNoteDraft(localStorage, accountId, noteId);
          return { status: "not-needed" };
        }
      } catch { /* sessionStorage 不可用时按正常流程 */ }
      if (savingPromise) return savingPromise;
      const promise = (async (): Promise<NoteFlushResult> => {
        setSaveError("");
        // X1：离线时不发起 RPC（必然失败），保留草稿等 online 事件触发同步
        if (!deps.isOnline()) {
          if (dirty) {
            persistDraft();
            ui.offlinePending = true;
            notifyUi();
            return { status: "offline-pending" };
          }
          return { status: "not-needed" };
        }
        // X1-2B：本条笔记的创建仍滞留离线队列 → 先落创建（主键幂等）再走保存
        const pendingCreate = transport.findPendingCreate();
        if (pendingCreate) {
          const { error: createErr } = await transport.insertPendingCreate(pendingCreate.note);
          const createCode = (createErr as { code?: unknown } | null)?.code;
          if (createErr && createCode !== "23505") {
            if (isNetworkSaveError(createErr)) {
              if (dirty) {
                persistDraft();
                ui.offlinePending = true;
                notifyUi();
                return { status: "offline-pending" };
              }
              return { status: "error", message: "离线创建尚未同步" };
            }
            // 业务错误：移出队列避免死循环，继续走保存暴露真实错误
          }
          transport.removePendingCreate();
          if (!dirty) ui.offlinePending = false;
        }
        let lastRound: Awaited<ReturnType<typeof runSaveRound>> | null = null;
        while (dirty) {
          lastRound = await runSaveRound();
          if (lastRound.kind !== "ok") break;
        }
        if (destroyed) return { status: "superseded" };
        switch (lastRound?.kind) {
          case "ok":
            return { status: "saved", revision: lastRound.revision };
          case "conflict":
            conflict = lastRound.conflict;
            setSaveError("检测到其他位置的修改，请处理保存冲突");
            return { status: "conflict", conflict: lastRound.conflict };
          case "failed":
            return { status: "error", message: lastRound.message };
          case "superseded":
            return { status: "superseded" };
          default:
            // dirty 为 false 进入循环前（无未落库改动）
            return { status: "not-needed" };
        }
      })().finally(() => {
        savingPromise = null;
        notifyUi();
      });
      savingPromise = promise;
      notifyUi();
      return promise;
    },
    flushSaved: async () => {
      const result = await self.flush();
      return result.status === "saved" || result.status === "not-needed";
    },
    /** 断网瞬间点亮“待同步”（P2-4：不等滞留的 debounce flush） */
    markOfflinePending() {
      if (destroyed) return;
      ui.offlinePending = true;
      notifyUi();
    },
    setPendingChildBlocks(count) {
      pendingChildBlocks = count;
      notifyUi();
    },
    suppressAutosave() {
      if (saveTimer) {
        deps.timers.clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (retryTimer) {
        deps.timers.clearTimeout(retryTimer);
        retryTimer = null;
      }
      dirty = false;
      notifyUi();
    },
    resolveConflictOverwriteRemote() {
      if (!conflict || conflict.currentRevision === null) return;
      const baseRevision = conflict.currentRevision;
      revision = baseRevision;
      conflict = null;
      setSaveError("");
      dirty = true;
      persistDraft(baseRevision);
      void self.flush();
    },
    resolveConflictReloadRemote() {
      if (saveTimer) {
        deps.timers.clearTimeout(saveTimer);
        saveTimer = null;
      }
      dirty = false;
      clearLocalNoteDraft(localStorage, accountId, noteId);
      conflict = null;
      notifyUi();
    },
    clearConflict() {
      conflict = null;
      notifyUi();
    },
    clearLocalDraft() {
      clearLocalNoteDraft(localStorage, accountId, noteId);
    },
    discardLocalDraft() {
      clearLocalNoteDraft(localStorage, accountId, noteId);
      notifyUi();
    },
    destroy() {
      destroyed = true;
      dirty = false;
      conflict = null;
      if (saveTimer) {
        deps.timers.clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (retryTimer) {
        deps.timers.clearTimeout(retryTimer);
        retryTimer = null;
      }
      // 幂等键与重试状态不跨笔记（与页面加载复位一致）
      lastAttempt = null;
      retryCount = 0;
    },
    getUiState: () => ui,
  };

  return self;
}

type SupabaseBrowserClient = ReturnType<typeof import("@/lib/supabase/client").createClient>;

/**
 * 页面用 supabase 适配：把既有 RPC 参数形状 / 冲突拉取 / 离线创建队列
 * 映射成会话的 transport 接口。每个会话（noteId 换代）一个实例。
 */
export function createSupabaseNoteSaveTransport(
  supabase: SupabaseBrowserClient,
  noteId: string
): NoteSaveTransport {
  // 延迟引入避免 lib 循环依赖（note-queue 只依赖 localStorage 形状）
  return {
    async save(input) {
      const { data, error } = await supabase.rpc(input.rpcName, {
        p_note_id: input.pNoteId,
        p_content: input.pContent,
        p_expected_note_revision: input.pExpectedNoteRevision,
        p_title: input.pTitle,
        p_task_mutations: input.pTaskMutations,
        // 前端尚未维护任务 sync_version 缓存，传 null 只对笔记执行乐观锁（既有约定）
        p_expected_task_revisions: null,
        p_mutation_id: input.pMutationId,
        p_note_snapshot: input.pNoteSnapshot,
      });
      return {
        data: data as {
          status?: string;
          note_revision?: number;
          current_revision?: number;
          task_id?: string;
        } | null,
        error,
      };
    },
    async fetchRemoteDraft() {
      const { data } = await supabase
        .from("notes")
        .select("*")
        .eq("id", noteId)
        .single();
      const remote = data as Record<string, unknown> | null;
      if (!remote) return null;
      return {
        draft: {
          title: (remote.title as string) || "",
          content: (remote.content as NoteDraftSnapshot["content"]) ?? null,
          icon: (remote.icon as string | null) ?? null,
          cover_url: (remote.cover_url as string | null) ?? null,
          cover_position: Number(remote.cover_position ?? 50),
          parent_note_id: (remote.parent_note_id as string | null) ?? null,
          full_width: remote.full_width === true,
          font_family:
            remote.font_family === "serif" || remote.font_family === "mono"
              ? (remote.font_family as "serif" | "mono")
              : "default",
          small_font: remote.small_font === true,
        },
        lastEditBy: (remote.last_edit_by as string | null) ?? null,
        contentRevision: Number(remote.content_revision ?? 0),
        updatedAt: (remote.updated_at as string | null) ?? null,
      };
    },
    async fetchProfileName(userId) {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("display_name")
        .eq("id", userId)
        .maybeSingle();
      return profile?.display_name ?? null;
    },
    findPendingCreate() {
      return findNoteCreate(localStorage, noteId);
    },
    removePendingCreate() {
      removeNoteCreate(localStorage, noteId);
    },
    async insertPendingCreate(note) {
      const { error } = await supabase.from("notes").insert(note);
      return { error };
    },
  };
}
