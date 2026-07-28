import { generateJSON } from "@tiptap/html";
import { marked } from "marked";
import StarterKit from "@tiptap/starter-kit";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";

/**
 * 用于把 Markdown 转成 TipTap 文档 JSON 的扩展子集。
 *
 * 必须与编辑器（tiptap-editor.tsx）的节点/标记 schema 对齐，生成的 JSON 才能被编辑器正确加载。
 * 这里刻意排除依赖 React NodeView 的自定义扩展（Callout / Math / Columns / HtmlEmbed 等）：
 * 一是它们无法在 Node 环境实例化，二是 JoySpace 的 Markdown 也不会产出这些结构。
 */
const IMPORT_EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  Image.configure({ inline: false, allowBase64: true }),
  Link.configure({ openOnClick: false }),
  Underline,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableCell,
  TableHeader,
];

const DEFAULT_MAX_CHARS = 200_000;
const DEFAULT_MAX_TABLE_ROWS = 200;

export interface MarkdownImportOptions {
  /** 正文字符上限，超出则截断（默认 20 万）。JoySpace 表格文档可达数十万字符。 */
  maxChars?: number;
  /** 单个表格保留的数据行上限（不含表头，默认 200）。超大表格会拖垮编辑器。 */
  maxTableRows?: number;
  /** 若提供，会在正文顶部插入一段“来源：<链接>”。 */
  sourceUrl?: string;
}

export interface MarkdownImportResult {
  /** TipTap 文档 JSON，可直接写入 notes.content。 */
  doc: Record<string, unknown>;
  /** 从首个标题（或首段文字）推断出的标题。 */
  title: string;
  /** 是否发生了截断（字符数或表格行数）。 */
  truncated: boolean;
}

const TABLE_TRUNCATED_NOTICE = (rows: number) =>
  `\n\n> ⚠️ 表格过长，已截断至 ${rows} 行，完整内容请查看原文档。\n\n`;

/**
 * 逐行扫描 Markdown，把每个表格的数据行数限制在 maxRows 以内。
 * 表头（首行）与分隔行（|---|）始终保留；超出部分丢弃并在表后追加提示。
 */
function capTableRows(markdown: string, maxRows: number): { markdown: string; capped: boolean } {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let bodyRows = 0;
  let inTable = false;
  let thisTableCapped = false;
  let anyCapped = false;

  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isSeparator = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l);

  const flushNoticeIfNeeded = () => {
    if (inTable && thisTableCapped) out.push(TABLE_TRUNCATED_NOTICE(maxRows).trim());
  };

  let sawSeparator = false;
  for (const line of lines) {
    if (isTableRow(line)) {
      if (!inTable) {
        inTable = true;
        bodyRows = 0;
        thisTableCapped = false;
        sawSeparator = false;
      }
      if (isSeparator(line)) {
        sawSeparator = true;
        out.push(line);
        continue;
      }
      // 分隔行之前的行是表头，始终保留、不计入 body 上限
      if (!sawSeparator) {
        out.push(line);
        continue;
      }
      bodyRows++;
      if (bodyRows <= maxRows) {
        out.push(line);
      } else if (!thisTableCapped) {
        thisTableCapped = true;
        anyCapped = true;
      }
    } else {
      flushNoticeIfNeeded();
      inTable = false;
      thisTableCapped = false;
      out.push(line);
    }
  }
  flushNoticeIfNeeded();

  return { markdown: out.join("\n"), capped: anyCapped };
}

/**
 * 把 GFM 任务列表（marked 输出的 `<li><input type=checkbox>`）改写成
 * TipTap TaskList 能识别的 `data-type` 标记，否则会退化成带字面复选框的普通列表。
 */
function normalizeTaskLists(html: string): string {
  let result = html.replace(
    /<li>\s*<input([^>]*?)type="checkbox"([^>]*?)>\s*/gi,
    (_m, pre, post) => {
      const checked = /checked/i.test(pre) || /checked/i.test(post);
      return `<li data-type="taskItem" data-checked="${checked}"><p>`;
    }
  );
  // 为紧跟 taskItem 的 <ul> 打上 taskList 标记
  result = result.replace(/<ul>(\s*<li data-type="taskItem")/gi, '<ul data-type="taskList">$1');
  // 上面替换开了 <p>，需要在对应 </li> 前补 </p>
  result = result.replace(/(<li data-type="taskItem"[^>]*><p>[\s\S]*?)<\/li>/gi, (m) => {
    if (/<\/p>\s*<\/li>$/i.test(m)) return m;
    return m.replace(/<\/li>$/i, "</p></li>");
  });
  return result;
}

