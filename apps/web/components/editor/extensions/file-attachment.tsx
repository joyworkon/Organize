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
} from "lucide-react";

function formatFileSize(size: unknown): string {
  const bytes = typeof size === "number" ? size : Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function iconForMime(mime: string) {
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime === "application/pdf" || mime.startsWith("text/")) return FileText;
  if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar")) {
    return FileArchive;
  }
  return File;
}

function openFile(src: string) {
  window.open(src, "_blank", "noopener,noreferrer");
}

function FileAttachmentView({ node }: NodeViewProps) {
  const src = node.attrs.src as string;
  const name = (node.attrs.name as string) || "附件";
  const mime = (node.attrs.mime as string) || "";
  const size = formatFileSize(node.attrs.size);

  if (mime.startsWith("video/")) {
    return (
      <NodeViewWrapper className="file-attachment" data-mime={mime}>
        <video className="file-attachment-media" src={src} controls preload="metadata" />
      </NodeViewWrapper>
    );
  }
  if (mime.startsWith("audio/")) {
    return (
      <NodeViewWrapper className="file-attachment" data-mime={mime}>
        <div className="file-attachment-audio">
          <span className="file-attachment-name" title={name}>{name}</span>
          <audio className="file-attachment-media" src={src} controls preload="metadata" />
        </div>
      </NodeViewWrapper>
    );
  }

  const Icon = iconForMime(mime);
  return (
    <NodeViewWrapper className="file-attachment" data-mime={mime}>
      <button
        type="button"
        className="file-attachment-card"
        contentEditable={false}
        title={`${name}（点击打开）`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openFile(src);
        }}
      >
        <Icon className="file-attachment-icon" aria-hidden="true" />
        <span className="file-attachment-name">{name}</span>
        {size && <span className="file-attachment-size">{size}</span>}
      </button>
    </NodeViewWrapper>
  );
}

/**
 * 附件块：从外部拖入 / 粘贴 / 菜单上传的非图片文件。
 * 视频、音频内联播放，其余类型渲染为可点击打开的文件卡片。
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
