// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { SyncedBlock } from "./synced-block";

const testSyncedId = "11111111-1111-4111-8111-111111111111";

function createEditor(content: any) {
  return new Editor({
    extensions: [StarterKit, SyncedBlock],
    content,
  });
}

describe("SyncedBlock 扩展", () => {
  it("insertSyncedBlock 命令插入一个含空段落的同步块（syncedId 初始为空、hydrated=true）", () => {
    const editor = createEditor({ type: "doc", content: [{ type: "paragraph" }] });
    const ok = editor.chain().focus().insertSyncedBlock().run();
    expect(ok).toBe(true);
    const json = editor.getJSON();
    const synced = json.content?.find((n) => n.type === "syncedBlock");
    expect(synced).toBeDefined();
    expect(synced?.attrs?.syncedId).toBe("");
    expect(synced?.attrs?.hydrated).toBe(true);
    expect(Array.isArray(synced?.content)).toBe(true);
    expect(synced?.content?.[0]?.type).toBe("paragraph");
    editor.destroy();
  });

  it("attrs 中 syncedId 持久化到 HTML 的 data-synced-id 并能解析回来", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "syncedBlock",
          attrs: { syncedId: testSyncedId, hydrated: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
        },
      ],
    });
    const html = editor.getHTML();
    expect(html).toContain("data-synced-block");
    expect(html).toContain(`data-synced-id="${testSyncedId}"`);

    // 从 HTML 再解析回来，syncedId 要保留；hydrated 在 parseHTML 时会重置为 false（符合预期，因为 HTML 持久化不带 hydrated）
    const parsed = createEditor(html);
    const parsedJson = parsed.getJSON();
    const synced = parsedJson.content?.find((n) => n.type === "syncedBlock");
    expect(synced?.attrs?.syncedId).toBe(testSyncedId);
    expect(synced?.attrs?.hydrated).toBe(false);
    editor.destroy();
    parsed.destroy();
  });

  it("syncedId 为空时不渲染 data-synced-id 属性（避免空属性）", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "syncedBlock",
          attrs: { syncedId: "", hydrated: true },
          content: [{ type: "paragraph" }],
        },
      ],
    });
    const html = editor.getHTML();
    expect(html).toContain("data-synced-block");
    expect(html).not.toContain("data-synced-id");
    editor.destroy();
  });

  it("同步块作为 block+group 容器，可以在内部放段落/标题等块级节点", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "syncedBlock",
          attrs: { syncedId: testSyncedId, hydrated: true },
          content: [
            { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "H2" }] },
            { type: "paragraph", content: [{ type: "text", text: "p" }] },
          ],
        },
      ],
    });
    const json = editor.getJSON();
    const synced = json.content?.[0];
    expect(synced?.type).toBe("syncedBlock");
    expect(synced?.content?.map((c: any) => c.type)).toEqual(["heading", "paragraph"]);
    editor.destroy();
  });

  it("解析 HTML 时 hydrated 默认重置为 false（未注水），保证打开页面会从服务端拉最新内容", () => {
    const html = `<div data-synced-block data-synced-id="${testSyncedId}"><p>已存在内容</p></div>`;
    const parsed = createEditor(html);
    const synced = parsed.getJSON().content?.find((n) => n.type === "syncedBlock");
    expect(synced?.attrs?.syncedId).toBe(testSyncedId);
    expect(synced?.attrs?.hydrated).toBe(false);
    parsed.destroy();
  });
});
