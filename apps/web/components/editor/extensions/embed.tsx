"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ExternalLink, Link2, Pencil } from "@/components/icons";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { isBareHttpUrl } from "@/lib/editor/paste-url-embed";

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

export function EmbedView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
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
  const sandbox = rawSandbox.split(/\s+/).filter((token) => token && token !== "allow-same-origin").join(" ") || DEFAULT_SANDBOX;
  const hasEmbed = Boolean(html);

  const [editing, setEditing] = useState(false);
  const [draftUrl, setDraftUrl] = useState(url);
  const [loading, setLoading] = useState(Boolean(url && !title && !html && editor.isEditable));
  const [error, setError] = useState<string | null>(null);
  const [retryUrl, setRetryUrl] = useState(url);
  const [editable, setEditable] = useState(editor.isEditable);
  const id = useId();
  const attempted = useRef<string | null>(null);
  const active = useRef<{ url: string; controller: AbortController } | null>(null);

  useEffect(() => {
    const check = () => {
      setEditable(editor.isEditable);
      if (!editor.isEditable) {
        if (active.current) attempted.current = null;
        active.current?.controller.abort();
        active.current = null;
        setLoading(false);
        setEditing(false);
      }
    };
    editor.on("transaction", check);
    editor.on("update", check);
    return () => {
      editor.off("transaction", check);
      editor.off("update", check);
      active.current?.controller.abort();
      active.current = null;
      attempted.current = null;
    };
  }, [editor]);

  const fetchEmbed = useCallback(async (input: string) => {
    if (editor.isDestroyed || !editor.isEditable) return;
    const targetUrl = isBareHttpUrl(input);
    if (!targetUrl) { setLoading(false); setError("请输入有效的 http/https 链接"); return; }
    if (active.current?.url === targetUrl) return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    const snapshot = editor.state.doc.nodeAt(pos);
    if (!snapshot || snapshot.type.name !== "embed") return;
    active.current?.controller.abort();
    const request = { url: targetUrl, controller: new AbortController() };
    active.current = request;
    setRetryUrl(targetUrl);
    setLoading(true);
    setError(null);
    // getPos follows moves; a deleted/replaced/edited node must never receive old results.
    const isCurrent = () => {
      if (active.current !== request || editor.isDestroyed || !editor.isEditable) return false;
      const currentPos = getPos();
      if (typeof currentPos !== "number") return false;
      const current = editor.state.doc.nodeAt(currentPos);
      // Initial ID backfill is metadata, not a user edit of the preview.
      return current?.type === snapshot.type && Object.entries(snapshot.attrs).every(([key, value]) =>
        (key === "id" && !value) || current.attrs[key] === value);
    };
    try {
      const res = await fetch("/api/oembed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
        signal: request.controller.signal,
      });
      const data: OEmbedData & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error || "解析失败");
      if (!data.title && !data.html) throw new Error("未获取到预览，请重试");
      if (!isCurrent()) return;
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
      if (isCurrent() && !request.controller.signal.aborted) setError(err instanceof Error ? err.message : "解析失败，请检查链接");
    } finally {
      if (active.current === request) { active.current = null; setLoading(false); }
    }
  }, [editor, getPos, updateAttributes]);

  useEffect(() => {
    if (!editable || !url || title || html || attempted.current === url) return;
    attempted.current = url;
    void fetchEmbed(url);
  }, [editable, url, title, html, fetchEmbed]);

  const openExternal = () => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <NodeViewWrapper className={selected ? "organize-embed-wrap is-selected" : "organize-embed-wrap"} data-embed="" data-id={node.attrs.id} data-embed-status={loading ? "loading" : error ? "error" : title || html ? "ready" : "empty"} as="div">
      <Dialog open={editing && editable} onOpenChange={setEditing}>
      <div className="organize-embed-toolbar" contentEditable={false}>
        <span><Link2 className="h-3.5 w-3.5" />{provider ? `${provider} 嵌入` : "嵌入"}</span>
        {editable && <DialogTrigger asChild><Button type="button" variant="ghost" size="sm" onClick={() => { setDraftUrl(url); }}>
          <Pencil className="h-3.5 w-3.5" />编辑链接
        </Button></DialogTrigger>}
        {url && (
          <Button type="button" variant="ghost" size="icon" onClick={openExternal} title="在新标签打开原链接" aria-label="在新标签打开原链接">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {(loading || error) && <div className="organize-embed-status" contentEditable={false} aria-busy={loading}>
        <div className="min-w-0 flex-1">
          <p role={error ? "alert" : "status"}>{loading ? "解析中…" : `解析失败：${error}`}</p>
          {(retryUrl || url) && <a href={retryUrl || url} target="_blank" rel="noopener noreferrer" className="block break-all text-sm text-muted-foreground">{retryUrl || url}</a>}
        </div>
        {error && editable && <Button type="button" variant="outline" onClick={() => { void fetchEmbed(retryUrl || url); }}>重试</Button>}
      </div>}
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
      ) : url && title ? (
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
      ) : !loading && !error ? (
        <div className="organize-embed-placeholder" contentEditable={false}>
          <Link2 className="h-5 w-5" />
          <p>{url || "粘贴一个链接（视频、地图、社媒等）生成嵌入预览"}</p>
        </div>
      ) : null}

      <DialogContent aria-label="编辑嵌入链接" contentEditable={false}>
        <DialogHeader>
          <DialogTitle>编辑嵌入链接</DialogTitle>
          <DialogDescription>支持 YouTube / Bilibili / Vimeo / 推特 / 地图 / GitHub Gist，其余链接生成预览卡片。</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); void fetchEmbed(draftUrl); }}>
          <label className="editor-field" htmlFor={id}>
            <span>链接 URL</span>
            <input id={id} value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} placeholder="https://..."
              aria-describedby={error ? `${id}-error` : undefined} aria-invalid={Boolean(error)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
              }} />
          </label>
          {error && <p id={`${id}-error`} role="alert" className="mt-2 break-words text-sm text-destructive">{error}</p>}
          <DialogFooter className="mt-4 gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>取消</Button>
            <Button type="submit" disabled={loading}>{loading ? "解析中…" : "解析并嵌入"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      </Dialog>
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
