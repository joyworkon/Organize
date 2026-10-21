// @vitest-environment jsdom
/**
 * 标注块序列化兼容合同：
 * - 旧文档（emoji 非空、无 tone）的渲染语义与升级前一致（不出现 data-tone；旧版
 *   会被 TipTap 默认行为带出的无主属性 emoji="…" 继续保留以维持字节兼容）；
 * - tone 仅在非 default 时写入 data-tone；emoji 空串 = 无图标（不渲染图标 span）；
 * - 解析回来的非法 tone 归一到 default。
 * tone 缺省为 undefined（UI 视作 default），序列化 JSON 不新增键。
 */
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { Callout } from "./callout";
import { tiptapJsonToHtml } from "@/lib/export/tiptap-to-html";
import { tiptapJsonToMarkdown } from "@/lib/export/tiptap-to-md";

const OLD_CALLOUT_HTML =
  '<div data-callout="" data-emoji="💡"><span class="callout-emoji" contenteditable="false">💡</span><div class="callout-content"><p>提示内容</p></div></div>';

function editorWith(html: string) {
  const editor = new Editor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }), Callout],
    content: html,
  });
  return editor;
}

describe("Callout 序列化", () => {
  it("旧 JSON 序列化不新增 tone；协作同步保留自定义色调且可恢复默认", () => {
    const source = new Y.Doc();
    const replica = new Y.Doc();
    const collabEditor = (document: Y.Doc) => new Editor({
      extensions: [StarterKit.configure({ history: false }), Callout, Collaboration.configure({ document })],
    });
    const editor = collabEditor(source);
    const oldContent = { type: "doc", content: [{ type: "callout", attrs: { emoji: "💡" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }],
    }] };
    editor.commands.setContent(oldContent);
    expect(JSON.stringify(editor.getJSON())).toBe(JSON.stringify(oldContent));
    editor.commands.setTextSelection(2);
    editor.commands.updateAttributes("callout", { tone: "success" });
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(source));
    const other = collabEditor(replica);
    expect(other.getJSON().content?.[0].attrs).toMatchObject({ emoji: "💡", tone: "success" });
    editor.commands.updateAttributes("callout", { tone: undefined });
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(source));
    expect(JSON.stringify(other.getJSON())).toBe(JSON.stringify(oldContent));
    other.destroy(); editor.destroy(); replica.destroy(); source.destroy();
  });

  it("导出保持旧格式，并支持色调与无图标而不回填默认图标", () => {
    const doc = (attrs: Record<string, unknown>) => ({ type: "doc", content: [
      { type: "callout", attrs, content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] },
    ] });
    expect(tiptapJsonToHtml(doc({ emoji: "💡" }))).toBe(
      '<blockquote class="callout" data-emoji="💡"><p>💡</p><p>正文</p></blockquote>'
    );
    expect(tiptapJsonToHtml(doc({ emoji: "", tone: "warning" }))).toBe(
      '<blockquote class="callout" data-emoji="" data-tone="warning"><p>正文</p></blockquote>'
    );
    expect(tiptapJsonToMarkdown(doc({ emoji: "" }))).toBe("> 正文");
    expect(tiptapJsonToHtml(doc({ emoji: "<script>", tone: "invalid" }))).not.toContain("<script>");
    expect(tiptapJsonToHtml(doc({ emoji: "💡", tone: "invalid" }))).not.toContain("data-tone");
  });

  it("旧文档 HTML 输出与升级前语义一致", () => {
    const editor = editorWith(OLD_CALLOUT_HTML);
    expect(editor.getHTML()).toBe(
      '<div emoji="💡" data-callout="" data-emoji="💡"><span class="callout-emoji" contenteditable="false">💡</span><div class="callout-content"><p>提示内容</p></div></div>'
    );
    editor.destroy();
  });

  it("旧文档 JSON（无 tone 键）解析后渲染不变、不写 data-tone", () => {
    const editor = new Editor({
      extensions: [StarterKit, Callout],
      content: {
        type: "doc",
        content: [
          {
            type: "callout",
            attrs: { emoji: "⚠️" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }],
          },
        ],
      },
    });
    expect(editor.getHTML()).toBe(
      '<div emoji="⚠️" data-callout="" data-emoji="⚠️"><span class="callout-emoji" contenteditable="false">⚠️</span><div class="callout-content"><p>正文</p></div></div>'
    );
    expect(JSON.parse(JSON.stringify(editor.getJSON())).content[0].attrs).toEqual({ emoji: "⚠️" });
    editor.destroy();
  });

  it("非 default tone 输出 data-tone 且可解析回来", () => {
    const editor = new Editor({
      extensions: [StarterKit, Callout],
      content: {
        type: "doc",
        content: [
          {
            type: "callout",
            attrs: { emoji: "⚠️", tone: "warning" },
            content: [{ type: "paragraph" }],
          },
        ],
      },
    });
    const html = editor.getHTML();
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('data-emoji="⚠️"');
    // HTML → 新编辑器 round-trip：tone 与 emoji 都保留
    const roundTrip = editorWith(html);
    expect(roundTrip.getJSON().content?.[0].attrs).toEqual({ emoji: "⚠️", tone: "warning" });
    roundTrip.destroy();
    editor.destroy();
  });

  it("emoji 空串 = 无图标：HTML 保留 data-emoji=\"\" 且不渲染图标 span", () => {
    const editor = new Editor({
      extensions: [StarterKit, Callout],
      content: {
        type: "doc",
        content: [
          {
            type: "callout",
            attrs: { emoji: "" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "无图标" }] }],
          },
        ],
      },
    });
    const html = editor.getHTML();
    expect(html).toBe('<div emoji="" data-callout="" data-emoji=""><div class="callout-content"><p>无图标</p></div></div>');
    // round-trip：空 emoji 不被默认值吞掉
    const roundTrip = editorWith(html);
    expect(roundTrip.getJSON().content?.[0].attrs?.emoji).toBe("");
    roundTrip.destroy();
    editor.destroy();
  });

  it("HTML 缺失 data-emoji 时回默认图标（旧行为不变）；非法 tone 归一 default", () => {
    const editor = editorWith(
      '<div data-callout="" data-tone="neon"><div class="callout-content"><p>x</p></div></div>'
    );
    const json = editor.getJSON().content?.[0];
    expect(json?.attrs?.emoji).toBe("💡");
    expect(json?.attrs?.tone).toBeUndefined();
    expect(editor.getHTML()).not.toContain("data-tone");
    editor.destroy();
  });
});
