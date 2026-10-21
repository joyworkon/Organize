"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, GitGraph, Pencil } from "@/components/icons";
import { copyMermaidSource, editMermaidAt, editSelectedMermaid } from "../mermaid-actions";
import { MermaidToolbar } from "../mermaid-toolbar";
import { useMermaidPreview } from "../use-mermaid-preview";
import { DEFAULT_MERMAID_CODE } from "./mermaid";

/** 持久化合同不变：仍只有 `code` 一个属性，DOM 仍是 `div[data-mermaid]`。 */
export function MermaidView({ node, editor, getPos, selected }: NodeViewProps) {
  const code = String(node.attrs.code || DEFAULT_MERMAID_CODE);
  // 工具栏锚点是包裹层本身（父元素）：父 ref 在子组件 layout effect 之后才赋值，
  // 首次就处于选中态时会读到 null；放进 state，等元素存在再挂工具栏
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [, refresh] = useState(0);
  // 只读切换不会触发 NodeView 重渲，和公式一样订阅编辑器事件刷新按钮可见性
  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    editor.on("transaction", update);
    editor.on("update", update);
    return () => { editor.off("transaction", update); editor.off("update", update); };
  }, [editor]);
  const { svg, error } = useMermaidPreview(code);
  const editable = editor.isEditable;

  const select = () => {
    const pos = getPos();
    if (typeof pos === "number") editor.commands.setNodeSelection(pos);
  };
  const edit = () => {
    const pos = getPos();
    if (typeof pos === "number") editMermaidAt(editor, pos);
  };

  return (
    <NodeViewWrapper ref={setWrapper} className={selected ? "organize-mermaid is-selected" : "organize-mermaid"} data-mermaid="" as="div">
      <div className="organize-mermaid-toolbar" contentEditable={false}>
        <span className="organize-mermaid-toolbar-label"><GitGraph className="h-3.5 w-3.5" aria-hidden="true" />Mermaid 图表</span>
        <span className="organize-mermaid-toolbar-actions">
          {editable && (
            <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs" onClick={edit}>
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />编辑源码
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => void copyMermaidSource(code)}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />复制源码
          </Button>
        </span>
      </div>
      {/* 不阻止 mousedown 默认行为：节点可拖拽，PM 自己会在 mouseup 时聚焦编辑器并整块选中。
          双击不用 React onDoubleClick：PM 为可拖拽节点在 mousedown/mouseup 间切换 draggable 属性，
          Chrome 因此不合成 click/dblclick；改由扩展的 handleDoubleClickOn（PM 自己的双击判定）打开 */}
      <div ref={preview} className="organize-mermaid-preview" contentEditable={false} tabIndex={0} role="button"
        aria-label={editable ? "编辑 Mermaid 图表" : "选择 Mermaid 图表，复制源码"} aria-haspopup={editable ? "dialog" : undefined}
        onFocus={select}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e")) {
            event.preventDefault(); event.stopPropagation(); edit();
          } else if (event.key === " ") {
            event.preventDefault(); select();
          } else if (event.key === "Escape") {
            event.preventDefault(); editor.view.focus();
          }
        }}>
        {svg ? (
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        ) : error ? (
          <div className="organize-mermaid-error">
            <p>渲染失败：{error}</p>
            <pre>{code}</pre>
          </div>
        ) : (
          <p className="organize-mermaid-loading">正在渲染图表…</p>
        )}
      </div>
      {selected && wrapper && <MermaidToolbar editor={editor} anchor={wrapper} code={code} onEdit={edit} onEscape={() => preview.current?.focus()} />}
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
  // 整块选中时 Enter / Mod-e 要先于默认 keymap 与行内代码的 Mod-e；paragraph(1000) 仍是 schema 默认块
  priority: 200,

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

  addKeyboardShortcuts() {
    const edit = () => editSelectedMermaid(this.editor);
    return { Enter: edit, "Mod-e": edit };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("mermaidDoubleClick"),
        props: {
          // 只响应直接落在图表节点上的双击；只读时 editMermaidAt 返回 false，交回默认行为
          handleDoubleClickOn: (_view, _pos, node, nodePos, _event, direct) =>
            direct && node.type.name === "mermaid" ? editMermaidAt(editor, nodePos) : false,
        },
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
});
