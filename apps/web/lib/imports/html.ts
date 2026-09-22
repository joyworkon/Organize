/**
 * 导入正文的 HTML 构建器（阶段 D）。
 *
 * 导入正文与 AI 输出都视为不可信内容（任务书 §九）：全部文本经 escape 后渲染，
 * 不接受任何来源 HTML。结构与 lib/materials/article.ts 同一安全模型。
 */
import { IMPORT_MAX_OUTPUT_CHARS } from "./budgets";
import { ImportError } from "./errors";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const inline = (text: string) => escapeHtml(text).replace(/\n/g, "<br>");

export const h = {
  paragraph: (text: string) => `<p>${inline(text)}</p>`,
  heading: (level: 2 | 3, text: string) => `<h${level}>${inline(text)}</h${level}>`,
  list: (tag: "ul" | "ol", items: string[]) =>
    `<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`,
  table: (rows: string[][]) => {
    if (!rows.length) return "";
    const cols = rows[0].length;
    const body = rows.map((row, i) => {
      const cells = Array.from({ length: cols }, (_, c) => row[c] ?? "");
      return `<tr>${cells.map((cell) => `<${i ? "td" : "th"}>${inline(cell)}</${i ? "td" : "th"}>`).join("")}</tr>`;
    });
    return `<table>${body.join("")}</table>`;
  },
};

/** 汇总 HTML 文本长度并执行输出预算（超限明确失败，不静默截断）。 */
export function enforceOutputBudget(parts: string[]): string {
  const html = parts.join("");
  const textLength = html.replace(/<[^>]+>/g, "").length;
  if (textLength > IMPORT_MAX_OUTPUT_CHARS) {
    throw new ImportError(
      "too-large",
      `提取正文超过 ${Math.round(IMPORT_MAX_OUTPUT_CHARS / 1000)} 万字符上限（约 ${Math.round(textLength / 1000)} 万），请拆分文件后导入`,
    );
  }
  return html;
}

/** 纯文本摘要（阅读条目 excerpt 列）。 */
export function makeExcerpt(text: string, title: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return (cleaned.slice(0, 240) || title).trim();
}

/** 从文件名取标题（去扩展名，限长）。 */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return (base || fileName).slice(0, 120);
}
