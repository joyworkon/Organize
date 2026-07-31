"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { GitGraph, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_MERMAID_CODE, looksLikeMermaid } from "./mermaid";

// mermaid 体积大，动态按需加载，避免进首屏 bundle
type MermaidRender = (id: string, text: string) => Promise<string>;
let mermaidLoader: Promise<MermaidRender> | null = null;
async function loadMermaid(): Promise<MermaidRender> {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      try {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
      } catch {
        /* 重复 initialize 在某些版本会抛错，忽略 */
      }
      return async (id: string, text: string) => {
        const { svg } = await mermaid.render(id, text);
        return svg;
      };
    });
  }
  return mermaidLoader;
}

let renderCounter = 0;

function MermaidView({ node, updateAttributes, selected }: NodeViewProps) {
  const code = String(node.attrs.code || DEFAULT_MERMAID_CODE);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderIdRef = useRef(`organize-mermaid-${++renderCounter}`);

  useEffect(() => {
    let cancelled = false;
    const text = code.trim() || DEFAULT_MERMAID_CODE;
    if (typeof window === "undefined") return;
    loadMermaid()
      .then((render) => render(renderIdRef.current, text))
      .then((out) => {
        if (!cancelled) {
          setSvg(out);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setSvg("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <NodeViewWrapper className={selected ? "organize-mermaid is-selected" : "organize-mermaid"} data-mermaid="" as="div">
      <div className="organize-mermaid-toolbar" contentEditable={false}>
        <span><GitGraph className="h-3.5 w-3.5" />Mermaid 图表</span>
        <button type="button" onClick={() => { setDraft(code); setEditing(true); }}>
          <Pencil className="h-3.5 w-3.5" />编辑源码
        </button>
      </div>
      <div ref={containerRef} className="organize-mermaid-preview" contentEditable={false}>
        {svg ? (
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        ) : error ? (
          <div className="organize-mermaid-error">
            <p>⚠️ 渲染失败：{error}</p>
            <pre>{code}</pre>
          </div>
        ) : (
          <p className="organize-mermaid-loading">正在渲染图表…</p>
        )}
      </div>

      {editing && (
        <div className="editor-dialog-backdrop" contentEditable={false}>
          <div className="editor-dialog mermaid-editor-dialog" role="dialog" aria-modal="true" aria-label="编辑 Mermaid 源码">
            <div className="editor-dialog-title">
              <div><GitGraph className="h-4 w-4" />编辑 Mermaid 源码</div>
              <button type="button" onClick={() => setEditing(false)} aria-label="关闭"><X className="h-4 w-4" /></button>
            </div>
            <p className="editor-dialog-help">
              支持 flowchart / sequence / class / state / gantt / pie 等。
              {!looksLikeMermaid(draft) && <span className="organize-mermaid-warn"> 提示：首行似乎不是图表类型关键字。</span>}
            </p>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
            <div className="editor-dialog-actions">
              <button type="button" onClick={() => setEditing(false)}>取消</button>
              <button type="button" className="primary" onClick={() => { updateAttributes({ code: draft }); setEditing(false); }}>保存并渲染</button>
            </div>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mermaid: {
      insertMermaid: () => ReturnType;
    };
  }
}

export const Mermaid = Node.create({
  name: "mermaid",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      code: {
        default: DEFAULT_MERMAID_CODE,
        parseHTML: (el) => {
          const raw = (el as HTMLElement).getAttribute("data-code");
          return raw ? decodeURIComponent(raw) : DEFAULT_MERMAID_CODE;
        },
        renderHTML: (attrs) => ({
          "data-code": encodeURIComponent(String(attrs.code || DEFAULT_MERMAID_CODE)),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-mermaid]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-mermaid": "" })];
  },

  addCommands() {
    return {
      insertMermaid:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { code: DEFAULT_MERMAID_CODE } }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
});
