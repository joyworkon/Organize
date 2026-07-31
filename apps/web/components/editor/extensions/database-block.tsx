"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Database as DatabaseIcon, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Database as DatabaseRecord } from "@organize/shared";

/**
 * databaseBlock —— 数据库块（atom）
 *
 * PR-2 阶段：仅作占位 NodeView，拉取数据库标题 / 图标显示为卡片。
 * PR-3 会把表格视图（table-view.tsx）接入这里。
 *
 * attrs:
 *   - databaseId: 关联 db_databases.id（空串 = 未创建的占位）
 *   - viewId:     当前视图 id，默认 "default_view"
 */

function DatabaseBlockView({ node, selected }: NodeViewProps) {
  const databaseId = String(node.attrs.databaseId || "");
  const [record, setRecord] = useState<DatabaseRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(databaseId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!databaseId) {
      setRecord(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/databases/${encodeURIComponent(databaseId)}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setError(data?.error || "加载失败");
          setRecord(null);
        } else {
          setRecord(data as DatabaseRecord);
        }
      })
      .catch(() => {
        if (!cancelled) setError("网络错误");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [databaseId]);

  const title = record?.title || (loading ? "加载中…" : "未命名数据库");
  const icon = record?.icon || "";
  const parentNoteId = record?.parent_note_id;

  return (
    <NodeViewWrapper
      className={selected ? "organize-database-block is-selected" : "organize-database-block"}
      data-database-block=""
      data-database-id={databaseId}
      as="div"
    >
      <div className="organize-database-header" contentEditable={false}>
        <span className="organize-database-badge">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DatabaseIcon className="h-3.5 w-3.5" />}
          {icon ? <span className="organize-database-icon">{icon}</span> : null}
          <span className="organize-database-title">{title}</span>
        </span>
        {parentNoteId && (
          <a
            className="organize-database-open"
            href={`/notes/${parentNoteId}`}
            title="在新页面打开"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />打开
          </a>
        )}
      </div>
      <div className="organize-database-placeholder" contentEditable={false}>
        {error ? (
          <p className="organize-database-error">⚠️ {error}</p>
        ) : loading ? (
          <p>正在加载数据库…</p>
        ) : (
          <p className="organize-database-hint">
            数据表格视图将在后续版本提供（M3 PR-3）。
            {parentNoteId ? " 当前为整页数据库，可点击右上角「打开」跳转。" : ""}
          </p>
        )}
      </div>
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    databaseBlock: {
      insertDatabaseBlock: (attrs: { databaseId: string; viewId?: string }) => ReturnType;
    };
  }
}

export const DatabaseBlock = Node.create({
  name: "databaseBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      databaseId: {
        default: "",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-database-id") || "",
        renderHTML: (attrs) => {
          const v = String(attrs.databaseId || "");
          return v ? { "data-database-id": v } : {};
        },
      },
      viewId: {
        default: "default_view",
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-view-id") || "default_view",
        renderHTML: (attrs) => ({ "data-view-id": String(attrs.viewId || "default_view") }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-database-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-database-block": "" })];
  },

  addCommands() {
    return {
      insertDatabaseBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              databaseId: attrs.databaseId || "",
              viewId: attrs.viewId || "default_view",
            },
          }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(DatabaseBlockView);
  },
});

export default DatabaseBlock;
