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
  createSyncSessionId,
  fetchSyncedBlock,
  patchSyncedBlock,
  replaceSyncedBlockContent,
  shouldAcceptSyncMessage,
  syncedBlockNeedsSync,
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

type SyncedStatus = "loading" | "saved" | "saving" | "error";

function SyncedBlockView({ node, editor, getPos }: NodeViewProps) {
  const syncedId = String(node.attrs.syncedId || "");
  const [status, setStatus] = useState<SyncedStatus>(node.attrs.hydrated ? "saved" : "loading");
  const [dirty, setDirty] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 待写快照：编辑后始终先落在内存，服务器确认成功才清空；失败时保留供重试
  const pendingRef = useRef<JSONContent[] | null>(null);
  const inflightRef = useRef(false);
  const sessionRef = useRef(createSyncSessionId());
  const seqRef = useRef(0);
  const lastSeqByOriginRef = useRef<Map<string, number>>(new Map());

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

  /** 把待写快照提交到服务端；只有确认成功才清 pending 并广播。 */
  const flushToServer = useCallback(async () => {
    if (inflightRef.current) return;
    const content = pendingRef.current;
    if (content === null) return;
    inflightRef.current = true;
    setStatus("saving");
    const result = await patchSyncedBlock(syncedId, content);
    inflightRef.current = false;
    if (result.ok) {
      // 保存期间又有新编辑时保留 dirty 并立刻再排空
      const stillPending = pendingRef.current !== null && pendingRef.current !== content;
      if (!stillPending) {
        pendingRef.current = null;
        setDirty(false);
      }
      setSyncedAt(result.updatedAt);
      setStatus("saved");
      seqRef.current += 1;
      broadcast({
        syncedId,
        content,
        updatedAt: result.updatedAt,
        origin: sessionRef.current,
        seq: seqRef.current,
      });
      if (stillPending) void flushToServer();
    } else {
      // 失败：保留待写快照，块内显示重试；不广播、不显示已同步
      setStatus("error");
    }
  }, [syncedId]);

  const scheduleFlush = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void flushToServer();
    }, SYNC_DEBOUNCE_MS);
  }, [flushToServer]);

  // 首次渲染：若未注水（hydrated），从服务端拉最新内容；失败不进入成功分支
  useEffect(() => {
    if (!syncedId || node.attrs.hydrated) return;
    let cancelled = false;
    (async () => {
      const result = await fetchSyncedBlock(syncedId);
      if (cancelled) return;
      if (!result.ok) {
        // 404（未创建）沿用本地内容；其余失败保留本地内容但块内提示，可重试拉取
        setStatus(result.reason === "not-found" ? "saved" : "error");
        return;
      }
      const pos = currentPos();
      if (pos === null) return;
      // hydrated 标记 + 内容替换都是远端来源事务：不触发回写
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          hydrated: true,
        })
      );
      replaceSyncedBlockContent(editor, pos, result.content, syncedId);
      setSyncedAt(result.updatedAt);
      setStatus("saved");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedId]);

  // 监听跨实例/跨标签同步消息；origin+seq 来源识别，不用时间窗口
  useEffect(() => {
    if (!syncedId) return;
    const handler = (message: SyncMessage | null | undefined) => {
      if (!shouldAcceptSyncMessage(message, sessionRef.current, lastSeqByOriginRef.current)) return;
      if (!message || message.syncedId !== syncedId) return;
      const pos = currentPos();
      if (pos === null) return;
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
      scheduleFlush();
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedId, editor, currentPos, readCurrentContent, scheduleFlush]);

  return (
    <NodeViewWrapper className="organize-synced-block" data-synced-block="" data-synced-id={syncedId} as="div">
      <div className="organize-synced-toolbar" contentEditable={false}>
        <span><Repeat2 className="h-3.5 w-3.5" />同步区块</span>
        {status === "loading" && <span className="organize-synced-status">加载中…</span>}
        {status === "saving" && (
          <span className="organize-synced-status"><Loader2 className="h-3 w-3 animate-spin" />保存中</span>
        )}
        {status === "error" && (
          <span className="organize-synced-status text-destructive inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            同步失败
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => {
                if (pendingRef.current === null) {
                  const content = readCurrentContent();
                  if (content) pendingRef.current = content;
                }
                void flushToServer();
              }}
            >
              重试
            </button>
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
