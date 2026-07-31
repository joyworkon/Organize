/**
 * TipTap / ProseMirror JSON → HTML 的极简渲染器。
 * 只覆盖公开分享页和剪贴板导出所需的常见节点，不做完整 ProseMirror schema 还原。
 * 不引入 @tiptap 依赖（这是给公开页/导出/剪贴板用的独立工具）。
 *
 * 安全保证：所有文本内容通过 escapeHtml 转义；htmlEmbed 节点直接跳过（禁止脚本/iframe）；
 * a 标签的 href 经过转义。绝不写入 on* 事件属性或 <script> 标签。
 */

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarks(inner: string, marks?: PMNode["marks"]): string {
  if (!marks) return inner;
  let out = inner;
  for (const m of marks) {
    switch (m.type) {
      case "bold":
        out = `<strong>${out}</strong>`;
        break;
      case "italic":
        out = `<em>${out}</em>`;
        break;
      case "code":
        out = `<code>${out}</code>`;
        break;
      case "strike":
        out = `<s>${out}</s>`;
        break;
      case "underline":
        out = `<u>${out}</u>`;
        break;
      case "highlight": {
        const color = m.attrs?.color ? String(m.attrs.color) : null;
        out = color
          ? `<mark style="background-color:${escapeHtml(color)}">${out}</mark>`
          : `<mark>${out}</mark>`;
        break;
      }
      case "textStyle": {
        const color = m.attrs?.color ? String(m.attrs.color) : null;
        if (color) {
          out = `<span style="color:${escapeHtml(color)}">${out}</span>`;
        }
        break;
      }
      case "link": {
        const href = String(m.attrs?.href || "#");
        out = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${out}</a>`;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function renderChildren(node: PMNode): string {
  return (node.content || []).map(renderNode).join("");
}

function renderNode(node: PMNode): string {
  switch (node.type) {
    case "doc":
      return renderChildren(node);
    case "paragraph":
      return `<p>${renderChildren(node)}</p>`;
    case "heading": {
      const level = Number(node.attrs?.level) || 2;
      const lv = Math.min(Math.max(level, 1), 6);
      return `<h${lv}>${renderChildren(node)}</h${lv}>`;
    }
    case "bulletList":
      return `<ul>${renderChildren(node)}</ul>`;
    case "orderedList": {
      const start = node.attrs?.start ? ` start="${Number(node.attrs.start)}"` : "";
      return `<ol${start}>${renderChildren(node)}</ol>`;
    }
    case "listItem":
      return `<li>${renderChildren(node)}</li>`;
    case "taskList":
      return `<ul class="task-list">${renderChildren(node)}</ul>`;
    case "taskItem": {
      const checked = node.attrs?.checked ? " checked" : "";
      const box = node.attrs?.checked ? "\u2611" : "\u2610";
      // 第一个子块（通常是 paragraph）作为条目文本；其余子块作为嵌套内容
      const firstChild = (node.content || [])[0];
      const restChildren = (node.content || []).slice(1);
      const labelContent = firstChild
        ? firstChild.type === "paragraph"
          ? renderChildren(firstChild)
          : renderNode(firstChild)
        : "";
      const restHtml = restChildren.map(renderNode).join("");
      return `<li class="task-item"${checked} data-checked="${node.attrs?.checked ? "true" : "false"}">${box} ${labelContent}${restHtml}</li>`;
    }
    case "blockquote":
      return `<blockquote>${renderChildren(node)}</blockquote>`;
    case "callout": {
      const emoji = String(node.attrs?.emoji || "\uD83D\uDCA1");
      return `<blockquote class="callout" data-emoji="${escapeHtml(emoji)}"><p>${emoji}</p>${renderChildren(node)}</blockquote>`;
    }
    case "codeBlock": {
      const lang = node.attrs?.language ? ` data-language="${escapeHtml(String(node.attrs.language))}"` : "";
      const code = escapeHtml((node.content || []).map((c) => c.text || "").join(""));
      return `<pre${lang}><code>${code}</code></pre>`;
    }
    case "horizontalRule":
      return "<hr />";
    case "hardBreak":
      return "<br />";
    case "image": {
      const src = String(node.attrs?.src || "");
      const alt = String(node.attrs?.alt || "");
      const title = node.attrs?.title ? ` title="${escapeHtml(String(node.attrs.title))}"` : "";
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${title} />`;
    }
    case "table":
      return `<table>${renderChildren(node)}</table>`;
    case "tableRow":
      return `<tr>${renderChildren(node)}</tr>`;
    case "tableHeader": {
      const colspan = node.attrs?.colspan && Number(node.attrs.colspan) > 1
        ? ` colspan="${Number(node.attrs.colspan)}"`
        : "";
      const rowspan = node.attrs?.rowspan && Number(node.attrs.rowspan) > 1
        ? ` rowspan="${Number(node.attrs.rowspan)}"`
        : "";
      return `<th${colspan}${rowspan}>${renderChildren(node)}</th>`;
    }
    case "tableCell": {
      const colspan = node.attrs?.colspan && Number(node.attrs.colspan) > 1
        ? ` colspan="${Number(node.attrs.colspan)}"`
        : "";
      const rowspan = node.attrs?.rowspan && Number(node.attrs.rowspan) > 1
        ? ` rowspan="${Number(node.attrs.rowspan)}"`
        : "";
      return `<td${colspan}${rowspan}>${renderChildren(node)}</td>`;
    }
    case "details":
      return `<details>${renderChildren(node)}</details>`;
    case "detailsSummary":
      return `<summary>${renderChildren(node)}</summary>`;
    case "detailsContent":
      return renderChildren(node);
    case "columns":
      return `<div class="columns" style="display:flex;gap:1em">${renderChildren(node)}</div>`;
    case "column":
      return `<div class="column" style="flex:1">${renderChildren(node)}</div>`;
    case "inlineMath": {
      const expr = String(node.attrs?.expr || node.text || "");
      return `<code class="math inline">${escapeHtml(expr)}</code>`;
    }
    case "mathBlock": {
      const expr = String(node.attrs?.expr || (node.content || []).map((c) => c.text || "").join(""));
      return `<pre class="math block"><code>${escapeHtml(expr)}</code></pre>`;
    }
    case "text":
      return renderMarks(escapeHtml(node.text || ""), node.marks);
    case "htmlEmbed":
      // 安全：htmlEmbed 可能包含脚本/iframe，直接跳过，不写入剪贴板
      return "";
    case "tableOfContents":
      // 目录是文档内自动生成的视图，粘贴到外部无意义，输出占位文本
      return "<p>📑 目录</p>";
    case "breadcrumb":
      return "<p>📑 路径栏</p>";
    case "buttonBlock":
      return `<button type="button">${escapeHtml(String(node.attrs?.label || "按钮"))}</button>`;
    case "tabs": {
      // 导出时展开所有页签，避免内容丢失
      const tabs = (node.content || []).map((tab, i) =>
        `<h4>${escapeHtml(String(tab.attrs?.title || `标签页 ${i + 1}`))}</h4>${renderChildren(tab)}`
      );
      return tabs.join("");
    }
    case "tab":
      return renderChildren(node);
    case "mermaid":
      return `<pre><code>${escapeHtml(String(node.attrs?.code || ""))}</code></pre>`;
    case "embed": {
      const url = String(node.attrs?.url || "");
      const title = escapeHtml(String(node.attrs?.title || url));
      return url ? `<a href="${escapeHtml(url)}">${title}</a>` : "";
    }
    case "syncedBlock":
      // 同步块导出时展开其内容（不保留同步语义，但内容不丢）
      return renderChildren(node);
    case "databaseBlock":
      // 数据库块导出为占位（数据本身不内联）
      return `<div class="database-block-placeholder">🗄️ 数据库</div>`;
    default:
      // 未知节点：尽量递归渲染其 content，避免内容丢失；但不输出未知标签
      return renderChildren(node);
  }
}

export function tiptapJsonToHtml(json: Record<string, unknown> | null | undefined): string {
  if (!json) return "";
  try {
    return renderNode(json as unknown as PMNode);
  } catch {
    return "";
  }
}

/**
 * 从 TipTap JSON 提取纯文本（段落间用空行分隔）。
 * 不依赖编辑器实例，可在 Node 环境测试。
 */
export function tiptapJsonToPlainText(json: Record<string, unknown> | null | undefined): string {
  if (!json) return "";
  try {
    return extractPlainText(json as unknown as PMNode).trim();
  } catch {
    return "";
  }
}

function extractPlainText(node: PMNode): string {
  switch (node.type) {
    case "doc":
      return (node.content || []).map(extractPlainText).join("\n\n");
    case "paragraph":
    case "heading":
      return (node.content || []).map(extractPlainText).join("");
    case "blockquote":
    case "callout":
    case "detailsContent":
      return (node.content || []).map(extractPlainText).join("\n\n");
    case "bulletList":
    case "orderedList":
    case "taskList":
      return (node.content || []).map((c, i) => {
        const text = extractPlainText(c);
        return node.type === "orderedList" ? `${i + 1}. ${text}` : `- ${text}`;
      }).join("\n");
    case "listItem":
    case "taskItem": {
      const parts = (node.content || []).map(extractPlainText);
      const main = parts[0] || "";
      const nested = parts.slice(1).join("\n").replace(/^/gm, "  ");
      return nested ? `${main}\n${nested}` : main;
    }
    case "codeBlock": {
      return (node.content || []).map((c) => c.text || "").join("");
    }
    case "hardBreak":
      return "\n";
    case "horizontalRule":
      return "---";
    case "image": {
      const alt = String(node.attrs?.alt || "");
      return alt ? `[${alt}]` : "[image]";
    }
    case "table":
      return (node.content || []).map(extractPlainText).join("\n");
    case "tableRow":
      return (node.content || []).map(extractPlainText).join(" | ");
    case "tableHeader":
    case "tableCell":
      return (node.content || []).map(extractPlainText).join("");
    case "details": {
      const summary = (node.content || []).find((c) => c.type === "detailsSummary");
      const rest = (node.content || []).filter((c) => c.type !== "detailsSummary");
      const summaryText = summary ? extractPlainText(summary) : "";
      const restText = rest.map(extractPlainText).join("\n\n");
      return restText ? `${summaryText}\n${restText}` : summaryText;
    }
    case "detailsSummary":
      return (node.content || []).map(extractPlainText).join("");
    case "columns":
      return (node.content || []).map(extractPlainText).join("\n\n");
    case "column":
      return (node.content || []).map(extractPlainText).join("");
    case "inlineMath":
    case "mathBlock":
      return String(node.attrs?.expr || node.text || "");
    case "text":
      return node.text || "";
    case "htmlEmbed":
      return "";
    case "tableOfContents":
      return "📑 目录";
    case "breadcrumb":
      return "📑 路径栏";
    case "buttonBlock":
      return `[按钮] ${String(node.attrs?.label || "按钮")}`;
    case "tabs":
      return (node.content || []).map((tab, i) =>
        `[${String(tab.attrs?.title || `标签页 ${i + 1}`)}]\n${extractPlainText(tab)}`
      ).join("\n\n");
    case "tab":
      return (node.content || []).map(extractPlainText).join("\n\n");
    case "mermaid":
      return `[mermaid]\n${String(node.attrs?.code || "")}`;
    case "embed":
      return String(node.attrs?.url || "");
    case "syncedBlock":
      return (node.content || []).map(extractPlainText).join("\n\n");
    case "databaseBlock":
      return "🗄️ 数据库";
    default:
      return (node.content || []).map(extractPlainText).join("");
  }
}

/**
 * 将 HTML 包裹为完整文档（带 charset meta 和基本样式），
 * 粘贴到 Word / Google Docs / 邮件等富文本环境时保留结构。
 */
export function wrapClipboardHtml(bodyHtml: string, title?: string): string {
  const titleHtml = title && title.trim()
    ? `<h1>${escapeHtml(title.trim())}</h1>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${titleHtml}${bodyHtml}</body></html>`;
}
