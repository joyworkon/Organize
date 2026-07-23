"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { GripVertical, MessageSquare, MoreHorizontal } from "lucide-react";

interface BlockSidePanelProps {
  editor: Editor | null;
  /** 点击评论按钮的回调（由父组件接评论功能） */
  onComment?: (blockId: string) => void;
  /** 点击更多按钮的回调（默认聚焦块手柄的菜单） */
  onMore?: (blockId: string) => void;
}

interface PanelState {
  top: number;
  blockId: string;
}

/**
 * Notion 风格的右侧浮层面板。
 *
 * 触发条件：编辑器选区是 NodeSelection（整块被选中）时显示。
 * 位置：贴在选中块的右侧顶部。
 * 内容：拖拽手柄 / 评论 / 更多（⋯）三个按钮。
 *
 * 取消选中（点别处 / 按 Esc）时自动隐藏。
 */
export function BlockSidePanel({ editor, onComment, onMore }: BlockSidePanelProps) {
  const [panel, setPanel] = useState<PanelState | null>(null);

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      const { state, view } = editor;
      // 只在 NodeSelection（整块选中）时显示
      if (!(state.selection instanceof NodeSelection)) {
        setPanel(null);
        return;
      }
      const pos = state.selection.from;
      // 拿到这个块的 DOM 节点位置
      try {
        const dom = view.nodeDOM(pos);
        if (dom instanceof HTMLElement) {
          const editorRect = view.dom.getBoundingClientRect();
          const nodeRect = dom.getBoundingClientRect();
          const blockId = String(
            (state.doc.nodeAt(pos)?.attrs as { id?: string } | null)?.id || ""
          );
          // top 是相对编辑器容器的偏移（面板用 absolute 定位在编辑器内）
          setPanel({
            top: nodeRect.top - editorRect.top + view.dom.scrollTop,
            blockId,
          });
          return;
        }
      } catch {
        // 忽略
      }
      setPanel(null);
    };

    // 选区变化时更新
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    // 滚动时位置会变，也刷新
    editor.view.dom.addEventListener("scroll", update);
    // 初始检查一次
    update();

    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      editor.view.dom.removeEventListener("scroll", update);
    };
  }, [editor]);

  if (!panel) return null;

  return (
    <div
      className="organize-block-side-panel"
      style={{ top: panel.top }}
      aria-hidden="false"
      // 阻止点击面板时编辑器失焦（失焦会导致选区状态丢失）
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        title="拖动以移动（按住拖拽）"
        aria-label="拖动区块"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="添加评论"
        aria-label="为该区块添加评论"
        onClick={() => onComment?.(panel.blockId)}
      >
        <MessageSquare className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="更多操作"
        aria-label="更多操作"
        onClick={() => onMore?.(panel.blockId)}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
