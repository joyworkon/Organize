"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ChevronRight, FileText } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { getNoteAncestors, type NoteTreeItem } from "@/lib/notes/tree";

/**
 * 路径栏（Breadcrumb）块：显示当前页的父级路径面包屑。
 *
 * 数据来源：编辑器 storage（由 TipTapEditor 通过 noteTree prop 注入到
 * editor.storage.breadcrumb.noteTree），避免新增 API 往返。
 * 不在块内做网络请求——父级链在编辑器外已经算好。
 */
function BreadcrumbView({ editor }: NodeViewProps) {
  const storage = (editor.storage as { breadcrumb?: BreadcrumbStorage }).breadcrumb;
  const noteId = storage?.noteId || "";

  const path = useMemo(() => {
    const noteTree = storage?.noteTree || [];
    if (!noteId || noteTree.length === 0) return [] as NoteTreeItem[];
    const ancestors = getNoteAncestors(noteTree, noteId);
    const current = noteTree.find((n) => n.id === noteId);
    // 当前页用占位（无 parent_note_id 的就只有自身）
    const currentEntry: NoteTreeItem = current || {
      id: noteId,
      title: storage?.noteTitle || "当前页",
      icon: "📄",
      parent_note_id: null,
    };
    return [...ancestors, currentEntry];
  }, [noteId, storage]);

  return (
    <NodeViewWrapper
      className="organize-breadcrumb"
      data-breadcrumb=""
      contentEditable={false}
      as="div"
    >
      <Link href="/notes" className="organize-breadcrumb-root" aria-label="笔记主页">
        <FileText className="h-3.5 w-3.5" />
        <span>笔记</span>
      </Link>
      {path.length === 0 ? (
        <span className="organize-breadcrumb-empty">当前页位于顶层</span>
      ) : (
        path.map((note, index) => (
          <span key={note.id} className="organize-breadcrumb-crumb">
            <ChevronRight className="h-3 w-3 shrink-0 organize-breadcrumb-sep" />
            {index === path.length - 1 ? (
              <span className="organize-breadcrumb-current" title={note.title || "无标题笔记"}>
                <span>{note.icon || "📄"}</span>
                {note.title || "无标题笔记"}
              </span>
            ) : (
              <Link
                href={`/notes/${note.id}`}
                className="organize-breadcrumb-link"
                title={note.title || "无标题笔记"}
              >
                <span>{note.icon || "📄"}</span>
                {note.title || "无标题笔记"}
              </Link>
            )}
          </span>
        ))
      )}
    </NodeViewWrapper>
  );
}

interface BreadcrumbStorage {
  noteId: string;
  noteTitle: string;
  noteTree: NoteTreeItem[];
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    breadcrumb: {
      insertBreadcrumb: () => ReturnType;
    };
  }
}

export const Breadcrumb = Node.create<{
  addStorage: () => BreadcrumbStorage;
}>({
  name: "breadcrumb",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addStorage() {
    return { noteId: "", noteTitle: "", noteTree: [] };
  },

  parseHTML() {
    return [{ tag: "div[data-breadcrumb]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-breadcrumb": "" })];
  },

  addCommands() {
    return {
      insertBreadcrumb:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(BreadcrumbView);
  },
});