/** 从 TipTap 文档 JSON 中提取纯文本（用于推断标题）。 */
function extractText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) return n.content.map(extractText).join("");
  return "";
}

/** 从文档中推断标题：首个 heading 的文本 → 首段文字前 60 字 → 兜底。 */
function inferTitle(doc: Record<string, unknown>): string {
  const content = (doc.content as Array<Record<string, unknown>>) || [];
  const heading = content.find((n) => n.type === "heading");
  if (heading) {
    const t = extractText(heading).trim();
    if (t) return t.slice(0, 120);
  }
  const para = content.find((n) => n.type === "paragraph");
  if (para) {
    const t = extractText(para).trim();
    if (t) return t.slice(0, 60);
  }
  return "导入的文档";
}

/**
 * 把 Markdown 转成可直接写入 notes.content 的 TipTap 文档 JSON。
 *
 * 流程：截断超大表格 → 字符数上限截断 → marked 转 HTML（开启 GFM）→
 * 规整任务列表 → generateJSON 按编辑器 schema 生成 TipTap JSON → 可选插入来源链接。
 *
 * 说明：read_joyspace 返回的 Markdown 里，图片可能是真实 `![alt](url)`（转成图片节点），
 * 也可能是 `[图片]` 占位文本（无 URL 时，原样保留为普通文字）。
 */
export function markdownToTiptapDoc(
  markdown: string,
  options: MarkdownImportOptions = {}
): MarkdownImportResult {
  const {
    maxChars = DEFAULT_MAX_CHARS,
    maxTableRows = DEFAULT_MAX_TABLE_ROWS,
    sourceUrl,
  } = options;

  let truncated = false;

  // 1. 限制表格行数
  const capped = capTableRows(markdown, maxTableRows);
  let md = capped.markdown;
  if (capped.capped) truncated = true;

  // 2. 字符数上限（在行边界截断，避免切坏结构）
  if (md.length > maxChars) {
    const slice = md.slice(0, maxChars);
    const lastNewline = slice.lastIndexOf("\n");
    md = slice.slice(0, lastNewline > 0 ? lastNewline : maxChars);
    md += "\n\n> ⚠️ 文档过长，已截断，完整内容请查看原文档。\n";
    truncated = true;
  }

  // 3. Markdown → HTML（GFM 支持表格、任务列表、删除线）
  const rawHtml = marked.parse(md, { gfm: true, breaks: false, async: false }) as string;
  const html = normalizeTaskLists(rawHtml);

  // 4. HTML → TipTap JSON（zeed-dom 在 Node 环境即可运行，无需 jsdom）
  const doc = generateJSON(html, IMPORT_EXTENSIONS) as Record<string, unknown>;

  // 5. 推断标题：把正文首个块（标题或带文字的段落）“提升”为笔记标题并从正文移除。
  //    JoySpace / read_joyspace 返回的文档首行即文档标题（可能是纯文本，未必是 # 标题），
  //    因此不能只认 heading——否则会把后面的章节标题误当成笔记标题。
  //    首块若无实际文字（空行 / 纯符号）或不是标题/段落，则退回 inferTitle，且不改动正文。
  const content = (doc.content as Array<Record<string, unknown>>) || [];
  let title: string;
  const first = content[0];
  const firstText = first ? extractText(first).trim() : "";
  if ((first?.type === "heading" || first?.type === "paragraph") && firstText) {
    title = firstText.slice(0, 120);
    content.shift();
  } else {
    title = inferTitle(doc);
  }

  // 6. 可选：在正文顶部插入来源链接
  if (sourceUrl && Array.isArray(doc.content)) {
    (doc.content as unknown[]).unshift({
      type: "paragraph",
      content: [
        { type: "text", text: "来源：" },
        {
          type: "text",
          text: sourceUrl,
          marks: [{ type: "link", attrs: { href: sourceUrl, target: "_blank" } }],
        },
      ],
    });
  }

  // 兜底：移除首个标题后正文可能为空，补一个空段落，保证 doc 合法
  if (Array.isArray(doc.content) && (doc.content as unknown[]).length === 0) {
    (doc.content as unknown[]).push({ type: "paragraph" });
  }

  return { doc, title, truncated };
}
