import { sanitizeContent } from "@/lib/sanitize/sanitize-html";

const IMAGE_TAG_PATTERN = /<img\b[^>]*>/gi;

/**
 * 渲染前准备稍后读正文：先清洗，再补齐浏览器加载属性。
 *
 * 清洗不能只依赖入库时那一次：reading_items 的插入策略只要求
 * `user_id = auth.uid()`，备份恢复、登录用户直插都能写入未经清洗的 HTML，
 * 而协作者经 064 可以读到被授权的条目——不在这里清洗就是一个存储型 XSS 入口。
 * 复用 sanitizeContent（与抓取入库、公开分享页同一份白名单）；
 * sanitize-html 不依赖 Node 内建模块，可随客户端包下发。
 */
export function prepareReadingContent(html: string): string {
  if (!html) return "";

  const sanitized = sanitizeContent(html);
  if (!sanitized) return "";

  return sanitized.replace(IMAGE_TAG_PATTERN, (tag) => {
    let updated = forceAttribute(tag, "referrerpolicy", "no-referrer");
    updated = addAttributeIfMissing(updated, "decoding", "async");
    return addAttributeIfMissing(updated, "loading", "lazy");
  });
}

function forceAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(
    `\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`,
    "i"
  );
  return tag
    .replace(pattern, "")
    .replace(/^<img\b/i, `<img ${name}="${value}"`);
}

function addAttributeIfMissing(
  tag: string,
  name: string,
  value: string
): string {
  const pattern = new RegExp(`\\s${name}(?:\\s*=|\\s|>)`, "i");
  return pattern.test(tag)
    ? tag
    : tag.replace(/^<img\b/i, `<img ${name}="${value}"`);
}
