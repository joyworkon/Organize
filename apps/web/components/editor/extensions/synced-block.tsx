"use client";

import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { RefreshCw, Repeat2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const SYNC_DEBOUNCE_MS = 1000;
const CHANNEL_NAME = "organize-synced-blocks";

interface SyncMessage {
  syncedId: string;
  content: JSONContent[];
  updatedAt: string;
}

function broadcast(message: SyncMessage) {
  if (typeof window === "undefined") return;
  // BroadcastChannel：跨标签页实时同步
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage(message);
  channel.close();
  // 同标签页内多实例：用 CustomEvent（BroadcastChannel 不回传本页发送者）
  window.dispatchEvent(new CustomEvent(CHANNEL_NAME, { detail: message }));
}

/**
 * 把 ProseMirror 节点序列化为可存储/恢复的 content 数组。
 */
function nodeToContent(node: { toJSON: () => JSONContent }): JSONContent[] {
  const json = node.toJSON();
  return Array.isArray(json.content) ? json.content : [];
}

function SyncedBlockView({ node, editor, getPos }: NodeViewProps) {
  const syncedId = String(node.attrs.syncedId || "");
  const [loading, setLoading] = useState(!node.attrs.hydrated);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBroadcastRef = useRef<number>(0);

  // 首次渲染：若未注水（hydrated），从服务端拉最新内容覆盖本地
  useEffect(() => {
    if (!syncedId || node.attrs.hydrated) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/synced-blocks?ids=${encodeURIComponent(syncedId)}`);
        const data: { id: string; content: JSONContent[]; updated_at?: string }[] = await res.json();
        const row = Array.isArray(data) ? data[0] : undefined;
        if (cancelled || !row) {
          setLoading(false);
          return;
        }
        const pos = typeof getPos === "function" ? (getPos() as number) : null;
        if (pos === null) {
          setLoading(false);
          return;
        }
        // 用服务端内容替换本块的子内容（保留块本身与 attrs）
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            hydrated: true,
          })
        );
        replaceBlockContent(editor, pos, row.content);
        setSyncedAt(row.updated_at || null);
      } catch {
        /* 离线或未创建：用本地内容即可 */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedId]);

  // 监听跨实例/跨标签同步消息，实时更新本块内容
  useEffect(() => {
    if (!syncedId) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<SyncMessage>).detail;
      if (!detail || detail.syncedId !== syncedId) return;
      // 跳过自己刚发出的（避免编辑时光标乱跳）
      if (Date.now() - lastBroadcastRef.current < SYNC_DEBOUNCE_MS) return;
      const pos = typeof getPos === "function" ? (getPos() as number) : null;
      if (pos === null) return;
      replaceBlockContent(editor, pos, detail.content);
      setSyncedAt(detail.updatedAt);
    };
    // BroadcastChannel（跨标签）
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL_NAME) : null;
    channel?.addEventListener("message", (e: MessageEvent<SyncMessage>) => {
      handler(new CustomEvent(CHANNEL_NAME, { detail: e.data }));
    });
    window.addEventListener(CHANNEL_NAME, handler);
    return () => {
      channel?.close();
      window.removeEventListener(CHANNEL_NAME, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedId]);

  // 防抖持久化 + 广播：监听本块内容变化（通过 editor transaction）
  useEffect(() => {
    const onTransaction = () => {
      if (!syncedId || loading) return;
      const pos = typeof getPos === "function" ? (getPos() as number) : null;
      if (pos === null) return;
      const currentNode = editor.state.doc.nodeAt(pos);
      if (!currentNode) return;
      const content = nodeToContent(currentNode);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        // 写回服务端
        try {
          const res = await fetch(`/api/synced-blocks/${syncedId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
          });
          const data: { updated_at?: string } = await res.json();
          const updatedAt = data.updated_at || new Date().toISOString();
          setSyncedAt(updatedAt);
          // 广播给其它实例（同页 + 跨标签）
          lastBroadcastRef.current = Date.now();
          broadcast({ syncedId, content, updatedAt });
        } catch {
          /* 离线：静默失败，下次联网时由 debounced 写入重试 */
        }
      }, SYNC_DEBOUNCE_MS);
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedId, loading, editor]);

  return (
    <NodeViewWrapper className="organize-synced-block" data-synced-block="" data-synced-id={syncedId} as="div">
      <div className="organize-synced-toolbar" contentEditable={false}>
        <span><Repeat2 className="h-3.5 w-3.5" />同步区块</span>
        {loading && <span className="organize-synced-status">同步中…</span>}
        {!loading && syncedAt && (
          <span className="organize-synced-status" title={syncedAt}>
            <RefreshCw className="h-3 w-3" />已同步
          </span>
        )}
      </div>
      <NodeViewContent className="organize-synced-content" as="div" />
    </NodeViewWrapper>
  );
}

/** 用新的 content 数组替换某个块（pos 处）的全部子节点。 */
function replaceBlockContent(editor: Editor, pos: number, content: JSONContent[]) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const start = pos + 1;
  const end = pos + node.nodeSize - 1;
  const tr = editor.state.tr.replaceWith(start, end, content.map((c) => editor.schema.nodeFromJSON(c)));
  editor.view.dispatch(tr);
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
