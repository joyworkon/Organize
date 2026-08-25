// @vitest-environment jsdom
/**
 * 附件管理面板（E8）核心逻辑测试：
 * - collectAttachments：收集全部附件块（含嵌套在 callout 内），空文档返回空；
 * - 删除附件块走编辑器事务，⌘Z（undo）可恢复；
 * - formatFileSize 边界（复用自 file-attachment，面板展示依赖）。
 */
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Callout } from "./extensions/callout";
import { FileAttachment } from "./extensions/file-attachment";
import { formatFileSize } from "./extensions/file-attachment";
import { collectAttachments } from "./note-attachments-panel";

function attachment(src: string, name: string, mime: string, size: number): JSONContent {
  return { type: "fileAttachment", attrs: { src, name, mime, size } };
}

function createEditor(content: JSONContent) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [StarterKit, FileAttachment, Callout],
    content,
  });
}

const DOC: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "周报" }] },
    attachment("/storage/a.mp4", "演示.mp4", "video/mp4", 1024 * 1024 * 3.5),
    { type: "paragraph", content: [{ type: "text", text: "会议录音：" }] },
    attachment("/storage/b.mp3", "录音.mp3", "audio/mpeg", 2048),
    {
      type: "callout",
      attrs: { emoji: "📎", color: "blue" },
      content: [attachment("/storage/c.pdf", "规格.pdf", "application/pdf", 512)],
    },
  ],
};

describe("collectAttachments", () => {
  it("收集全部附件块：顶层与 callout 内的都命中，字段完整", () => {
    const editor = createEditor(DOC);
    const items = collectAttachments(editor.state.doc);
    expect(items.map((item) => item.name)).toEqual(["演示.mp4", "录音.mp3", "规格.pdf"]);
    expect(items[0]).toMatchObject({
      src: "/storage/a.mp4",
      mime: "video/mp4",
      size: 1024 * 1024 * 3.5,
    });
    expect(items[0].pos).toBeGreaterThan(0);
    editor.destroy();
  });

  it("空文档与非附件文档返回空数组", () => {
    const empty = createEditor({ type: "doc", content: [] });
    expect(collectAttachments(empty.state.doc)).toEqual([]);
    empty.destroy();
    const textOnly = createEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "纯文本" }] }],
    });
    expect(collectAttachments(textOnly.state.doc)).toEqual([]);
    textOnly.destroy();
  });

  it("缺省属性容错：name 回退为「附件」，mime/size 为空", () => {
    const editor = createEditor({
      type: "doc",
      content: [{ type: "fileAttachment", attrs: { src: "/storage/x.bin" } }],
    });
    const items = collectAttachments(editor.state.doc);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("附件");
    expect(items[0].mime).toBe("");
    expect(items[0].size).toBeNull();
    editor.destroy();
  });
});

describe("附件删除走编辑器事务（可撤销）", () => {
  it("deleteRange 删除附件块后 undo 恢复，JSON 结构不变", () => {
    const editor = createEditor(DOC);
    const before = editor.state.doc.toJSON();
    const items = collectAttachments(editor.state.doc);
    expect(items).toHaveLength(3);

    const first = items[0];
    const node = editor.state.doc.nodeAt(first.pos)!;
    expect(node.type.name).toBe("fileAttachment");
    editor
      .chain()
      .focus()
      .deleteRange({ from: first.pos, to: first.pos + node.nodeSize })
      .run();
    expect(collectAttachments(editor.state.doc)).toHaveLength(2);

    editor.commands.undo();
    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(collectAttachments(editor.state.doc)).toHaveLength(3);
    editor.destroy();
  });
});

describe("formatFileSize（面板展示复用）", () => {
  it("各量级与非法输入", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(1024 * 1024 * 3.5)).toBe("3.5 MB");
    expect(formatFileSize(0)).toBe("");
    expect(formatFileSize("bad")).toBe("");
    expect(formatFileSize(null)).toBe("");
  });
});
