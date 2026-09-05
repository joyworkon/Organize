"use client";

/**
 * 笔记附件管理面板（E8）：集中列出当前笔记全部附件块（fileAttachment），
 * 支持跳转定位（复用页内搜索的 organize-search-hit 高亮）与单删。
 *
 * - 删除走编辑器命令（deleteRange），⌘Z 可撤销；不直接操作 storage bucket。
 * - 列表随编辑器 transaction 实时刷新（增删附件块后立即同步）。
 */

import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Paperclip, Trash2, X } from "lucide-react";
import { formatFileSize, iconForMime } from "./extensions/file-attachment";
import { Button } from "@/components/ui/button";

export interface AttachmentItem {
  /** 附件块在文档中的位置 */
  pos: number;
  src: string | null;
  name: string;
  size: number | null;
  mime: string;
}

/** 扫描文档收集全部附件块（含嵌套在 callout / 列布局内的） */
export function collectAttachments(doc: ProseMirrorNode): AttachmentItem[] {
  const items: AttachmentItem[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "fileAttachment") return true;
    items.push({
      pos,
      src: typeof node.attrs.src === "string" ? node.attrs.src : null,
      name: typeof node.attrs.name === "string" && node.attrs.name ? node.attrs.name : "附件",
      size: typeof node.attrs.size === "number" ? node.attrs.size : null,
      mime: typeof node.attrs.mime === "string" ? node.attrs.mime : "",
    });
    return true;
  });
  return items;
}

/** 顶栏入口按钮 + 面板。编辑器就绪前不渲染。 */
export function NoteAttachmentsButton({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const update = () => setCount(collectAttachments(editor.state.doc).length);
    update();
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  if (!editor) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((prev) => !prev)}
        title="附件"
        aria-label={`附件（${count} 个）`}
        aria-expanded={open}
      >
        <Paperclip className="h-4 w-4" />
        {count > 0 && <span className="note-attachment-badge">{count}</span>}
      </Button>
      {open && <AttachmentsPanel editor={editor} onClose={() => setOpen(false)} />}
    </>
  );
}

export function AttachmentsPanel({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [items, setItems] = useState<AttachmentItem[]>(() =>
    collectAttachments(editor.state.doc)
  );
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const update = () => setItems(collectAttachments(editor.state.doc));
    update();
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  // Esc 关闭；卸载时清理高亮定时器与残留样式
  useEffect(() => {
    const handler = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      document
        .querySelectorAll(".organize-search-hit")
        .forEach((el) => el.classList.remove("organize-search-hit"));
    };
  }, [onClose]);

  // 跳转定位：滚动到块并短暂高亮（与页内搜索一致的表现）
  const jumpTo = useCallback(
    (item: AttachmentItem) => {
      const element = editor.view.nodeDOM(item.pos);
      if (!(element instanceof HTMLElement)) return;
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      document
        .querySelectorAll(".organize-search-hit")
        .forEach((el) => el.classList.remove("organize-search-hit"));
      element.classList.add("organize-search-hit");
      highlightTimer.current = setTimeout(() => {
        element.classList.remove("organize-search-hit");
      }, 2400);
    },
    [editor]
  );

  // 单删附件块：走编辑器事务，历史栈可撤销（⌘Z 恢复）
  const remove = useCallback(
    (item: AttachmentItem) => {
      const node = editor.state.doc.nodeAt(item.pos);
      if (!node || node.type.name !== "fileAttachment") return;
      editor
        .chain()
        .focus()
        .deleteRange({ from: item.pos, to: item.pos + node.nodeSize })
        .run();
    },
    [editor]
  );

  const openFile = useCallback((src: string | null) => {
    if (src) window.open(src, "_blank", "noopener,noreferrer");
  }, []);

  return (
    <div
      className="editor-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="附件管理"
      >
        <div className="editor-dialog-title">
          <div>
            <Paperclip className="h-4 w-4" />
            附件（{items.length}）
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="note-attachment-list">
          {items.length === 0 ? (
            <p className="note-search-empty">
              本笔记没有附件。将文件拖入 / 粘贴到编辑器，或用插入菜单「上传附件」。
            </p>
          ) : (
            <ul>
              {items.map((item) => {
                const Icon = iconForMime(item.mime);
                const size = formatFileSize(item.size);
                const kind =
                  item.mime.startsWith("video/") ? "视频"
                  : item.mime.startsWith("audio/") ? "音频"
                  : item.mime.startsWith("image/") ? "图片"
                  : "文件";
                return (
                  <li key={item.pos}>
                    <div className="note-attachment-row">
                      <button
                        type="button"
                        className="note-attachment-main"
                        onClick={() => jumpTo(item)}
                        title="定位到附件块"
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="note-attachment-name" title={item.name}>
                          {item.name}
                        </span>
                        <span className="note-attachment-kind">{kind}</span>
                        {size && <span className="note-attachment-size">{size}</span>}
                      </button>
                      <button
                        type="button"
                        className="note-attachment-icon-btn"
                        onClick={() => openFile(item.src)}
                        title="打开文件"
                        aria-label={`打开 ${item.name}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="note-attachment-icon-btn note-attachment-remove"
                        onClick={() => remove(item)}
                        title="删除附件块（⌘Z 可撤销）"
                        aria-label={`删除 ${item.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
