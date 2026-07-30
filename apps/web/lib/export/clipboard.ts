/**
 * 剪贴板写入工具：同时写入 text/html 与 text/plain。
 *
 * 设计要点：
 * - 优先使用 navigator.clipboard.write + ClipboardItem 写入双 MIME（富文本粘贴场景）；
 * - ClipboardItem 不可用（非安全上下文 / 旧浏览器）或权限被拒绝时，降级为 writeText 纯文本；
 * - 所有异常都被捕获并转化为明确的结果对象，调用方据此决定 toast 文案。
 */

import {
  tiptapJsonToHtml,
  tiptapJsonToPlainText,
  wrapClipboardHtml,
  type PMNode,
} from "./tiptap-to-html";

export type CopyResult =
  | { success: true; mode: "rich" | "plain"; usedFallback: boolean }
  | { success: false; mode: "none"; error: "clipboard_unavailable" | "write_failed" };

/**
 * 判断当前环境是否支持 ClipboardItem（用于富文本双格式写入）。
 * 非 HTTPS 页面 / 部分浏览器可能不存在此构造函数。
 */
export function supportsClipboardItem(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as any).ClipboardItem !== "undefined"
    && typeof navigator !== "undefined"
    && typeof navigator.clipboard !== "undefined"
    && typeof navigator.clipboard.write === "function";
}

/**
 * 判断是否支持 writeText 纯文本写入。
 */
export function supportsWriteText(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.clipboard !== "undefined"
    && typeof navigator.clipboard.writeText === "function";
}

/**
 * 将笔记内容（标题 + TipTap JSON）复制到剪贴板。
 *
 * @param title    笔记标题（会作为 <h1> 写入 HTML，纯文本中作为第一段）
 * @param content  TipTap/ProseMirror JSON（doc 节点）
 * @returns        CopyResult 描述最终写入状态
 */
export async function copyNoteContent(
  title: string,
  content: PMNode | Record<string, unknown> | null | undefined
): Promise<CopyResult> {
  // 1. 构造双格式内容
  const bodyHtml = tiptapJsonToHtml(content as any);
  const bodyPlain = tiptapJsonToPlainText(content as any);

  const trimmedTitle = (title || "").trim();
  const plainText = [trimmedTitle, bodyPlain.trim()].filter(Boolean).join("\n\n");
  const htmlText = wrapClipboardHtml(bodyHtml, trimmedTitle);

  // 空内容（无标题无正文）视为一次合法但无内容的操作——不报错，返回成功
  if (!plainText) {
    return { success: true, mode: "plain", usedFallback: false };
  }

  // 2. 优先尝试 ClipboardItem 双格式写入
  if (supportsClipboardItem()) {
    try {
      const ClipboardItemCtor = (window as any).ClipboardItem as new (
        data: Record<string, Blob>
      ) => ClipboardItem;
      const item = new ClipboardItemCtor({
        "text/html": new Blob([htmlText], { type: "text/html" }),
        "text/plain": new Blob([plainText], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return { success: true, mode: "rich", usedFallback: false };
    } catch {
      // 权限拒绝 / 非用户手势 / 浏览器限制：降级到纯文本
    }
  }

  // 3. 降级：writeText 纯文本
  if (supportsWriteText()) {
    try {
      await navigator.clipboard.writeText(plainText);
      return { success: true, mode: "plain", usedFallback: true };
    } catch {
      return { success: false, mode: "none", error: "write_failed" };
    }
  }

  return { success: false, mode: "none", error: "clipboard_unavailable" };
}
