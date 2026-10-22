/** Stored attachments may come from pasted HTML. Only these protocols may navigate/download. */
export function attachmentHref(src: unknown, base: string): string | undefined {
  if (typeof src !== "string" || !src.trim()) return undefined;
  try {
    const url = new URL(src, base);
    return ["http:", "https:", "blob:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

export function attachmentName(name: string): string {
  return name.trim() || "附件";
}

/** Fetching a blob makes cross-origin downloads explicit instead of silently ignoring a[download]. */
export async function downloadAttachment(href: string, name: string) {
  const response = await fetch(href);
  if (!response.ok) throw new Error("download failed");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url; link.download = attachmentName(name);
  document.body.appendChild(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
