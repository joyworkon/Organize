import sanitizeHtml from "sanitize-html";

/**
 * 清洗 HTML 内容，移除脚本/事件处理器/恶意标签，保留排版和图片。
 *
 * 用途：
 * 1. 抓取入库时清洗 reading_items.content（防止存储型 XSS）
 * 2. 公开分享页渲染前再清洗一道（双保险）
 */
export function sanitizeContent(html: string): string {
  if (!html) return "";
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
      "strong", "em", "b", "i", "u", "s", "del", "ins", "sub", "sup", "small", "mark",
      "blockquote", "q", "cite", "pre", "code",
      "ul", "ol", "li", "dl", "dt", "dd",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td",
      "img", "figure", "figcaption", "picture", "source",
      "a", "span", "div", "section", "article",
      "details", "summary",
    ],
    allowedAttributes: {
      a: ["href", "name", "target", "rel", "title"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      source: ["src", "srcset", "type", "media"],
      "*": ["class", "style", "id", "data-language", "colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    // 允许 data: 图片（部分老文章用 base64 内联图）
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
    },
    // 禁止所有 on* 事件属性（已在默认行为里，这里显式声明）
    transformTags: {
      // 给所有 a 标签强制加安全属性
      a: (_tag, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" },
      }),
    },
    // 不解析相对 URL（避免开放重定向）
    parser: {
      lowerCaseTags: true,
    },
  });
}
