"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Code2, Pencil, X } from "lucide-react";
import { useMemo, useState } from "react";

const DEFAULT_HTML = `<div class="demo">HTML 嵌入块</div>
<style>
  body { margin: 0; padding: 24px; font: 16px system-ui; }
  .demo { padding: 20px; border: 1px solid #ddd; border-radius: 10px; }
</style>`;

function buildSrcDoc(html: string) {
  const csp = [
    "default-src 'none'",
    "img-src data:",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
    "font-src data:",
    "media-src blob: data:",
    "connect-src 'none'",
    "form-action 'none'",
  ].join("; ");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${html}</body></html>`;
}

function HtmlEmbedView({ node, updateAttributes, selected }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(node.attrs.html || DEFAULT_HTML));
  const srcDoc = useMemo(() => buildSrcDoc(String(node.attrs.html || DEFAULT_HTML)), [node.attrs.html]);

  return (
    <NodeViewWrapper className={selected ? "html-embed is-selected" : "html-embed"}>
      <div className="html-embed-toolbar" contentEditable={false}>
        <span><Code2 className="h-3.5 w-3.5" />HTML 嵌入</span>
        <button type="button" onClick={() => { setDraft(String(node.attrs.html || DEFAULT_HTML)); setEditing(true); }}><Pencil className="h-3.5 w-3.5" />编辑</button>
      </div>
      <iframe
        title="HTML 嵌入预览"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        style={{ height: Number(node.attrs.height) || 260 }}
      />
      {editing && (
        <div className="editor-dialog-backdrop" contentEditable={false}>
          <div className="editor-dialog html-editor-dialog" role="dialog" aria-modal="true" aria-label="编辑 HTML 嵌入">
            <div className="editor-dialog-title">
              <div><Code2 className="h-4 w-4" />编辑 HTML</div>
              <button type="button" onClick={() => setEditing(false)} aria-label="关闭"><X className="h-4 w-4" /></button>
            </div>
            <p className="editor-dialog-help">脚本在隔离沙箱中运行，无法访问登录态、父页面或发起网络请求。</p>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />
            <div className="editor-dialog-actions">
              <button type="button" onClick={() => setEditing(false)}>取消</button>
              <button type="button" className="primary" onClick={() => { updateAttributes({ html: draft }); setEditing(false); }}>保存并预览</button>
            </div>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    htmlEmbed: {
      insertHtmlEmbed: (html?: string) => ReturnType;
    };
  }
}

export const HtmlEmbed = Node.create({
  name: "htmlEmbed",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      html: { default: DEFAULT_HTML },
      height: { default: 260 },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-html-embed]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-html-embed": "" })];
  },

  addCommands() {
    return {
      insertHtmlEmbed:
        (html = DEFAULT_HTML) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { html, height: 260 } }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(HtmlEmbedView);
  },
});
