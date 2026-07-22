/**
 * TipTap / ProseMirror JSON → Markdown 渲染器
 * 覆盖常见节点：段落/标题/列表/引用/代码块/图片/任务列表/表格/分隔线等。
 * 用于笔记导出 .md 文件。
 */

interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

function escapeMd(s: string): string {
  // 转义 Markdown 特殊字符（只对纯文本内容）
  return s.replace(/([\\`*_{}\[\]()#+\-.!~|])/g, "\\$1");
}

function renderInlineMarks(text: string, marks?: PMNode["marks"]): string {
  if (!marks) return text;
  let out = text;
  // 反向应用，让嵌套 marks 正确
  for (const m of marks) {
    switch (m.type) {
      case "bold":
        out = `**${out}**`;
        break;
      case "italic":
        out = `*${out}*`;
        break;
      case "code":
        out = `\`${out}\``;
        break;
      case "strike":
        out = `~~${out}~~`;
        break;
      case "link": {
        const href = String(m.attrs?.href || "");
        out = `[${out}](${href})`;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function renderInline(nodes: PMNode[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((node) => {
      if (node.type === "text") {
        const raw = node.text || "";
        // 如果有 code mark，不转义（code 内容保持原样）
        const hasCode = node.marks?.some((m) => m.type === "code");
        const text = hasCode ? raw : escapeMd(raw);
        return renderInlineMarks(text, node.marks);
      }
      if (node.type === "hardBreak") return "\\\n";
      if (node.type === "image") {
        const src = String(node.attrs?.src || "");
        const alt = String(node.attrs?.alt || "");
        return `![${alt}](${src})`;
      }
      return "";
    })
    .join("");
}

function renderBlock(node: PMNode): string {
  switch (node.type) {
    case "doc":
      return (node.content || []).map(renderBlock).join("\n\n");

    case "paragraph":
      return renderInline(node.content);

    case "heading": {
      const level = Number(node.attrs?.level) || 2;
      const hashes = "#".repeat(Math.min(Math.max(level, 1), 6));
      return `${hashes} ${renderInline(node.content)}`;
    }

    case "bulletList":
      return (node.content || []).map((li) => `- ${renderListItem(li)}`).join("\n");

    case "orderedList":
      return (node.content || [])
        .map((li, i) => `${i + 1}. ${renderListItem(li)}`)
        .join("\n");

    case "listItem":
      return renderListItem(node);

    case "taskList":
      return (node.content || [])
        .map((li) => {
          const checked = li.attrs?.checked;
          const box = checked ? "[x]" : "[ ]";
          return `${box} ${renderListItem(li)}`;
        })
        .join("\n");

    case "blockquote":
      return (node.content || [])
        .map((child) => renderBlock(child))
        .join("\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");

    case "codeBlock": {
      const lang = String(node.attrs?.language || "");
      const code = (node.content || []).map((c) => c.text || "").join("");
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }

    case "horizontalRule":
      return "---";

    case "image": {
      const src = String(node.attrs?.src || "");
      const alt = String(node.attrs?.alt || "");
      return `![${alt}](${src})`;
    }

    case "table": {
      return renderTable(node);
    }

    default:
      // 未知节点：尽量递归 content
      return node.content ? renderInline(node.content) : "";
  }
}

function renderListItem(li: PMNode): string {
  if (!li.content) return "";
  return li.content.map((child) => renderInline(child.content)).join("").trim();
}

function renderTable(table: PMNode): string {
  const rows = (table.content || []).filter((r) => r.type === "tableRow");
  if (rows.length === 0) return "";
  const renderRow = (row: PMNode) => {
    const cells = (row.content || []).filter((c) => c.type === "tableCell" || c.type === "tableHeader");
    return cells.map((c) => renderInline(c.content).replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ");
  };
  const header = renderRow(rows[0]);
  // 第二行分隔
  const colCount = (rows[0].content || []).length || 1;
  const sep = Array(colCount).fill("---").join(" | ");
  const body = rows.slice(1).map(renderRow).join("\n");
  return `| ${header} |\n| ${sep} |\n${body ? body.split("\n").map((l) => `| ${l} |`).join("\n") : ""}`;
}

export function tiptapJsonToMarkdown(
  json: Record<string, unknown> | null | undefined,
  title?: string
): string {
  if (!json) return title ? `# ${title}\n` : "";
  try {
    const body = renderBlock(json as unknown as PMNode);
    return title ? `# ${title}\n\n${body}` : body;
  } catch {
    return title ? `# ${title}\n` : "";
  }
}

/**
 * 触发浏览器下载 .md 文件
 */
export function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".md") ? filename : `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
