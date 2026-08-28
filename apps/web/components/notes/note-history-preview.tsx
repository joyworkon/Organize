"use client";

import { useEffect, useState } from "react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import type { JSONContent } from "@tiptap/core";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import Details from "@tiptap/extension-details";
import DetailsContent from "@tiptap/extension-details-content";
import DetailsSummary from "@tiptap/extension-details-summary";
import { TaskItemLinked } from "@/components/editor/extensions/task-item-linked";
import { Callout } from "@/components/editor/extensions/callout";
import { InlineMath, MathBlock } from "@/components/editor/extensions/math";
import { Columns, Column } from "@/components/editor/extensions/columns";
import { BlockStyle } from "@/components/editor/extensions/block-style";
import { ListStyleExtension } from "@/components/editor/extensions/list-style";
import {
  OrganizeTable,
  OrganizeTableRow,
  OrganizeTableCell,
  OrganizeTableHeader,
} from "@/components/editor/extensions/table-style";
import { HtmlEmbed } from "@/components/editor/extensions/html-embed";
import { ResizableImage } from "@/components/editor/extensions/resizable-image";
import { FileAttachment } from "@/components/editor/extensions/file-attachment";
import { TableOfContents } from "@/components/editor/extensions/table-of-contents";
import { Breadcrumb } from "@/components/editor/extensions/breadcrumb";
import { ButtonBlock } from "@/components/editor/extensions/button-node";
import { Tabs, Tab } from "@/components/editor/extensions/tabs-node";
import { Mermaid } from "@/components/editor/extensions/mermaid-node";
import { Embed } from "@/components/editor/extensions/embed";
import { SyncedBlock } from "@/components/editor/extensions/synced-block";
import { DatabaseBlock } from "@/components/editor/extensions/database-block";
import { BLOCK_ID_TYPES } from "@/components/editor/block-utils";

/**
 * 历史版本静态预览：与主编辑器同一套文档结构，但不含交互类扩展
 * （SlashCommand / 拖拽多选 / 内链装饰等），渲染为只读 HTML。
 * UniqueID 保留，使顶层块带 data-id，供 diff 高亮定位。
 */
const previewExtensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
  ListStyleExtension,
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  Underline,
  ResizableImage.configure({ inline: false, allowBase64: true }),
  Link.configure({ openOnClick: false }),
  TaskList,
  TaskItemLinked.configure({ nested: true }),
  OrganizeTable.configure({
    resizable: true,
    allowTableNodeSelection: true,
    lastColumnResizable: true,
    cellMinWidth: 48,
  }),
  OrganizeTableRow,
  OrganizeTableCell,
  OrganizeTableHeader,
  Details.configure({ persist: true }),
  DetailsContent,
  DetailsSummary,
  Callout,
  InlineMath,
  MathBlock,
  Columns,
  Column,
  HtmlEmbed,
  FileAttachment,
  TableOfContents,
  Breadcrumb,
  ButtonBlock,
  Tabs,
  Tab,
  Mermaid,
  Embed,
  SyncedBlock,
  DatabaseBlock,
  BlockStyle,
  UniqueID.configure({ types: BLOCK_ID_TYPES }),
];

/** 顶层块指纹：key = 块 id（无 id 时退回序号），值 = 去掉 id 后的内容 JSON */
function fingerprintBlocks(doc: JSONContent | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  (doc?.content ?? []).forEach((block, index) => {
    const key =
      typeof block.attrs?.id === "string" && block.attrs.id
        ? block.attrs.id
        : `#idx:${index}`;
    const attrs = { ...(block.attrs ?? {}), id: undefined };
    map.set(key, JSON.stringify({ ...block, attrs }));
  });
  return map;
}

/** 版本里与当前内容不同的顶层块 key 集合（用于高亮「这一版改了什么」） */
function diffChangedKeys(
  versionDoc: JSONContent | null | undefined,
  currentDoc: JSONContent | null | undefined
): Set<string> {
  const current = fingerprintBlocks(currentDoc);
  const changed = new Set<string>();
  (versionDoc?.content ?? []).forEach((block, index) => {
    const key =
      typeof block.attrs?.id === "string" && block.attrs.id
        ? block.attrs.id
        : `#idx:${index}`;
    const attrs = { ...(block.attrs ?? {}), id: undefined };
    if (current.get(key) !== JSON.stringify({ ...block, attrs })) {
      changed.add(key);
    }
  });
  return changed;
}

/** 版本内容渲染为 HTML，并把与当前内容不同的顶层块标记 .nv-changed */
function renderVersionHtml(
  versionDoc: JSONContent | null | undefined,
  currentDoc: JSONContent | null | undefined
): string {
  const editor = new Editor({
    extensions: previewExtensions,
    content: versionDoc ?? { type: "doc", content: [{ type: "paragraph" }] },
  });
  let html = editor.getHTML();
  editor.destroy();

  const changed = diffChangedKeys(versionDoc, currentDoc);
  if (changed.size > 0 && typeof DOMParser !== "undefined") {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    Array.from(parsed.body.children).forEach((el, index) => {
      const id = el.getAttribute("data-id");
      if (changed.has(id ?? `#idx:${index}`)) el.classList.add("nv-changed");
    });
    html = parsed.body.innerHTML;
  }
  return html;
}

interface NoteHistoryPreviewProps {
  versionContent: JSONContent | null;
  currentContent: JSONContent | null;
}

export function NoteHistoryPreview({
  versionContent,
  currentContent,
}: NoteHistoryPreviewProps) {
  const [html, setHtml] = useState("");

  useEffect(() => {
    // headless Editor 依赖浏览器环境，放到 effect 中渲染
    setHtml(renderVersionHtml(versionContent, currentContent));
  }, [versionContent, currentContent]);

  return (
    <div
      className="organize-editor prose prose-sm sm:prose max-w-none organize-history-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
