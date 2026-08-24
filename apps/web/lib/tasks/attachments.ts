export type AttachmentPreviewKind =
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "text"
  | "other";

export const MAX_TASK_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const EXTENSION_KIND: Record<string, AttachmentPreviewKind> = {
  gif: "image",
  jpeg: "image",
  jpg: "image",
  png: "image",
  svg: "image",
  webp: "image",
  mp3: "audio",
  m4a: "audio",
  oga: "audio",
  ogg: "audio",
  wav: "audio",
  mp4: "video",
  mov: "video",
  m4v: "video",
  webm: "video",
  pdf: "pdf",
  csv: "text",
  json: "text",
  md: "text",
  txt: "text",
  xml: "text",
};

export function getAttachmentPreviewKind(
  mimeType: string | null | undefined,
  name: string
): AttachmentPreviewKind {
  const mime = mimeType?.toLowerCase() || "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  if (
    mime.startsWith("text/")
    || mime === "application/json"
    || mime === "application/xml"
  ) {
    return "text";
  }
  const extension = name.split(".").pop()?.toLowerCase();
  return extension ? EXTENSION_KIND[extension] || "other" : "other";
}

export function formatAttachmentSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function validateTaskAttachment(file: Pick<File, "name" | "size">): string | null {
  if (!file.name.trim()) return "文件名不能为空";
  if (file.size <= 0) return "不能上传空文件";
  if (file.size > MAX_TASK_ATTACHMENT_BYTES) return "附件不能超过 50 MB";
  return null;
}

export function buildTaskAttachmentPath(
  userId: string,
  taskId: string,
  fileName: string,
  timestamp = Date.now()
): string {
  const safeName = fileName
    .replace(/[\/\\\u0000-\u001f\u007f]/g, "_")
    .trim()
    .slice(0, 180) || "attachment";
  return `${userId}/tasks/${taskId}/${timestamp}-${safeName}`;
}
