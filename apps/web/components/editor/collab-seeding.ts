/**
 * 协作播种租约协议（067 / A04 / B05）：播种状态机从 tiptap-editor 的 UI effect
 * 中隔离（B05 拆分，行为逐行保持）。
 *
 * 职责（与原内联 effect 一一对应）：
 * - 房间为空且 DB 有内容快照（seedContent）→ 进入「播种未定形」阻塞态
 *   （onBlockedChange(true)，页面据此锁编辑）；
 * - synced（含 attach 时已 synced）且仍为空 → 发 seed-req 申请播种租约；
 * - seed-grant → 用 DB 原始快照播种一次（emitUpdate=false：不标脏、不触发保存）；
 *   重复 grant 由 isEmpty 守卫拦截，不会二次写入。「并发冷启动只播种一次」的
 *   服务端一半在 collab-server seed-lease.ts 的租约仲裁，客户端只认一份 grant；
 * - seed-wait → 2.5s 后重问，至多 3 次（覆盖对方播种失败/掉线）；
 * - seed-deny → 立即解除阻塞；denyWatchDelayMs 后仍为空 → onDenyTimeout
 *   （UI 自行提示；协议层不自动播种不写房间——deny = 播种阶段结束，强行写只会
 *   制造重复内容）；
 * - 任意途径内容到达（远端同步/对端播种）→ 解除阻塞；断线恢复后再次 synced，
 *   房间非空则不再发 seed-req（断线恢复不重复播种）。
 *
 * 刻意留在 tiptap-editor：blocked → editor.setEditable 的门控映射（UI 态）、deny
 * toast 文案，以及 UniqueID 初始回填 effect（它交错 doc 遍历与块 id 域知识，A04
 * 已明确由编辑器手动接管，拆出只增透传）。seedContent 晚于会话就绪（页面异步
 * DB 加载）时，页面以新的 collab 绑定重建 effect（既有行为），控制器不追踪快照变化。
 *
 * 本文件不 import TipTap/Hocuspocus 类型：依赖用最小结构接口表达（真实 Editor /
 * HocuspocusProvider 在组件装配处结构兼容），fake 直接可测。
 */

export interface CollabSeedEditorLike {
  /** 房间文档是否为空（每次读取取实时值） */
  readonly isEmpty: boolean;
  readonly isDestroyed: boolean;
  /** 播种写入：emitUpdate=false 对应 setContent 第二参（不产生 onUpdate/保存） */
  setContent(content: Record<string, unknown>, emitUpdate: boolean): void;
  /** 订阅/退订文档更新（远端同步与本地输入都会触发） */
  onUpdate(fn: () => void): void;
  offUpdate(fn: () => void): void;
}

export interface CollabSeedProviderLike {
  readonly isSynced: boolean;
  onSynced(fn: () => void): void;
  offSynced(fn: () => void): void;
  onStateless(fn: (message: { payload: string }) => void): void;
  offStateless(fn: (message: { payload: string }) => void): void;
  sendStateless(payload: string): void;
}

export interface CollabSeedCallbacks {
  /** 阻塞态变化：true = 播种未定形（DB 有内容 + 房间还空） */
  onBlockedChange(blocked: boolean): void;
  /** deny 后观察窗内内容仍未到达：UI 提示刷新（笔记内容没有丢失） */
  onDenyTimeout(): void;
}

export interface CollabSeedControllerOptions {
  editor: CollabSeedEditorLike;
  provider: CollabSeedProviderLike;
  /** DB 加载时的原始内容快照；null = 空笔记（不阻塞、不申请） */
  seedContent: Record<string, unknown> | null;
  callbacks: CollabSeedCallbacks;
  /** 默认全局定时器；测试可注入 fake */
  timers?: {
    setTimeout(handler: () => void, timeoutMs: number): ReturnType<typeof setTimeout>;
    clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  };
  /** seed-wait 重问次数上限（默认 3）与间隔（默认 2500ms） */
  waitRetryLimit?: number;
  waitRetryDelayMs?: number;
  /** deny 后等待内容到达的观察窗（默认 12000ms，覆盖 3×wait 重试与租约封顶） */
  denyWatchDelayMs?: number;
}

export interface CollabSeedController {
  /** 解绑事件并清理定时器（对应原 effect cleanup，含阻塞态复位） */
  detach(): void;
}

export function createCollabSeedController(
  options: CollabSeedControllerOptions
): CollabSeedController {
  const { editor, provider, seedContent, callbacks } = options;
  const timers = options.timers ?? {
    setTimeout: (handler: () => void, timeoutMs: number) => setTimeout(handler, timeoutMs),
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
  };
  const waitRetryLimit = options.waitRetryLimit ?? 3;
  const waitRetryDelayMs = options.waitRetryDelayMs ?? 2_500;
  const denyWatchDelayMs = options.denyWatchDelayMs ?? 12_000;

  let waits = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  // A05 D5：deny 后房间持续为空 → 观察窗后告知用户，不自动播种不写房间
  let denyWatchTimer: ReturnType<typeof setTimeout> | null = null;

  const setBlocked = (blocked: boolean) => callbacks.onBlockedChange(blocked);

  // A05 D4 收尾：DB 有内容 + 房间还空 = 播种未定形，锁编辑直到 grant/deny/内容到达
  const syncSeedBlock = () => {
    setBlocked(editor.isEmpty && !!seedContent);
  };

  const requestSeed = () => {
    if (editor.isDestroyed || !editor.isEmpty || !seedContent) return;
    provider.sendStateless(JSON.stringify({ t: "seed-req" }));
  };

  const onSynced = () => {
    if (editor.isEmpty) {
      waits = 0;
      requestSeed();
    }
  };

  const onDocUpdate = () => {
    if (!editor.isDestroyed && !editor.isEmpty) setBlocked(false);
  };

  const onStateless = ({ payload }: { payload: string }) => {
    let msg: { t?: string };
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    if (msg.t === "seed-grant") {
      if (!editor.isDestroyed && editor.isEmpty && seedContent) {
        editor.setContent(seedContent, false);
      }
      setBlocked(false);
    } else if (msg.t === "seed-wait" && waits < waitRetryLimit) {
      waits += 1;
      retryTimer = timers.setTimeout(requestSeed, waitRetryDelayMs);
    } else if (msg.t === "seed-deny") {
      // 播种阶段结束：内容要么即将随同步到达（onDocUpdate 解锁），要么封顶卡死
      setBlocked(false);
      if (!denyWatchTimer) {
        denyWatchTimer = timers.setTimeout(() => {
          denyWatchTimer = null;
          if (!editor.isDestroyed && editor.isEmpty) callbacks.onDenyTimeout();
        }, denyWatchDelayMs);
      }
    }
  };

  syncSeedBlock();
  if (provider.isSynced) onSynced();
  provider.onSynced(onSynced);
  provider.onStateless(onStateless);
  editor.onUpdate(onDocUpdate);

  return {
    detach() {
      provider.offSynced(onSynced);
      provider.offStateless(onStateless);
      editor.offUpdate(onDocUpdate);
      if (retryTimer) timers.clearTimeout(retryTimer);
      if (denyWatchTimer) timers.clearTimeout(denyWatchTimer);
      setBlocked(false);
    },
  };
}
