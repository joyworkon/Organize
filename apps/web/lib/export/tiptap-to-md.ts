/**
 * TipTap / ProseMirror JSON → Markdown 渲染器
 * 覆盖常见节点：段落/标题/列表/引用/代码块/图片/任务列表/表格/分隔线等，
 * 以及项目自定义复杂块（标注/分栏/折叠/tabs/Mermaid/嵌入/按钮/同步块/数据库块等）的降级导出。
 * 用于笔记导出 .md 文件。
 *
 * 两条入口共用一次渲染：
 * - tiptapJsonToMarkdown(json, title?)：纯字符串，向后兼容。
 * - renderMarkdownExport(json, title?)：返回 { markdown, warnings }，降级信息与正文分离；
 *   UI 文案在调用侧按 warning.code 映射。
 *
 * 降级矩阵（有意映射，不静默丢内容）：
 * - callout → 引用（emoji 前缀）；columns → 依次展开；details → 摘要加粗 + 正文；
 * - tabs → 各页标题加粗 + 正文；mermaid → mermaid 代码围栏；htmlEmbed → html 代码围栏；
 * - embed → 标题链接；buttonBlock → 标签 + 安目标链接（不安全目标只保留标签）；
 * - tableOfContents / breadcrumb → 可读说明行；syncedBlock → 导出正文内已有快照；
 * - databaseBlock → 引用说明行 + database-rows-excluded 警告（不为其读取任何行数据）；
 * - 未知块节点 → 递归子块 + unknown-node 警告；未知行内节点 → 保留可读文字 + 警告。
 */

export type MarkdownExportWarningCode =
  | "unknown-node"
  | "database-rows-excluded"
  | "table-merged-cells"
  | "render-failed";

export interface MarkdownExportWarning {
  code: MarkdownExportWarningCode;
  /** 触发降级的节点类型（render-failed 时为 "doc"） */
  nodeType: string;
  /** 面向开发者的简短说明；用户文案由调用侧映射 */
  message: string;
}

export interface MarkdownExportResult {
  markdown: string;
  warnings: MarkdownExportWarning[];
}

interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

