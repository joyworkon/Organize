import type { MaterialRequest, MaterialResult } from "@organize/plugin-sdk";
import { validateMaterialResult } from "./schema";

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const inline = (text: string) => escape(text).replace(/\n/g, "<br>");

/** 全部内容转义后生成阅读正文；不接受模型 HTML、链接或可执行属性。 */
export function materialResultToArticle(raw: MaterialResult, sources: string[]) {
  const result = validateMaterialResult(raw);
  const paragraphs: string[] = [];
  const html = result.blocks.map((block) => {
    if ("text" in block) {
      paragraphs.push(block.text);
      return block.type === "heading" ? `<h2>${inline(block.text)}</h2>` : `<p>${inline(block.text)}</p>`;
    }
    if (block.type === "table") {
      return `<table>${block.rows.map((row, i) => `<tr>${row.map((cell) => `<${i ? "td" : "th"}>${inline(cell)}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</table>`;
    }
    paragraphs.push(...block.items);
    const tag = block.type === "orderedList" ? "ol" : "ul";
    return `<${tag}>${block.items.map((item) => `<li>${block.type === "taskList" ? "☐ " : ""}${inline(item)}</li>`).join("")}</${tag}>`;
  });
  const tags = Array.from(new Set([result.category, ...result.tags]));
  return {
    title: result.title,
    content: `<p>${tags.map(escape).join(" · ")}</p>${html.join("")}<p>来源：${sources.map(escape).join("、")} · AI 整理，请核对原文</p>`,
    excerpt: paragraphs.join(" ").slice(0, 240) || result.title,
    tags,
  };
}

/** 同批物料与模式产生稳定键，保存重试和重复导入复用去重语义。 */
export async function materialFingerprint(request: MaterialRequest): Promise<string> {
  const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (n) => n.toString(16).padStart(2, "0")).join("");
  const files = [];
  for (const file of request.files) files.push({ name: file.name, hash: await digest(await file.arrayBuffer()) });
  return digest(new TextEncoder().encode(JSON.stringify({ mode: request.mode, text: request.text?.trim() ?? "", files })).buffer);
}
