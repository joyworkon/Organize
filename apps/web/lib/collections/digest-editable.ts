/**
 * 整理稿编辑转换（阶段 4）：AI 产出的 HTML（h2/p/ul/ol/table）↔ 可编辑纯文本。
 *
 * 迷你标记约定（与用户在编辑框中看到的一致）：
 *   ## 小节标题        → <h2>
 *   - 要点             → <ul><li>
 *   1. 步骤            → <ol><li>（保留显式编号，重排由用户负责）
 *   | a | b |          → <table>（首行为表头；管道内不允许换行）
 *   空行分段，其余行   → <p>
 *
 * 双向转换覆盖 MaterialResult 能产出的全部块型——编辑不丢表格等富结构。
 * 内容始终视为不可信：反向生成时全部 HTML 转义（复用 article.ts 的转义表）。
 */

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );

interface Block {
  kind: "heading" | "paragraph" | "ul" | "ol" | "table";
  text?: string;
  items?: string[];
  rows?: string[][];
}

/** HTML → 可编辑文本（迷你标记）。识别 h2/p/ul/ol/table；其余标签剥壳保字。 */
export function htmlToEditableText(html: string): string {
  const blocks: string[] = [];
  const blockRe = /<(h2|p|ul|ol|table)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html))) {
    const tag = match[1].toLowerCase();
    const inner = match[2];
    if (tag === "h2") {
      blocks.push(`## ${innerText(inner)}`);
    } else if (tag === "p") {
      const text = innerText(inner);
      if (text.trim()) blocks.push(text);
    } else if (tag === "ul" || tag === "ol") {
      const itemRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let item: RegExpExecArray | null;
      let index = 1;
      while ((item = itemRe.exec(inner))) {
        const text = innerText(item[1]).replace(/^☐\s*/, "");
        blocks.push(tag === "ul" ? `- ${text}` : `${index}. ${text}`);
        index += 1;
      }
    } else {
      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let row: RegExpExecArray | null;
      while ((row = rowRe.exec(inner))) {
        const cells: string[] = [];
        const cellRe = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi;
        let cell: RegExpExecArray | null;
        while ((cell = cellRe.exec(row[1]))) cells.push(innerText(cell[2]));
        if (cells.length) blocks.push(`| ${cells.join(" | ")} |`);
      }
    }
  }
  return blocks.join("\n\n");
}

/** 可编辑文本 → HTML（全部转义；解析不了行当作段落）。 */
export function editableTextToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      blocks.push({ kind: "heading", text: line.slice(3).trim() });
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      const items = [line.slice(2).trim()];
      blocks.push({ kind: "ul", items });
      continue;
    }
    const ordered = line.match(/^(\d+)[.、]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      blocks.push({ kind: "ol", items: [ordered[2]] });
      continue;
    }
    if (line.startsWith("|") && line.endsWith("|")) {
      flushParagraph();
      const cells = line
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      // 相邻表格行合并成一张表（首行为表头）
      const previous = blocks[blocks.length - 1];
      if (previous && previous.kind === "table") {
        previous.rows!.push(cells);
      } else {
        blocks.push({ kind: "table", rows: [cells] });
      }
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();

  // 相邻同类型列表合并（htmlToEditableText 把 li 拆成独立行）
  const merged: Block[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (
      (block.kind === "ul" || block.kind === "ol") &&
      previous &&
      previous.kind === block.kind
    ) {
      previous.items!.push(...block.items!);
      continue;
    }
    merged.push(block);
  }

  return merged
    .map((block) => {
      if (block.kind === "heading") return `<h2>${escape(block.text!)}</h2>`;
      if (block.kind === "paragraph")
        return block
          .text!.split("\n")
          .map((line) => `<p>${escape(line)}</p>`)
          .join("");
      if (block.kind === "table")
        return `<table>${block
          .rows!.map((row, i) => `<tr>${row.map((cell) => `<${i ? "td" : "th"}>${escape(cell)}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</table>`;
      const tag = block.kind === "ol" ? "ol" : "ul";
      return `<${tag}>${block.items!.map((item) => `<li>${escape(item)}</li>`).join("")}</${tag}>`;
    })
    .join("");
}

function innerText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}
