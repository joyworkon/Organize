/**
 * TipTap / ProseMirror JSON → HTML 的极简渲染器。
 * 只覆盖公开分享页展示所需的常见节点，不做完整 ProseMirror schema 还原。
 * 不引入 @tiptap 依赖（这是给公开页/导出用的独立工具）。
 */

interface PMNode {
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

function renderNode(node: PMNode): string {
  switch (node.type) {
    case "doc":
      return (node.content || []).map(renderNode).join("");
    case "paragraph":
      return `<p>${(node.content || []).map(renderNode).join("")}</p>`;
    case "heading": {
      const level = Number(node.attrs?.level) || 2;
      const lv = Math.min(Math.max(level, 1), 6);
      return `<h${lv}>${(node.content || []).map(renderNode).join("")}</h${lv}>`;
    }
    case "bulletList":
      return `<ul>${(node.content || []).map(renderNode).join("")}</ul>`;
    case "orderedList":
      return `<ol>${(node.content || []).map(renderNode).join("")}</ol>`;
    case "listItem":
      return `<li>${(node.content || []).map(renderNode).join("")}</li>`;
    case "blockquote":
      return `<blockquote>${(node.content || []).map(renderNode).join("")}</blockquote>`;
    case "codeBlock":
      return `<pre><code>${escapeHtml((node.content || []).map((c) => c.text || "").join(""))}</code></pre>`;
    case "horizontalRule":
      return "<hr />";
    case "hardBreak":
      return "<br />";
    case "image": {
      const src = String(node.attrs?.src || "");
      const alt = String(node.attrs?.alt || "");
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`;
    }
    case "text":
      return renderMarks(escapeHtml(node.text || ""), node.marks);
    default:
      // 未知节点：尽量递归渲染其 content，避免内容丢失
      return node.content ? (node.content.map(renderNode).join("")) : "";
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