/** 判定按钮/链接目标是否可安全导出为链接（与 button-block 的白名单一致）。 */
function isSafeExportTarget(value: string): boolean {
  const url = value.trim();
  if (!url) return false;
  if (url.startsWith("/")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
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

class MarkdownRenderer {
  private warnings: MarkdownExportWarning[] = [];

  private warn(code: MarkdownExportWarningCode, nodeType: string, message: string) {
    // 同类去重：导出几百个同型未知节点时 warnings 不应爆炸
    if (!this.warnings.some((w) => w.code === code && w.nodeType === nodeType)) {
      this.warnings.push({ code, nodeType, message });
    }
  }

  /** 行内渲染：text/hardBreak/image/inlineMath；未知行内节点保留可读文字。 */
  renderInline(nodes: PMNode[] | undefined): string {
    if (!Array.isArray(nodes)) return "";
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
        if (node.type === "inlineMath") {
          // 编辑器扩展存储属性名为 latex（extensions/math.tsx），expr 仅为兼容旧数据兜底
          const latex = String(node.attrs?.latex || node.attrs?.expr || node.text || "");
          return latex ? `$${latex}$` : "";
        }
        // 未知行内节点：保留可读文字，不默认返回空
        const readable = this.readableText(node);
        this.warn("unknown-node", node.type, `未知行内节点 ${node.type}，已保留可读文字`);
        return readable;
      })
      .join("");
  }

  /** 从任意节点收集可读文字（用于未知节点的最小降级）。 */
  private readableText(node: PMNode): string {
    if (typeof node.text === "string") return escapeMd(node.text);
    if (Array.isArray(node.content)) {
      return node.content.map((child) => this.readableText(child)).join("");
    }
    return "";
  }

  /** 引用块通用处理：子块渲染后逐行加 "> "。 */
  private renderQuote(children: PMNode[]): string {
    return this.renderChildrenBlocks(children)
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  }

  /** 子块递归，过滤空块后按空行连接。 */
  private renderChildrenBlocks(children: PMNode[] | undefined): string {
    if (!Array.isArray(children)) return "";
    return children
      .map((child) => this.renderBlock(child))
      .filter((part) => part.length > 0)
      .join("\n\n");
  }

  /** 代码围栏：长度避开内容内的连续反引号。 */
  private renderCodeFence(lang: string, code: string): string {
    let longestRun = 0;
    for (const match of code.matchAll(/`+/g)) {
      longestRun = Math.max(longestRun, match[0].length);
    }
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    return `${fence}${lang}\n${code}\n${fence}`;
  }

  /** 列表项：首块接标记，其余块（含嵌套列表）按标记宽度缩进。 */
  private renderListItem(li: PMNode, marker: string): string {
    const children = Array.isArray(li.content) ? li.content : [];
    const blocks = children
      .map((child) => this.renderBlock(child))
      .filter((part) => part.length > 0);
    if (blocks.length === 0) return marker.trimEnd();

    const pad = " ".repeat(marker.length);
    const firstLines = blocks[0].split("\n");
    let out = marker + (firstLines[0] || "");
    if (firstLines.length > 1) {
      out += "\n" + firstLines.slice(1).map((line) => (line ? pad + line : pad.trimEnd())).join("\n");
    }
    for (const block of blocks.slice(1)) {
      out += "\n" + block.split("\n").map((line) => (line ? pad + line : pad.trimEnd())).join("\n");
    }
    return out;
  }

  /** 无序/有序列表：marker 回调决定每项前缀（含嵌套深度由上层缩进保证）。 */
  private renderList(list: PMNode, markerFor: (index: number) => string): string {
    const items = Array.isArray(list.content) ? list.content : [];
    return items.map((li, i) => this.renderListItem(li, markerFor(i))).join("\n");
  }

  /** 表格单元格：多段落 <br> 连接，竖线转义（避免重复转义已转义字符）。 */
  private renderCell(cell: PMNode): string {
    const paragraphs = Array.isArray(cell.content) ? cell.content : [];
    const text = paragraphs
      .map((p) => (p.type === "paragraph" || p.type === "heading"
        ? this.renderInline(p.content)
        : this.readableText(p)))
      .join("<br>");
    return text.replace(/\\\n/g, "<br>").replace(/\n/g, "<br>").replace(/(?<!\\)\|/g, "\\|").trim();
  }

  private renderTable(table: PMNode): string {
    const rows = (Array.isArray(table.content) ? table.content : []).filter((r) => r.type === "tableRow");
    if (rows.length === 0) return "";

    // 检测合并单元格（colspan/rowspan）：按可读降级平铺并注明
    let hasMerged = false;
    for (const row of rows) {
      for (const cell of Array.isArray(row.content) ? row.content : []) {
        const colspan = Number(cell.attrs?.colspan) || 1;
        const rowspan = Number(cell.attrs?.rowspan) || 1;
        if (colspan > 1 || rowspan > 1) hasMerged = true;
      }
    }
    if (hasMerged) {
      this.warn("table-merged-cells", "table", "表格含合并单元格，已按平铺展开导出，不是完整还原");
    }

    const renderRow = (row: PMNode): string => {
      const cells: string[] = [];
      for (const cell of Array.isArray(row.content) ? row.content : []) {
        if (cell.type !== "tableCell" && cell.type !== "tableHeader") continue;
        cells.push(this.renderCell(cell));
        // 合并单元格补空占位，保持后续列对齐
        const colspan = Number(cell.attrs?.colspan) || 1;
        for (let extra = 1; extra < colspan; extra += 1) cells.push("");
      }
      return cells.join(" | ");
    };

    const header = renderRow(rows[0]);
    const colCount = header.split(" | ").length || 1;
    const sep = Array(colCount).fill("---").join(" | ");
    const body = rows.slice(1).map(renderRow).join("\n");
    const bodyLines = body ? body.split("\n").map((l) => `| ${l} |`).join("\n") : "";
    return `| ${header} |\n| ${sep} |\n${bodyLines}`;
  }

  renderBlock(node: PMNode): string {
    switch (node.type) {
      case "doc":
        return this.renderChildrenBlocks(node.content);

      case "paragraph":
        return this.renderInline(node.content);

      case "heading": {
        const level = Number(node.attrs?.level) || 2;
        const hashes = "#".repeat(Math.min(Math.max(level, 1), 6));
        return `${hashes} ${this.renderInline(node.content)}`;
      }

      case "bulletList":
        return this.renderList(node, () => "- ");

      case "orderedList": {
        const start = Number(node.attrs?.start) || 1;
        return this.renderList(node, (i) => `${start + i}. `);
      }

      case "taskList": {
        const items = Array.isArray(node.content) ? node.content : [];
        return items
          .map((item) => {
            const checked = item.attrs?.checked === true;
            return this.renderListItem(item, checked ? "- [x] " : "- [ ] ");
          })
          .join("\n");
      }

      case "blockquote":
        return this.renderQuote(Array.isArray(node.content) ? node.content : []);

      case "callout": {
        // 标注 → 引用：emoji 作首行前缀，正文逐行引用
        const emoji = String(node.attrs?.emoji || "💡");
        const body = this.renderQuote(Array.isArray(node.content) ? node.content : []);
        return body.replace(/^>/, `> ${emoji}`);
      }

      case "codeBlock": {
        const lang = String(node.attrs?.language || "");
        const code = (node.content || []).map((c) => c.text || "").join("");
        return this.renderCodeFence(lang, code);
      }

      case "horizontalRule":
        return "---";

      case "image": {
        const src = String(node.attrs?.src || "");
        const alt = String(node.attrs?.alt || "");
        return `![${alt}](${src})`;
      }

      case "table":
        return this.renderTable(node);

      case "mathBlock": {
        const latex = String(node.attrs?.latex || node.attrs?.expr || (node.content || []).map((c) => c.text || "").join(""));
        return latex ? `$$\n${latex}\n$$` : "";
      }

      case "fileAttachment": {
        // 附件块（extensions/file-attachment.tsx）：atom 无子节点，导出为文件链接。
        // 远程链接仅为引用，不代表离线备份了附件内容。
        const src = String(node.attrs?.src || "");
        const name = String(node.attrs?.name || "附件");
        return src ? `[📎 ${name}](${src})` : `📎 ${name}`;
      }

      case "columns":
        // 分栏依次展开
        return this.renderChildrenBlocks(node.content);

      case "column":
        return this.renderChildrenBlocks(node.content);

      case "details": {
        const children = Array.isArray(node.content) ? node.content : [];
        const summary = children.find((c) => c.type === "detailsSummary");
        const rest = children.filter((c) => c.type !== "detailsSummary");
        const summaryText = summary ? this.renderChildrenBlocks(summary.content).split("\n").join(" ") : "";
        const head = summaryText ? `**${summaryText}**` : "";
        const body = this.renderChildrenBlocks(rest.map((c) => (c.type === "detailsContent" ? { ...c, type: "__fragment" } : c)) as PMNode[]);
        return [head, body].filter((part) => part.length > 0).join("\n\n");
      }

      case "__fragment":
        return this.renderChildrenBlocks(node.content);

      case "detailsSummary":
        return this.renderChildrenBlocks(node.content);

      case "detailsContent":
        return this.renderChildrenBlocks(node.content);

      case "tabs": {
        const tabs = Array.isArray(node.content) ? node.content : [];
        return tabs
          .map((tab) => {
            const title = String(tab.attrs?.title || "无标题");
            const body = this.renderChildrenBlocks(tab.content);
            return `**【${title}】**${body ? `\n\n${body}` : ""}`;
          })
          .join("\n\n");
      }

      case "tab":
        return this.renderChildrenBlocks(node.content);

      case "mermaid": {
        const code = String(node.attrs?.code || "");
        return code ? this.renderCodeFence("mermaid", code) : "";
      }

      case "htmlEmbed": {
        const html = String(node.attrs?.html || "");
        return html ? this.renderCodeFence("html", html) : "";
      }

      case "embed": {
        const url = String(node.attrs?.url || "");
        const title = String(node.attrs?.title || node.attrs?.siteName || "嵌入内容");
        if (!url) return title;
        return isSafeExportTarget(url) ? `[${title}](${url})` : title;
      }

      case "buttonBlock": {
        const label = String(node.attrs?.label || "按钮");
        const action = String(node.attrs?.action || "open-url");
        const payload = String(node.attrs?.payload || "");
        if (action === "open-url" && payload && isSafeExportTarget(payload)) {
          return `[${label}](${payload})`;
        }
        // insert-blocks 或不安全目标：只保留标签文字
        return label;
      }

      case "tableOfContents":
        return "〔目录〕";

      case "breadcrumb":
        return "〔面包屑导航〕";

      case "syncedBlock":
        // 导出当前正文中已有的快照内容；跨设备同步语义不在导出范围
        return this.renderChildrenBlocks(node.content);

      case "databaseBlock": {
        const databaseId = String(node.attrs?.databaseId || "");
        const viewId = String(node.attrs?.viewId || "");
        this.warn("database-rows-excluded", "databaseBlock", "数据库块仅导出引用，未包含数据库行数据");
        const ref = databaseId ? `数据库 ${databaseId}` : "数据库";
        return `〔${ref}${viewId ? ` · 视图 ${viewId}` : ""}：行数据未包含在导出中〕`;
      }

      default: {
        // 未知节点：有子内容就递归块内容（子节点是 text 时按行内渲染），不默认返回空
        if (Array.isArray(node.content) && node.content.length > 0) {
          this.warn("unknown-node", node.type, `未知块节点 ${node.type}，已递归导出其内容`);
          return node.content
            .map((child) => (child.type === "text" ? this.renderInline([child]) : this.renderBlock(child)))
            .filter((part) => part.length > 0)
            .join("\n\n");
        }
        const readable = this.readableText(node);
        if (readable) this.warn("unknown-node", node.type, `未知节点 ${node.type}，已保留可读文字`);
        return readable;
      }
    }
  }

  render(json: Record<string, unknown> | null | undefined, title?: string): MarkdownExportResult {
    if (!json) return { markdown: title ? `# ${title}\n` : "", warnings: [] };
    try {
      const body = this.renderBlock(json as unknown as PMNode);
      return { markdown: title ? `# ${title}\n\n${body}` : body, warnings: this.warnings };
    } catch (error) {
      this.warn("render-failed", "doc", `渲染失败：${error instanceof Error ? error.message : String(error)}`);
      return { markdown: title ? `# ${title}\n` : "", warnings: this.warnings };
    }
  }
}

/**
 * 详细导出结果：markdown 与降级 warnings 分离。
 * warnings 为可测试的类型化数组；UI 文案在调用侧按 code 映射。
 */
export function renderMarkdownExport(
  json: Record<string, unknown> | null | undefined,
  title?: string
): MarkdownExportResult {
  return new MarkdownRenderer().render(json, title);
}

export function tiptapJsonToMarkdown(
  json: Record<string, unknown> | null | undefined,
  title?: string
): string {
  return renderMarkdownExport(json, title).markdown;
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
