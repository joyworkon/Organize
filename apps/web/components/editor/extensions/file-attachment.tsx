import { useEffect, useRef, useState } from "react";
import { closeHistory } from "@tiptap/pm/history";
import { FileAttachmentToolbar } from "../file-attachment-toolbar";
import { useEditorUpload } from "../use-editor-upload";
import { attachmentHref } from "@/lib/editor/file-attachment";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import {
  File,
  FileArchive,
  FileAudio,
  FileText,
  FileVideo,
} from "@/components/icons";

/** 面向附件面板等处复用：字节大小格式化 */
export function formatFileSize(size: unknown): string {
  const bytes = typeof size === "number" ? size : Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 面向附件面板等处复用：按 mime 取文件类型图标 */
export function iconForMime(mime: string) {
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime === "application/pdf" || mime.startsWith("text/")) return FileText;
  if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar")) {
    return FileArchive;
  }
  return File;
}

export function FileAttachmentView({ node, editor, getPos, selected }: NodeViewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [editable, setEditable] = useState(editor.isEditable);
  const [active, setActive] = useState(true);
  const [interacting, setInteracting] = useState(false);
  const { uploadAttachment } = useEditorUpload(editor);
  const src = (node.attrs.src as string) || "";
  const name = (node.attrs.name as string) || "附件";
  const mime = (node.attrs.mime as string) || "";
  const size = formatFileSize(node.attrs.size);
  const href = attachmentHref(src, document.baseURI);

  useEffect(() => { if (selected) setActive(true); }, [selected]);
  useEffect(() => {
    const sync = () => setEditable(editor.isEditable);
    const blur = ({ event }: { event: FocusEvent }) => {
      if (!frameRef.current?.contains(event.relatedTarget as globalThis.Node)) setActive(false);
    };
    const outside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || frameRef.current?.contains(target) || target.closest('[aria-label="附件工具栏"], [data-radix-popper-content-wrapper]')) return;
      setActive(false);
    };
    const windowBlur = () => setActive(false);
    editor.on("transaction", sync); editor.on("update", sync); editor.on("blur", blur);
    document.addEventListener("pointerdown", outside); document.addEventListener("focusin", outside);
    window.addEventListener("blur", windowBlur);
    return () => {
      editor.off("transaction", sync); editor.off("update", sync); editor.off("blur", blur);
      document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside);
      window.removeEventListener("blur", windowBlur);
    };
  }, [editor]);
  const target = () => {
    if (editor.isDestroyed || !editor.isEditable) return null;
    const pos = getPos();
    if (typeof pos !== "number") return null;
    const current = editor.state.doc.nodeAt(pos);
    return current?.type.name === "fileAttachment" ? { pos, current } : null;
  };
  const commit = (attrs?: Record<string, unknown>, replacementType?: string, expectedSrc?: string) => {
    const found = target();
    if (!found || (expectedSrc !== undefined && found.current.attrs.src !== expectedSrc)) return;
    const tr = closeHistory(editor.state.tr);
    if (!attrs) tr.delete(found.pos, found.pos + found.current.nodeSize);
    else tr.setNodeMarkup(found.pos, replacementType ? editor.schema.nodes[replacementType] : undefined, { ...found.current.attrs, ...attrs });
    editor.view.dispatch(tr); editor.view.dispatch(closeHistory(editor.state.tr));
  };
  const select = () => {
    if (editor.isDestroyed) return;
    const pos = getPos();
    if (typeof pos === "number") { editor.commands.setNodeSelection(pos); setActive(true); }
  };
  const editorKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).closest("input, textarea, select") || !editor.isEditable || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (editor.view.someProp("handleKeyDown", (handler) => handler(editor.view, event.nativeEvent))) { event.preventDefault(); event.stopPropagation(); }
  };
  const Icon = iconForMime(mime);
  return <NodeViewWrapper className="file-attachment" data-file-attachment="" data-mime={mime}>
    <div ref={frameRef} contentEditable={false} tabIndex={0} role="group" aria-label="附件块"
      onFocus={select} onClick={select} onKeyDown={editorKeyDown}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node)) setActive(false); }}>
      {mime.startsWith("video/") ? <>
        <span className="file-attachment-name" title={name}>{name}</span>
        <video className="file-attachment-media" src={href} controls preload="metadata" />
      </> : mime.startsWith("audio/") ? <div className="file-attachment-audio">
        <span className="file-attachment-name" title={name}>{name}</span>
        <audio className="file-attachment-media" src={href} controls preload="metadata" />
      </div> : <button type="button" className="file-attachment-card" title={`${name}（双击打开）`}
        onDoubleClick={() => { if (href) window.open(href, "_blank", "noopener,noreferrer"); }}>
        <Icon className="file-attachment-icon" aria-hidden="true" />
        <span className="file-attachment-name">{name}</span>
        {size && <span className="file-attachment-size">{size}</span>}
      </button>}
    </div>
    {selected && (active || interacting) && <FileAttachmentToolbar anchor={frameRef} editable={editable} name={name} src={src}
      onRename={(next) => commit({ name: next })}
      onReplace={() => uploadAttachment(undefined, undefined, undefined, (next) => commit(next.attrs, next.type, src))}
      onDelete={() => { commit(); if (!editor.isDestroyed) editor.view.focus(); }}
      onInteractionChange={(value, restore) => {
        setInteracting(value);
        if (restore && !editor.isDestroyed) { frameRef.current?.focus({ preventScroll: true }); setActive(true); }
      }} onEditorKeyDown={editorKeyDown} />}
  </NodeViewWrapper>;
}

/**
 * 附件块：从外部拖入 / 粘贴 / 菜单上传的非图片文件。
 * 视频、音频内联播放，其余类型渲染为可选中并打开的文件卡片。
 */
export const FileAttachment = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      name: { default: null },
      size: { default: null },
      mime: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-file-attachment]",
        getAttrs: (element) => ({
          src: element.getAttribute("data-src"),
          name: element.getAttribute("data-name"),
          size: Number(element.getAttribute("data-size")) || null,
          mime: element.getAttribute("data-mime"),
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const name = (node.attrs.name as string) || "附件";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-file-attachment": "",
        "data-src": node.attrs.src,
        "data-name": node.attrs.name,
        "data-size": node.attrs.size,
        "data-mime": node.attrs.mime,
      }),
      ["a", { href: node.attrs.src, target: "_blank", rel: "noopener noreferrer" }, name],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentView);
  },
});

export default FileAttachment;
