/**
 * 白名单 HTML 消毒器（阶段 D，DOCX 路径用）。
 *
 * mammoth 的 convertToHtml 输出是生成的结构化 HTML（文本已转义），但按本任务的
 * 安全契约（任务书 §九：导入正文视为不可信内容，清洗后渲染），仍须过白名单：
 *   - 仅放行标签本身，剥掉全部属性（href/src/class/on* 一律不可能存活）；
 *   - 非白名单标签只丢标签保留内文（脚本内容降级为纯文本，不执行）；
 *   - 注释直接丢弃。
 * 放行集覆盖 mammoth 输出：p / h1–h6 / ul / ol / li / table / thead / tbody /
 * tr / th / td / strong / em / br / blockquote。
 */
const ALLOWED = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td",
  "strong", "em", "br", "blockquote",
]);

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>|<!--[\s\S]*?-->|<![^>]*>/g;

export function sanitizeDocHtml(html: string): string {
  let cellDepth = 0; // 单元格内的 <p>（mammoth 输出）解包，表格单元格直接承载文本
  return html.replace(TAG_RE, (raw, name?: string) => {
    if (!name) return ""; // 注释 / doctype / 处理指令
    const tag = name.toLowerCase();
    if (!ALLOWED.has(tag)) return ""; // 剥标签留内文（script/style 内文降级为文本）
    const closing = raw.startsWith("</");
    if (tag === "td" || tag === "th") {
      cellDepth = Math.max(0, cellDepth + (closing ? -1 : 1));
      return closing ? `</${tag}>` : `<${tag}>`;
    }
    if (tag === "p" && cellDepth > 0) return ""; // 解包单元格内段落
    return closing ? `</${tag}>` : `<${tag}>`;
  });
}
