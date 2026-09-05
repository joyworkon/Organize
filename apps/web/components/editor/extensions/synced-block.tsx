"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { AlertTriangle, Loader2, RefreshCw, Repeat2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  classifyConflict,
  clearSyncedPending,
  createSyncSessionId,
  emitSyncedBlockStatus,
  fetchSyncedBlock,
  getSyncedUserId,
  patchSyncedBlock,
  readSyncedPending,
  replaceSyncedBlockContent,
  shouldAcceptSyncMessage,
  syncedBlockNeedsSync,
  writeSyncedPending,
  type SyncMessage,
} from "./synced-block-sync";

const SYNC_DEBOUNCE_MS = 1000;
const CHANNEL_NAME = "organize-synced-blocks";

function broadcast(message: SyncMessage) {
  if (typeof window === "undefined") return;
  // BroadcastChannel：跨标签页实时同步
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage(message);
  channel.close();
  // 同标签页内多实例：用 CustomEvent（BroadcastChannel 不回传本页发送者）
  window.dispatchEvent(new CustomEvent(CHANNEL_NAME, { detail: message }));
}

type SyncedStatus = "loading" | "saved" | "saving" | "error" | "conflict" | "stale";

function SyncedBlockView({ node, editor, getPos }: NodeViewProps) {
  const syncedId = String(node.attrs.syncedId || "");
  // hydrated 是历史持久化属性（R05 起忽略其网络可信性）：每次挂载都视为未注水，
  // 一律从服务端拉取；本地 pending 优先于远端（见挂载 effect）。
  const [status, setStatus] = useState<SyncedStatus>("loading");
  const [dirty, setDirty] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 待写快照：编辑后先落内存与 localStorage，服务器确认成功才清空；失败保留供重试
  const pendingRef = useRef<JSONContent[] | null>(null);
  const inflightRef = useRef(false);
  // 服务端确认的最新 revision（乐观锁基准；不写入文档 JSON）
  const revisionRef = useRef<number | null>(null);
  const sessionRef = useRef(createSyncSessionId());
  const seqRef = useRef(0);
  const lastSeqByOriginRef = useRef<Map<string, number>>(new Map());
  const lastRefreshRef = useRef(0);
  // 冲突/过期时服务端当前内容快照，供「拉取远端 / 用本地覆盖」决策
  const remoteSnapshotRef = useRef<{ revision: number; content: JSONContent[] } | null>(null);

  const currentPos = useCallback((): number | null => {
    const pos = typeof getPos === "function" ? (getPos() as number | (() => number)) : null;
    return typeof pos === "number" ? pos : null;
  }, [getPos]);

  const readCurrentContent = useCallback((): JSONContent[] | null => {
    const pos = currentPos();
    if (pos === null) return null;
    const currentNode = editor.state.doc.nodeAt(pos);
    if (!currentNode || currentNode.type.name !== "syncedBlock") return null;
    const json = currentNode.toJSON();
    return Array.isArray(json.content) ? json.content : [];
  }, [currentPos, editor]);

  const setPending = useCallback((content: JSONContent[] | null) => {
    pendingRef.current = content;
    setDirty(content !== null);
    emitSyncedBlockStatus(syncedId, content !== null);
    if (content !== null) {
      void getSyncedUserId().then((userId) => {
        if (!userId || pendingRef.current !== content) return;
        writeSyncedPending(localStorage, {
          version: 1,
          syncedId,
          userId,
          revision: revisionRef.current,
          content,
          savedAt: new Date().toISOString(),
        });
      });
    } else {
      clearSyncedPending(localStorage, syncedId);
    }
  }, [syncedId]);

  /** 应用远端内容：一致则不动（不打断光标），不一致用远端 meta 事务替换。 */
  const applyRemoteContent = useCallback((content: JSONContent[]): boolean => {
    const local = readCurrentContent();
    if (local && JSON.stringify(local) === JSON.stringify(content)) return false;
    const pos = currentPos();
    if (pos === null) return false;
    replaceSyncedBlockContent(editor, pos, content, syncedId);
    return true;
  }, [currentPos, editor, readCurrentContent, syncedId]);

  /** 把待写快照提交到服务端（乐观锁）；只有确认成功才清 pending 并广播。 */
  const flushToServer = useCallback(async (forceRevision?: number) => {
    if (inflightRef.current) return;
    const content = pendingRef.current;
    if (content === null) return;
    const expected = forceRevision ?? revisionRef.current;
    inflightRef.current = true;
    setStatus("saving");
    const result = await patchSyncedBlock(syncedId, content, expected);
    inflightRef.current = false;
    if (result.ok) {
      revisionRef.current = result.revision;
      // 保存期间又有新编辑时保留 dirty 并立刻再排空
      const stillPending = pendingRef.current !== null && pendingRef.current !== content;
      if (!stillPending) {
        setPending(null);
      }
      setSyncedAt(result.updatedAt);
      setStatus("saved");
      seqRef.current += 1;
      broadcast({
        syncedId,
        content,
        revision: result.revision,
        updatedAt: result.updatedAt,
        origin: sessionRef.current,
        seq: seqRef.current,
      });
      if (stillPending) void flushToServer();
      return;
    }
    if (result.reason === "conflict") {
      // 幂等命中：服务端内容与本地待写一致（上次响应丢失但已写入）
      if (result.currentContent && classifyConflict(result.currentContent, content) === "idempotent-hit") {
        revisionRef.current = result.currentRevision;
        setPending(null);
        setSyncedAt(new Date().toISOString());
        setStatus("saved");
        return;
      }
      // 真实冲突：保留双方内容，默认不覆盖远端，给出两个显式动作
      if (result.currentRevision !== null && result.currentContent) {
        remoteSnapshotRef.current = { revision: result.currentRevision, content: result.currentContent };
      }
      setStatus("conflict");
      return;
    }
    // 网络/服务端错误：保留待写快照，块内显示重试；不广播、不显示已同步
    setStatus("error");
  }, [setPending, syncedId]);

  const scheduleFlush = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void flushToServer();
    }, SYNC_DEBOUNCE_MS);
  }, [flushToServer]);

  // 挂载 + 注水（会话级）：忽略文档里的 hydrated 旧值，每次挂载都拉取。
  // 有本地 pending 时优先保护本地：远端不一致只置 stale 提示，不自动覆盖。
  useEffect(() => {
    if (!syncedId) return;
    let cancelled = false;
    (async () => {
      // 恢复持久化 pending（离线改 → 关页 → 重开 → 联网自动补交）
      const userId = await getSyncedUserId();
      if (cancelled) return;
      const stored = userId ? readSyncedPending(localStorage, userId, syncedId) : null;
      if (stored) {
        pendingRef.current = stored.content;
        setDirty(true);
        emitSyncedBlockStatus(syncedId, true);
        revisionRef.current = stored.revision;
      }

      const result = await fetchSyncedBlock(syncedId);
      if (cancelled) return;
      if (!result.ok) {
        // 404（未创建）沿用本地内容；其余失败保留本地内容但块内提示，可重试拉取
        setStatus(result.reason === "not-found" ? "saved" : "error");
        if (stored) void flushToServer();
        return;
      }
      revisionRef.current = result.revision;
      setSyncedAt(result.updatedAt);
      if (stored) {
        // 本地有未同步修改：远端更新不覆盖，提示远端有更新（默认保留本地）
        if (classifyConflict(result.content, stored.content) === "conflict") {
          remoteSnapshotRef.current = { revision: result.revision, content: result.content };
          setStatus("stale");
        } else {
          setStatus("saved");
        }
        void flushToServer();
        return;
      }
      applyRemoteContent(result.content);
      setStatus("saved");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedId]);

  // 跨设备更新：可见性/聚焦/联网驱动重验证（5 秒节流）；不是跨设备推送
  useEffect(() => {
    if (!syncedId) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRefreshRef.current < 5000) return;
      lastRefreshRef.current = now;
      void (async () => {
        const result = await fetchSyncedBlock(syncedId);
        if (result.ok) {
          revisionRef.current = result.revision;
          if (pendingRef.current === null) {
            setSyncedAt(result.updatedAt);
            applyRemoteContent(result.content);
          } else if (classifyConflict(result.content, pendingRef.current) === "conflict") {
            remoteSnapshotRef.current = { revision: result.revision, content: result.content };
            setStatus((prev) => (prev === "saving" || prev === "loading" ? prev : "stale"));
          }
        }
      })();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedId]);

  // 监听跨实例/跨标签同步消息；origin+seq 来源识别，不用时间窗口
  useEffect(() => {
    if (!syncedId) return;
    const handler = (message: SyncMessage | null | undefined) => {
      if (!shouldAcceptSyncMessage(message, sessionRef.current, lastSeqByOriginRef.current)) return;
      if (!message || message.syncedId !== syncedId) return;
      // 有未同步修改时不自动覆盖（保护本地），交由可见性刷新/stale 提示处理
      if (pendingRef.current !== null) return;
      const pos = currentPos();
      if (pos === null) return;
      if (typeof message.revision === "number") revisionRef.current = message.revision;
      // 远端 meta 事务：本组件的 transaction 监听器识别后不会回写
      replaceSyncedBlockContent(editor, pos, message.content, message.syncedId);
      setSyncedAt(message.updatedAt);
    };
    // BroadcastChannel（跨标签）
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL_NAME) : null;
    channel?.addEventListener("message", (e: MessageEvent<SyncMessage>) => {
      handler(e.data);
    });
    const windowHandler = (event: Event) => {
      handler((event as CustomEvent<SyncMessage>).detail);
    };
    window.addEventListener(CHANNEL_NAME, windowHandler);
    return () => {
      channel?.close();
      window.removeEventListener(CHANNEL_NAME, windowHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedId, editor, currentPos]);

  // 防抖持久化：只对本块真实内容变化触发；viewer（不可编辑）不发起写请求
  useEffect(() => {
    const onTransaction = ({ transaction }: { transaction: Parameters<typeof syncedBlockNeedsSync>[0] }) => {
      if (!syncedId || !editor.isEditable) return;
      const pos = currentPos();
      if (pos === null) return;
      const { changed } = syncedBlockNeedsSync(transaction, pos);
      if (!changed) return;
      const content = readCurrentContent();
      if (!content) return;
      pendingRef.current = content;
      setDirty(true);
      emitSyncedBlockStatus(syncedId, true);
      scheduleFlush();
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedId, editor, currentPos, readCurrentContent, scheduleFlush]);

  // 卸载时若仍有 pending，确保状态事件不悬挂（页面摘要不再计入本块）
  useEffect(() => {
    return () => {
      if (pendingRef.current !== null) emitSyncedBlockStatus(syncedId, false);
    };
  }, [syncedId]);

  /** 拉取远端：丢弃本地未同步修改（显式动作）。 */
  const pullRemote = useCallback(() => {
    const snapshot = remoteSnapshotRef.current;
    if (snapshot) applyRemoteContent(snapshot.content);
    setPending(null);
    setStatus("saved");
  }, [applyRemoteContent, setPending]);

  /** 用本地覆盖远端：以服务端当前 revision 为基准强制写（显式动作，非静默覆盖）。 */
  const pushLocal = useCallback(() => {
    const snapshot = remoteSnapshotRef.current;
    if (snapshot) revisionRef.current = snapshot.revision;
    setStatus("saving");
    void flushToServer(revisionRef.current ?? undefined);
  }, [flushToServer]);

  return (
    <NodeViewWrapper className="organize-synced-block" data-synced-block="" data-synced-id={syncedId} as="div">
      <div className="organize-synced-toolbar" contentEditable={false}>
        <span><Repeat2 className="h-3.5 w-3.5" />同步区块</span>
        {status === "loading" && <span className="organize-synced-status">加载中…</span>}
        {status === "saving" && (
          <span className="organize-synced-status"><Loader2 className="h-3 w-3 animate-spin" />保存中</span>
        )}
        {(status === "error" || status === "conflict") && (
          <span className="organize-synced-status text-destructive inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {status === "conflict" ? "检测到其他修改" : "同步失败"}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => {
                if (pendingRef.current === null) {
                  const content = readCurrentContent();
                  if (content) {
                    pendingRef.current = content;
                    setDirty(true);
                  }
                }
                void flushToServer();
              }}
            >
              重试
            </button>
          </span>
        )}
        {status === "stale" && (
          <span className="organize-synced-status text-amber-600 inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            远端有更新
            <button type="button" className="underline underline-offset-2" onClick={pullRemote}>拉取远端</button>
            <button type="button" className="underline underline-offset-2" onClick={pushLocal}>用本地覆盖</button>
          </span>
        )}
        {status === "saved" && dirty && (
          <span className="organize-synced-status">待同步</span>
        )}
        {status === "saved" && !dirty && syncedAt && (
          <span className="organize-synced-status" title={syncedAt}>
            <RefreshCw className="h-3 w-3" />已同步
          </span>
        )}
      </div>
      <NodeViewContent className="organize-synced-content" as="div" />
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    syncedBlock: {
      insertSyncedBlock: () => ReturnType;
    };
  }
}

export const SyncedBlock = Node.create({
  name: "syncedBlock",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      syncedId: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-synced-id") || "",
        renderHTML: (attrs) => {
          const v = String(attrs.syncedId || "");
          return v ? { "data-synced-id": v } : {};
        },
      },
      // 是否已从服务端注水（首次加载后置 true，避免重复拉取覆盖用户编辑）
      hydrated: {
        default: false,
        parseHTML: () => false,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-synced-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-synced-block": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SyncedBlockView);
  },

  addCommands() {
    return {
      insertSyncedBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            // syncedId 由 tiptap-editor 侧的 emit 监听器异步创建并回填
            attrs: { syncedId: "", hydrated: true },
            content: [{ type: "paragraph" }],
          }),
    };
  },
});

export default SyncedBlock;
