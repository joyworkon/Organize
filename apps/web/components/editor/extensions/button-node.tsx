"use client";

import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { MousePointerClick, Pencil, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  DEFAULT_BUTTON_ATTRS,
  isSafeButtonUrl,
  normalizeButtonAction,
  parseButtonBlocksPayload,
  type ButtonAction,
} from "./button-block";

function runButtonAction(editor: Editor, pos: number, action: ButtonAction, payload: string) {
  if (action === "open-url") {
    if (!isSafeButtonUrl(payload)) return;
    // 站内路径用 router push（保持 SPA），外链新开标签
    if (payload.startsWith("/")) {
      window.location.assign(payload);
    } else {
      window.open(payload, "_blank", "noopener,noreferrer");
    }
    return;
  }
  const blocks = parseButtonBlocksPayload(payload);
  if (!blocks) return;
  // 在按钮块之后插入预设块模板
  editor.chain().focus().insertContentAt(pos + editor.state.doc.nodeAt(pos)!.nodeSize, blocks).run();
}

function ButtonView({ node, updateAttributes, editor, selected, getPos }: NodeViewProps) {
  const label = String(node.attrs.label || DEFAULT_BUTTON_ATTRS.label);
  const action = normalizeButtonAction(node.attrs.action);
  const payload = String(node.attrs.payload || "");
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(label);
  const [draftAction, setDraftAction] = useState<ButtonAction>(action);
  const [draftPayload, setDraftPayload] = useState(payload);

  const safe = useMemo(() => action !== "open-url" || isSafeButtonUrl(payload), [action, payload]);

  const openEditor = () => {
    setDraftLabel(label);
    setDraftAction(action);
    setDraftPayload(payload);
    setEditing(true);
  };

  const save = () => {
    updateAttributes({ label: draftLabel.trim() || "按钮", action: draftAction, payload: draftPayload });
    setEditing(false);
  };

  const handleClick = () => {
    const pos = typeof getPos === "function" ? getPos() : null;
    if (pos === null) return;
    runButtonAction(editor, pos, action, payload);
  };

  return (
    <NodeViewWrapper
      className={selected ? "organize-button-wrap is-selected" : "organize-button-wrap"}
      data-button-block=""
      contentEditable={false}
      as="div"
    >
      <div className="organize-button-toolbar">
        <span><MousePointerClick className="h-3.5 w-3.5" />按钮</span>
        <button type="button" onClick={openEditor}><Pencil className="h-3.5 w-3.5" />编辑</button>
      </div>
      <button
        type="button"
        className="organize-button"
        onClick={handleClick}
        title={action === "open-url" ? `点击打开：${payload}` : "点击插入预设内容"}
      >
        {label}
      </button>
      {!safe && <p className="organize-button-warn">⚠️ 链接协议不安全，点击将被阻止。请改为 http/https 或站内路径。</p>}

      {editing && (
        <div className="editor-dialog-backdrop" contentEditable={false}>
          <div className="editor-dialog" role="dialog" aria-modal="true" aria-label="编辑按钮">
            <div className="editor-dialog-title">
              <div><MousePointerClick className="h-4 w-4" />编辑按钮</div>
              <button type="button" onClick={() => setEditing(false)} aria-label="关闭"><X className="h-4 w-4" /></button>
            </div>
            <label className="editor-field">
              <span>按钮文字</span>
              <input value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} placeholder="例如：插入模板" />
            </label>
            <label className="editor-field">
              <span>动作</span>
              <select value={draftAction} onChange={(e) => setDraftAction(e.target.value as ButtonAction)}>
                <option value="open-url">打开链接</option>
                <option value="insert-blocks">插入预设内容</option>
              </select>
            </label>
            <label className="editor-field">
              <span>{draftAction === "open-url" ? "链接 URL（http/https 或站内 / 开头）" : "预设内容（TipTap 块 JSON 数组）"}</span>
              {draftAction === "open-url" ? (
                <input
                  value={draftPayload}
                  onChange={(e) => setDraftPayload(e.target.value)}
                  placeholder="https://example.com 或 /notes/xxx"
                />
              ) : (
                <textarea
                  value={draftPayload}
                  onChange={(e) => setDraftPayload(e.target.value)}
                  spellCheck={false}
                  placeholder={'[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"模板标题"}]}]'}
                />
              )}
            </label>
            <div className="editor-dialog-actions">
              <button type="button" onClick={() => setEditing(false)}>取消</button>
              <button type="button" className="primary" onClick={save}>保存</button>
            </div>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    buttonBlock: {
      insertButtonBlock: () => ReturnType;
    };
  }
}

export const ButtonBlock = Node.create({
  name: "buttonBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      label: {
        default: DEFAULT_BUTTON_ATTRS.label,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-label") || DEFAULT_BUTTON_ATTRS.label,
        renderHTML: (attrs) => ({ "data-label": String(attrs.label || DEFAULT_BUTTON_ATTRS.label) }),
      },
      action: {
        default: DEFAULT_BUTTON_ATTRS.action,
        parseHTML: (el) => normalizeButtonAction((el as HTMLElement).getAttribute("data-action")),
        renderHTML: (attrs) => ({ "data-action": normalizeButtonAction(attrs.action) }),
      },
      payload: {
        default: DEFAULT_BUTTON_ATTRS.payload,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-payload") || "",
        renderHTML: (attrs) => ({ "data-payload": String(attrs.payload || "") }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-button-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-button-block": "" })];
  },

  addCommands() {
    return {
      insertButtonBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { ...DEFAULT_BUTTON_ATTRS } }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ButtonView);
  },
});
