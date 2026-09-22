/**
 * 资料库统一输入框的分流纯函数（阶段 C）：一段输入该变成稍后读、速记还是物料。
 *
 * 分类口径（与速记 5000 字上限、物料 4 万字符上限的既定限制对齐）：
 * - 空白 → empty（调用方忽略）
 * - 整条 = 单个 URL → url（走 collectReadingItem，含抓取/去重/仅存链接降级）
 * - 多个 URL 且剥离 URL 后只剩空白 → urls（逐条 collect）
 * - 文字夹带 URL → memo-with-urls（完整文字存速记，不丢上下文；链接另行逐条 collect）
 * - 无 URL 且 ≤5000 字 → memo
 * - 无 URL 且 >5000 字 → text-material（确定性切块转 MaterialResult，走 collect 物料分支；
 *   >4 万字符由 textToMaterialResult 明确报错，不截断）
 */
import { EXPLICIT_HTTP_URL, extractAllUrls } from "@/lib/inbox/batch-import";

export const CAPTURE_MEMO_MAX_LENGTH = 5000;

export type CaptureClassification =
  | { kind: "empty" }
  | { kind: "url"; url: string }
  | { kind: "urls"; urls: string[] }
  | { kind: "memo-with-urls"; text: string; urls: string[] }
  | { kind: "memo"; text: string }
  | { kind: "text-material"; text: string };

/** 剥离全部 URL 后是否只剩空白与标点（链接列表的判定） */
function isBlankWithoutUrls(text: string): boolean {
  // 与 extractAllUrls 同一正则，把每一处 URL 出现都剥掉（重复链接也算空白）
  return text
    .replace(EXPLICIT_HTTP_URL, " ")
    .replace(/[\s\p{P}\p{S}]/gu, "") === "";
}

export function classifyCapture(raw: string): CaptureClassification {
  const text = raw.trim();
  if (!text) return { kind: "empty" };

  const urls = extractAllUrls(text);
  if (urls.length > 0) {
    if (isBlankWithoutUrls(text)) {
      return urls.length === 1 ? { kind: "url", url: urls[0] } : { kind: "urls", urls };
    }
    // 完整文字存速记，链接另存（调用方提供「另存其中链接」动作）
    return { kind: "memo-with-urls", text, urls };
  }

  if (text.length <= CAPTURE_MEMO_MAX_LENGTH) return { kind: "memo", text };
  return { kind: "text-material", text };
}
