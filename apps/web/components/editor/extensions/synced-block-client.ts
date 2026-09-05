"use client";

import type { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";

/**
 * 创建同步区块：先 POST 服务端拿到 id，再在编辑器插入带 syncedId 的块。
 * 供菜单命令调用。失败时回退为普通段落容器（不阻塞用户）。
 */
export async function createSyncedBlockAt(editor: Editor, pos?: number): Promise<void> {
  let syncedId = "";
  try {
    const res = await fetch("/api/synced-blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: [{ type: "paragraph" }] }),
    });
    // 401/500 等都不进入成功分支；失败回退为普通段落容器（不阻塞用户）
    if (!res.ok) throw new Error(`创建同步区块失败（${res.status}）`);
    const data: unknown = await res.json();
    const id =
      !!data && typeof data === "object" ? (data as { id?: unknown }).id : undefined;
    if (typeof id !== "string" || !id) throw new Error("创建同步区块响应缺少 id");
    syncedId = id;
  } catch {
    syncedId = "";
  }

  const block: JSONContent = {
    type: "syncedBlock",
    attrs: { syncedId, hydrated: true },
    content: [{ type: "paragraph" }],
  };

  if (!editor) return;
  if (pos === undefined) {
    editor.chain().focus().insertContent(block).run();
  } else {
    // 替换 pos 处的块（菜单从空行触发时）
    const node = editor.state.doc.nodeAt(pos);
    if (!node) {
      editor.chain().focus().insertContent(block).run();
      return;
    }
    editor.view.dispatch(
      editor.state.tr.replaceWith(pos, pos + node.nodeSize, editor.schema.nodeFromJSON(block)).scrollIntoView()
    );
  }
}
