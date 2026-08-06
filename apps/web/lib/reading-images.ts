const IMAGE_TAG_PATTERN = /<img\b[^>]*>/gi;

/**
 * 兼容修复入库于图片策略升级前的正文。
 * 已存 HTML 在抓取时经过 sanitize-html，因此这里仅补齐浏览器加载属性。
 */
export function prepareReadingContent(html: string): string {
  if (!html) return "";

  return html.replace(IMAGE_TAG_PATTERN, (tag) => {
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
