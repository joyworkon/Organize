import type { JSONContent } from "@tiptap/core";
import type { MaterialResult } from "@organize/plugin-sdk";
import { validateMaterialResult } from "./schema";

const text = (value: string): JSONContent[] => value ? [{ type: "text", text: value }] : [];
const paragraph = (value: string): JSONContent => ({ type: "paragraph", content: text(value) });

export function materialResultToNodes(raw: MaterialResult, sources: string[]): JSONContent[] {
  const result = validateMaterialResult(raw);
  const nodes: JSONContent[] = [
    { type: "heading", attrs: { level: 2 }, content: text(result.title) },
    paragraph([result.category, ...result.tags.map((tag) => `#${tag}`)].join(" · ")),
  ];
  for (const block of result.blocks) {
    switch (block.type) {
      case "heading": nodes.push({ type: "heading", attrs: { level: 3 }, content: text(block.text) }); break;
      case "paragraph": nodes.push(paragraph(block.text)); break;
      case "table":
        nodes.push({ type: "table", content: block.rows.map((row, index) => ({
          type: "tableRow", content: row.map((cell) => ({
            type: index === 0 ? "tableHeader" : "tableCell", content: [paragraph(cell)],
          })),
        })) });
        break;
      default:
        nodes.push({ type: block.type, content: block.items.map((item) => ({
          type: block.type === "taskList" ? "taskItem" : "listItem",
          ...(block.type === "taskList" ? { attrs: { checked: false } } : {}),
          content: [paragraph(item)],
        })) });
    }
  }
  nodes.push(paragraph(`来源：${sources.join("、")} · AI 整理，请核对原文`));
  nodes.push({ type: "paragraph" });
  return nodes;
}
