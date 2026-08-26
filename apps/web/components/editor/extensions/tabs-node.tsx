"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { normalizeActiveIndex, normalizeTabTitle } from "./tabs";

function TabsView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const tabCount = node.childCount || 1;
  const activeIndex = normalizeActiveIndex(node.attrs.activeIndex, tabCount);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // 收集每个 tab 节点的标题与起止偏移（相对 tabs 节点）
  const tabs: { title: string; offset: number; size: number }[] = [];
  {
    let offset = 0;
    node.forEach((child) => {
      tabs.push({
        title: normalizeTabTitle(child.attrs.title),
        offset,
        size: child.nodeSize,
      });
      offset += child.nodeSize;
    });
  }

  const setActive = (index: number) => {
    updateAttributes({ activeIndex: index });
    // 把对应 tab 的 active 属性更新，供 CSS 隐藏非活动 tab
    syncActiveAttrs(index);
    // 注意：这里不能 editor.commands.focus()——双击标签名会弹出重命名输入框，
    // 单击触发的 focus() 会在输入框挂载后立刻把焦点抢走，导致输入框一闪而过。
  };

  // 同步每个子 tab 的 active 标记（CSS 用 data-active 控制显隐）。
  // 必须从当前文档重新读 tabs 节点：addTab 插入新 tab 后立刻调用时，
  // 组件闭包里的 node 还是旧的（没有新 tab），会把所有 tab 都标成 inactive，
  // 表现为内容区全部隐藏。
  const syncActiveAttrs = (active: number) => {
    const base = typeof getPos === "function" ? (getPos() as number) : null;
    if (base === null) return;
    const current = editor.state.doc.nodeAt(base);
    if (!current || current.type.name !== "tabs") return;
    const tr = editor.state.tr;
    let offset = 0;
    let index = 0;
    current.forEach((child) => {
      const childPos = base + 1 + offset; // tabs 节点开头 +1 进入
      tr.setNodeMarkup(childPos, undefined, {
        ...child.attrs,
        active: index === active,
      });
      offset += child.nodeSize;
      index += 1;
    });
    editor.view.dispatch(tr);
  };

  const renameTab = (index: number, title: string) => {
    const base = typeof getPos === "function" ? (getPos() as number) : null;
    if (base === null) return;
    const target = tabs[index];
    if (!target) return;
    const childPos = base + 1 + target.offset;
    const child = node.child(index);
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(childPos, undefined, { ...child.attrs, title })
    );
  };

  const addTab = () => {
    if (tabCount >= 12) return;
    const base = typeof getPos === "function" ? (getPos() as number) : null;
    if (base === null) return;
    // 插入到 tabs 节点末尾（base + node.nodeSize - 1，即闭合标签前）
    const insertPos = base + node.nodeSize - 1;
    const newIndex = tabCount;
    editor.chain()
      .focus()
      .insertContentAt(insertPos, {
        type: "tab",
        attrs: { title: `标签页 ${newIndex + 1}`, active: false },
        content: [{ type: "paragraph" }],
      })
      .run();
    setActive(newIndex);
  };

  const deleteTab = (index: number) => {
    if (tabCount <= 1) return;
    const base = typeof getPos === "function" ? (getPos() as number) : null;
    if (base === null) return;
    const target = tabs[index];
    if (!target) return;
    const from = base + 1 + target.offset;
    const to = from + target.size;
    editor.chain().focus().deleteRange({ from, to }).run();
    setActive(Math.max(0, index - 1));
  };

  return (
    <NodeViewWrapper className="organize-tabs" data-tabs="" as="div">
      <div className="organize-tabs-bar" contentEditable={false}>
        {tabs.map((tab, index) => (
          <div key={index} className={index === activeIndex ? "organize-tabs-title is-active" : "organize-tabs-title"}>
            {editingIndex === index ? (
              <input
                autoFocus
                defaultValue={tab.title}
                onBlur={(e) => { renameTab(index, e.target.value); setEditingIndex(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { renameTab(index, (e.target as HTMLInputElement).value); setEditingIndex(null); }
                  if (e.key === "Escape") setEditingIndex(null);
                }}
              />
            ) : (
              <button
                type="button"
                title={index === activeIndex ? "双击重命名" : "切换到此标签页"}
                onClick={() => setActive(index)}
                onDoubleClick={() => setEditingIndex(index)}
              >
                {tab.title}
              </button>
            )}
            {tabCount > 1 && (
              <button
                type="button"
                className="organize-tabs-close"
                title="删除此标签页"
                aria-label="删除此标签页"
                onClick={() => deleteTab(index)}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        {tabCount < 12 && (
          <button type="button" className="organize-tabs-add" title="新增标签页" onClick={addTab}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <NodeViewContent className="organize-tabs-content" as="div" />
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tabs: {
      insertTabs: () => ReturnType;
    };
  }
}

export const Tab = Node.create({
  name: "tab",
  group: "block",
  content: "block+",
  isolating: true,

  addAttributes() {
    return {
      title: {
        default: "无标题",
        parseHTML: (el) => normalizeTabTitle((el as HTMLElement).getAttribute("data-title")),
        renderHTML: (attrs) => ({ "data-title": normalizeTabTitle(attrs.title) }),
      },
      active: {
        default: false,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-active") === "true",
        renderHTML: (attrs) => ({ "data-active": attrs.active ? "true" : "false" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-tab]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-tab": "" }), 0];
  },
});

export const Tabs = Node.create({
  name: "tabs",
  group: "block",
  content: "tab+",
  defining: true,

  addAttributes() {
    return {
      activeIndex: {
        default: 0,
        parseHTML: (el) => Number((el as HTMLElement).getAttribute("data-active-index") || 0),
        renderHTML: (attrs) => ({ "data-active-index": String(attrs.activeIndex ?? 0) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-tabs]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-tabs": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TabsView);
  },

  addCommands() {
    return {
      insertTabs:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { activeIndex: 0 },
            content: [
              { type: "tab", attrs: { title: "标签页 1", active: true }, content: [{ type: "paragraph" }] },
              { type: "tab", attrs: { title: "标签页 2", active: false }, content: [{ type: "paragraph" }] },
            ],
          }),
    };
  },
});

export default Tabs;
