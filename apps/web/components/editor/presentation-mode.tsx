"use client";

import type { JSONContent } from "@tiptap/core";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildPresentationSlides } from "./block-utils";

export function PresentationMode({
  doc,
  startBlockId,
  onClose,
}: {
  doc: JSONContent;
  startBlockId: string;
  onClose: () => void;
}) {
  const slides = useMemo(() => buildPresentationSlides(doc, startBlockId), [doc, startBlockId]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        setIndex((value) => Math.min(value + 1, slides.length - 1));
      } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        setIndex((value) => Math.max(value - 1, 0));
      } else if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      } else {
        // 演示期间组件拿不到 editor 实例，无法 setEditable(false)；在捕获阶段拦截其余按键，
        // 避免底层仍聚焦的编辑器响应输入或 Ctrl+Z 等快捷键修改文档。
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose, slides.length]);

  const slide = slides[Math.min(index, slides.length - 1)];
  if (!slide) return null;
  return (
    <div className="note-presentation" role="dialog" aria-modal="true" aria-label="笔记演示模式">
      <button className="presentation-close" type="button" onClick={onClose} aria-label="退出演示"><X /></button>
      <main key={slide.id}>
        {slide.title && <h1>{slide.title}</h1>}
        <div className="presentation-content">{slide.content.map((block, blockIndex) => <RenderBlock key={String(block.attrs?.id || blockIndex)} block={block} />)}</div>
      </main>
      <footer>
        <button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} disabled={index === 0}><ChevronLeft /></button>
        <span>{index + 1} / {slides.length}</span>
        <button type="button" onClick={() => setIndex((value) => Math.min(slides.length - 1, value + 1))} disabled={index === slides.length - 1}><ChevronRight /></button>
      </footer>
    </div>
  );
}

function RenderInline({ node }: { node: JSONContent }): React.ReactNode {
  if (node.type !== "text") return (node.content || []).map((child, index) => <RenderInline key={index} node={child} />);
  let content: React.ReactNode = node.text || "";
  for (const mark of node.marks || []) {
    if (mark.type === "bold") content = <strong>{content}</strong>;
    else if (mark.type === "italic") content = <em>{content}</em>;
    else if (mark.type === "strike") content = <s>{content}</s>;
    else if (mark.type === "code") content = <code>{content}</code>;
    else if (mark.type === "link") content = <a href={String(mark.attrs?.href || "#")} target="_blank" rel="noreferrer">{content}</a>;
    else if (mark.type === "textStyle" && mark.attrs?.color) content = <span style={{ color: String(mark.attrs.color) }}>{content}</span>;
    else if (mark.type === "highlight") content = <mark style={{ backgroundColor: String(mark.attrs?.color || "#fdecc8") }}>{content}</mark>;
  }
  return content;
}

function InlineContent({ block }: { block: JSONContent }) {
  return <>{(block.content || []).map((node, index) => <RenderInline key={index} node={node} />)}</>;
}

function RenderBlock({ block }: { block: JSONContent }): React.ReactNode {
  const style = block.attrs?.backgroundColor ? { backgroundColor: String(block.attrs.backgroundColor) } : undefined;
  if (block.type === "paragraph") return <p style={style}><InlineContent block={block} /></p>;
  if (block.type === "heading") {
    const level = Number(block.attrs?.level || 3);
    if (level === 1) return <h2 style={style}><InlineContent block={block} /></h2>;
    if (level === 2) return <h3 style={style}><InlineContent block={block} /></h3>;
    return <h4 style={style}><InlineContent block={block} /></h4>;
  }
  if (block.type === "blockquote") return <blockquote style={style}>{(block.content || []).map((child, index) => <RenderBlock key={index} block={child} />)}</blockquote>;
  if (block.type === "codeBlock") return <pre><code><InlineContent block={block} /></code></pre>;
  if (block.type === "horizontalRule") return <hr />;
  // 演示模式需原样支持用户粘贴的 data URL 与任意远端图片，不能套用 next/image 域名约束。
  // eslint-disable-next-line @next/next/no-img-element
  if (block.type === "image") {
    const width = Number(block.attrs?.width) || null;
    return <img src={String(block.attrs?.src || "")} alt={String(block.attrs?.alt || "")} style={width ? { width: `${width}px`, maxWidth: "100%" } : undefined} />;
  }
  if (block.type === "fileAttachment") {
    const mime = String(block.attrs?.mime || "");
    const name = String(block.attrs?.name || "附件");
    if (mime.startsWith("video/")) return <video src={String(block.attrs?.src || "")} controls />;
    if (mime.startsWith("audio/")) return <audio src={String(block.attrs?.src || "")} controls />;
    return <p>📎 {name}</p>;
  }
  if (block.type === "callout") return <aside style={style}><span>{String(block.attrs?.emoji || "💡")}</span><p><InlineContent block={block} /></p></aside>;
  if (["bulletList", "orderedList", "taskList"].includes(block.type || "")) {
    const Tag = block.type === "orderedList" ? "ol" : "ul";
    return <Tag className={block.type === "taskList" ? "presentation-task-list" : ""}>{(block.content || []).map((item, index) => <li key={index}>{block.type === "taskList" && <input type="checkbox" checked={Boolean(item.attrs?.checked)} readOnly />}{(item.content || []).map((child, childIndex) => <RenderBlock key={childIndex} block={child} />)}</li>)}</Tag>;
  }
  if (block.type === "details") return <details open><summary><InlineContent block={(block.content || [])[0] || { type: "text" }} /></summary>{((block.content || [])[1]?.content || []).map((child, index) => <RenderBlock key={index} block={child} />)}</details>;
  if (block.type === "columns") return <div className="presentation-columns">{(block.content || []).map((column, index) => <div key={index}>{(column.content || []).map((child, childIndex) => <RenderBlock key={childIndex} block={child} />)}</div>)}</div>;
  if (block.type === "table") return <table><tbody>{(block.content || []).map((row, rowIndex) => <tr key={rowIndex}>{(row.content || []).map((cell, cellIndex) => <td key={cellIndex}>{(cell.content || []).map((child, childIndex) => <RenderBlock key={childIndex} block={child} />)}</td>)}</tr>)}</tbody></table>;
  if (block.type === "htmlEmbed") return <div className="presentation-embed">HTML 嵌入内容请在编辑模式中交互</div>;
  if (block.type === "tableOfContents") {
    // 演示模式只读：展示目录占位，跳转交互请在编辑模式中使用
    return <div className="presentation-embed">📑 目录（编辑模式中可点击跳转）</div>;
  }
  if (block.type === "breadcrumb") {
    return <div className="presentation-embed">📑 路径栏（编辑模式中显示父级链）</div>;
  }
  return <div>{(block.content || []).map((child, index) => <RenderBlock key={index} block={child} />)}</div>;
}
