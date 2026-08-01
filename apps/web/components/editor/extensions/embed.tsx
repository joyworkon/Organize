"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ExternalLink, Link2, Pencil, X } from "lucide-react";
import { useState } from "react";

interface OEmbedData {
  url: string;
  kind: "embed" | "link-card";
  provider?: string;
  title: string;
  description?: string;
  html?: string;
  sandbox?: string;
  cover?: string | null;
  siteName?: string;
}

// 安全约束：srcDoc 禁止 allow-same-origin（见 providers.ts SANDBOX_SCRIPTS 注释）。
const DEFAULT_SANDBOX = "allow-scripts allow-popups allow-presentation";

function EmbedView({ node, updateAttributes, selected }: NodeViewProps) {
  const url = String(node.attrs.url || "");
  const title = String(node.attrs.title || "");
  const provider = String(node.attrs.provider || "");
  const description = String(node.attrs.description || "");
  const cover = String(node.attrs.cover || "");
  const siteName = String(node.attrs.siteName || "");
  const html = String(node.attrs.html || "");
  // 安全：渲染时强制剔除 allow-same-origin，即使历史持久化的 attrs 里带了。
  // （srcDoc + allow-scripts + allow-same-origin = sandbox 失效，P0 安全约束）
  const rawSandbox = String(node.attrs.sandbox || DEFAULT_SANDBOX);
  const sandbox = rawSandbox.replace(/(^|\s)allow-same-origin(\s|$)/g, " ").trim() || DEFAULT_SANDBOX;
  const hasEmbed = Boolean(html);

  const [editing, setEditing] = useState(false);
  const [draftUrl, setDraftUrl] = useState(url);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEmbed = async (targetUrl: string) => {
    if (!targetUrl.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/oembed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });
      const data: OEmbedData & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error || "解析失败");
      updateAttributes({
        url: data.url,
        provider: data.provider || "",
        title: data.title || "",
        description: data.description || "",
        cover: data.cover || "",
        siteName: data.siteName || "",
        html: data.html || "",
        sandbox: data.sandbox || DEFAULT_SANDBOX,
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析失败，请检查链接");
    } finally {
      setLoading(false);
    }
  };

  const openExternal = () => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <NodeViewWrapper className={selected ? "organize-embed-wrap is-selected" : "organize-embed-wrap"} data-embed="" as="div">
      <div className="organize-embed-toolbar" contentEditable={false}>
        <span><Link2 className="h-3.5 w-3.5" />{provider ? `${provider} 嵌入` : "嵌入"}</span>
        <button type="button" onClick={() => { setDraftUrl(url); setError(null); setEditing(true); }}>
          <Pencil className="h-3.5 w-3.5" />编辑链接
        </button>
        {url && (
          <button type="button" onClick={openExternal} title="在新标签打开原链接">
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {hasEmbed ? (
        <div className="organize-embed-frame" contentEditable={false}>
          <iframe
            title={title || "嵌入内容"}
            srcDoc={html}
            sandbox={sandbox}
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        </div>
      ) : url ? (
        <a className="organize-link-card" href={url} target="_blank" rel="noopener noreferrer" contentEditable={false}>
          {cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="organize-link-card-cover" src={cover} alt="" />
          )}
          <div className="organize-link-card-body">
            <div className="organize-link-card-title">{title || url}</div>
            {description && <div className="organize-link-card-desc">{description}</div>}
            <div className="organize-link-card-site">{siteName}</div>
          </div>
        </a>
      ) : (
        <div className="organize-embed-placeholder" contentEditable={false}>
          <Link2 className="h-5 w-5" />
          <p>粘贴一个链接（视频、地图、社媒等）生成嵌入预览</p>
        </div>
      )}

      {editing && (
        <div className="editor-dialog-backdrop" contentEditable={false}>
          <div className="editor-dialog" role="dialog" aria-modal="true" aria-label="编辑嵌入链接">
            <div className="editor-dialog-title">
              <div><Link2 className="h-4 w-4" />嵌入链接</div>
              <button type="button" onClick={() => setEditing(false)} aria-label="关闭"><X className="h-4 w-4" /></button>
            </div>
            <p className="editor-dialog-help">支持 YouTube / Bilibili / Vimeo / 推特 / 地图 / GitHub Gist，其余链接生成预览卡片。</p>
            <label className="editor-field">
              <span>链接 URL</span>
              <input
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder="https://..."
                onKeyDown={(e) => { if (e.key === "Enter") fetchEmbed(draftUrl); }}
              />
            </label>
            {error && <p className="editor-dialog-error">{error}</p>}
            <div className="editor-dialog-actions">
              <button type="button" onClick={() => setEditing(false)}>取消</button>
              <button type="button" className="primary" disabled={loading} onClick={() => fetchEmbed(draftUrl)}>
                {loading ? "解析中…" : "解析并嵌入"}
              </button>
            </div>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embed: {
      insertEmbed: (url?: string) => ReturnType;
    };
  }
}

function stringAttr(dataKey: string) {
  return {
    default: "",
    parseHTML: (el: HTMLElement) => el.getAttribute(`data-${dataKey}`) || "",
    renderHTML: (attrs: Record<string, unknown>) => {
      const v = String(attrs[dataKey] || "");
      return v ? { [`data-${dataKey}`]: v } : {};
    },
  };
}

export const Embed = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: stringAttr("url"),
      provider: stringAttr("provider"),
      title: stringAttr("title"),
      description: stringAttr("description"),
      cover: stringAttr("cover"),
      // 属性名 siteName，存储为 data-site-name
      siteName: stringAttr("site-name"),
      html: stringAttr("html"),
      sandbox: stringAttr("sandbox"),
    };
  },

  parseHTML() {
    return [{ tag: "div[data-embed]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-embed": "" })];
  },

  addCommands() {
    return {
      insertEmbed:
        (url = "") =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { url, sandbox: DEFAULT_SANDBOX } }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
});
