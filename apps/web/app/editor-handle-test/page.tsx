"use client";

import { useState } from "react";
import { TipTapEditor } from "@/components/editor/tiptap-editor";

const INITIAL_CONTENT: Record<string, unknown> = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "第一行普通段落，用来测试转换成各种列表。" }] },
    { type: "paragraph", content: [{ type: "text", text: "第二行普通段落。" }] },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "项目符号列表 第一项" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "项目符号列表 第二项" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "项目符号列表 第三项" }] }] },
      ],
    },
    {
      type: "orderedList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "编号列表 第一项" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "编号列表 第二项" }] }] },
      ],
    },
    {
      type: "taskList",
      content: [
        { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "待办事项 一" }] }] },
        { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "待办事项 二（已完成）" }] }] },
      ],
    },
    {
      type: "details",
      content: [
        { type: "detailsSummary", content: [{ type: "text", text: "折叠列表摘要行" }] },
        { type: "detailsContent", content: [{ type: "paragraph", content: [{ type: "text", text: "折叠列表内容" }] }] },
      ],
    },
    ...Array.from({ length: 30 }, (_, i) => ({
      type: "paragraph",
      content: [{ type: "text", text: `填充段落 ${i + 1}：让页面足够长，测试菜单滚动与定位。` }],
    })),
  ],
};

export default function EditorHandleTestPage() {
  const [content, setContent] = useState(INITIAL_CONTENT);
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px 240px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>编辑器手柄回归测试页</h1>
      <TipTapEditor
        noteId="handle-test"
        content={content}
        onUpdate={setContent}
        onEditorReady={(editor) => {
          (window as unknown as { __editor: unknown }).__editor = editor;
        }}
      />
    </div>
  );
}
