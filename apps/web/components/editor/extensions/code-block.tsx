"use client";

import CodeBlock from "@tiptap/extension-code-block";
import { getRenderedAttributes } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection } from "@tiptap/pm/state";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import {
  codeBlockCopyText,
  codeBlockSelectionState,
  inlineStyleToObject,
  normalizeCodeBlockLanguage,
  normalizeCodeBlockWrap,
  shouldShowCodeBlockToolbar,
  storedCodeBlockLanguage,
  type CodeBlockSelectionState,
} from "@/lib/editor/code-block-language";
import { CodeBlockToolbar } from "../code-block-toolbar";

/**
 * 代码块 NodeView：DOM 保持 `pre > code`（code 是 TipTap 创建的 contentDOM，文本编辑 / IME /
 * 协作仍由 ProseMirror 处理），现有 `.organize-editor pre` 样式直接复用。
 * 渲染属性（data-id / 块背景 / data-wrap 等）实时算出后挂在 pre 上——与没有 NodeView 时位置一致，
 * 触屏按 `[data-id]` 找块、块背景的 inline style 都不受影响。
 */
export function CodeBlockView({ node, editor, getPos }: NodeViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [editable, setEditable] = useState(editor.isEditable);
  const [focused, setFocused] = useState(editor.isFocused);
  const [interacting, setInteracting] = useState(false);
  const [selection, setSelection] = useState<{ state: CodeBlockSelectionState; empty: boolean }>({ state: "none", empty: true });
  const extensionAttributes = useMemo(() => editor.extensionManager.attributes, [editor]);

  useEffect(() => {
    const sync = () => {
      setEditable(editor.isEditable);
      const pos = getPos();
      const current = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
      const next = typeof pos === "number" && current?.type.name === "codeBlock"
        ? { state: codeBlockSelectionState(editor.state.selection, pos, current.nodeSize), empty: editor.state.selection.empty }
        : { state: "none" as const, empty: true };
      setSelection((previous) => (previous.state === next.state && previous.empty === next.empty ? previous : next));
    };
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    sync();
    editor.on("transaction", sync);
    editor.on("update", sync);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    return () => {
      editor.off("transaction", sync);
      editor.off("update", sync);
      editor.off("focus", onFocus);
      editor.off("blur", onBlur);
    };
  }, [editor, getPos]);

  // Resolve this NodeView's node at commit time; never trust a stale pos (same contract as the image block).
  const target = () => {
    if (editor.isDestroyed) return null;
    const pos = getPos();
    if (typeof pos !== "number") return null;
    const current = editor.state.doc.nodeAt(pos);
    return current?.type.name === "codeBlock" ? { pos, current } : null;
  };
  // closeHistory on both sides keeps the attribute change its own undo step, apart from surrounding typing.
  // A NodeSelection on a textblock maps to a caret after setNodeMarkup (unlike atoms), so re-select the block.
  const change = (attrs: Record<string, unknown>) => {
    const found = target();
    if (!found || !editor.isEditable) return;
    const transaction = closeHistory(editor.state.tr).setNodeMarkup(found.pos, undefined, { ...found.current.attrs, ...attrs });
    if (codeBlockSelectionState(editor.state.selection, found.pos, found.current.nodeSize) === "node") {
      transaction.setSelection(NodeSelection.create(transaction.doc, found.pos));
    }
    editor.view.dispatch(transaction);
    editor.view.dispatch(closeHistory(editor.state.tr));
  };
  const copy = async () => {
    const found = target();
    if (!found) return;
    try {
      await navigator.clipboard.writeText(codeBlockCopyText(found.current));
      toast({ title: "代码已复制" });
    } catch {
      toast({ title: "复制失败，请手动选中代码后复制", variant: "destructive" });
    }
  };

  const language = storedCodeBlockLanguage(node.attrs.language);
  const wrap = normalizeCodeBlockWrap(node.attrs.wrap);
  const { style, class: className, ...rendered } = getRenderedAttributes(node, extensionAttributes) as Record<string, string | undefined>;
  const visible = shouldShowCodeBlockToolbar({
    state: selection.state,
    selectionEmpty: selection.empty,
    editable,
    editorFocused: focused,
    interacting,
  });
  return <NodeViewWrapper ref={wrapperRef} className="organize-code-block" data-language={language ?? undefined}>
    {/* NodeViewContent 默认 inline white-space: pre-wrap；代码块缺省必须是 pre（横向滚动，与改前一致），所以 inline 覆盖 */}
    <NodeViewContent as="pre" {...rendered} className={className} data-language={language ?? undefined}
      style={{ ...inlineStyleToObject(style), whiteSpace: wrap ? "pre-wrap" : "pre" }} />
    {visible && <CodeBlockToolbar anchor={wrapperRef} editable={editable} language={normalizeCodeBlockLanguage(node.attrs.language)} wrap={wrap}
      onLanguageChange={(next) => change({ language: next })}
      onWrapChange={(next) => change({ wrap: next })}
      onCopy={() => void copy()}
      onInteractionStart={() => setInteracting(true)}
      onInteractionEnd={(refocusEditor) => {
        if (refocusEditor && !editor.isDestroyed) editor.view.focus();
        setInteracting(false);
      }} />}
  </NodeViewWrapper>;
}

/**
 * 在 StarterKit 的 CodeBlock 之上只加一个可选属性 `wrap`（缺省 false = 改前表现，只有 true 才输出
 * `data-wrap="true"`），`language` 沿用上游属性与解析 / 渲染合同；不引入语法高亮。
 */
export const OrganizeCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      wrap: {
        default: false,
        parseHTML: (element) => normalizeCodeBlockWrap(element.getAttribute("data-wrap")),
        renderHTML: (attributes) => (normalizeCodeBlockWrap(attributes.wrap) ? { "data-wrap": "true" } : {}),
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView, { contentDOMElementTag: "code" });
  },
});

export default OrganizeCodeBlock;
