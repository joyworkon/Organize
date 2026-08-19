"use client";

import type { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { toast } from "@/hooks/use-toast";

/**
 * 在当前笔记 pos 处插入「行内数据库」块：
 * 1) POST /api/databases 创建数据库（parent_note_id = 当前 noteId）
 * 2) 在编辑器中插入 databaseBlock 带 databaseId
 * 失败时【不写入文档】（避免永久错误段落留在正文里），toast 提示后重试即可。
 */
export async function insertInlineDatabase(editor: Editor, noteId: string | null | undefined, pos?: number): Promise<void> {
  let databaseId = "";
  try {
    const res = await fetch("/api/databases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "未命名数据库",
        parent_note_id: noteId || null,
      }),
    });
    if (res.ok) {
      const data: { id?: string } = await res.json();
      databaseId = data.id || "";
    }
  } catch {
    databaseId = "";
  }

  if (!databaseId) {
    toast({ title: "创建数据库失败，请重试", variant: "destructive" });
    return;
  }

  const block: JSONContent = {
    type: "databaseBlock",
    attrs: { databaseId, viewId: "default_view" },
  };

  insertDbBlock(editor, pos, block);
}

/**
 * 插入「整页数据库」：
 * 1) 客户端生成 databaseId
 * 2) POST /api/notes 创建子笔记（content 为一个 databaseBlock，title = 数据库标题）
 * 3) POST /api/databases 创建数据库（id=databaseId, parent_note_id=新笔记 id）
 * 4) 用一个链接段落替换当前位置块，并跳转到新笔记
 * 失败时【不写入文档】，toast 提示后重试即可。
 */
export async function insertPageDatabase(editor: Editor, noteId: string | null | undefined, pos?: number, router?: { push: (url: string) => void }): Promise<void> {
  const databaseId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `db_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const dbContent: JSONContent = {
    type: "doc",
    content: [
      { type: "databaseBlock", attrs: { databaseId, viewId: "default_view" } },
    ],
  };

  let newNoteId = "";
  try {
    const noteRes = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "未命名数据库",
        content: dbContent,
        parent_note_id: noteId || null,
      }),
    });
    if (!noteRes.ok) throw new Error("create note failed");
    const noteData: { id?: string } = await noteRes.json();
    newNoteId = noteData.id || "";
    if (!newNoteId) throw new Error("note id missing");

    const dbRes = await fetch("/api/databases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: databaseId,
        title: "未命名数据库",
        parent_note_id: newNoteId,
      }),
    });
    if (!dbRes.ok) throw new Error("create database failed");
  } catch {
    toast({ title: "创建整页数据库失败，请重试", variant: "destructive" });
    return;
  }

  // 在原位置插入指向新笔记的链接段落（模仿 convertBlockToPage）
  if (!editor) return;
  const linkBlock: JSONContent = {
    type: "paragraph",
    content: [
      { type: "text", text: "🗄️ " },
      {
        type: "text",
        marks: [{ type: "link", attrs: { href: `/notes/${newNoteId}` } }],
        text: "未命名数据库",
      },
    ],
  };
  insertDbBlock(editor, pos, linkBlock);

  if (router?.push) {
    router.push(`/notes/${newNoteId}`);
  }
}

/**
 * 插入「链接的视图」：
 * 1) GET /api/databases 拉取用户所有数据库
 * 2) 用 prompt 让用户选择
 * 3) 插入 databaseBlock（同一 databaseId，新 viewId）
 */
export async function insertLinkedDatabase(editor: Editor, pos?: number): Promise<void> {
  let databases: { id: string; title: string }[] = [];
  try {
    const res = await fetch("/api/databases");
    if (res.ok) databases = await res.json();
  } catch { /* ignore */ }

  if (!databases.length) {
    toast({ title: "还没有可链接的数据库，请先创建一个数据库" });
    return;
  }

  // 构建选择列表
  const list = databases.map((db, i) => `${i + 1}. ${db.title || "未命名数据库"}`).join("\n");
  const choice = window.prompt(`选择要链接的数据库：\n${list}\n\n输入序号：`);
  if (!choice) return;
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= databases.length) return;

  const selected = databases[idx];
  const viewId = `view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const block: JSONContent = {
    type: "databaseBlock",
    attrs: { databaseId: selected.id, viewId },
  };
  insertDbBlock(editor, pos, block);
}

function insertDbBlock(editor: Editor, pos: number | undefined, block: JSONContent) {
  if (!editor) return;
  const finalBlock = block;
  if (pos === undefined) {
    editor.chain().focus().insertContent(finalBlock).run();
  } else {
    const node = editor.state.doc.nodeAt(pos);
    if (!node) {
      editor.chain().focus().insertContent(finalBlock).run();
      return;
    }
    try {
      editor.view.dispatch(
        editor.state.tr.replaceWith(pos, pos + node.nodeSize, editor.schema.nodeFromJSON(finalBlock)).scrollIntoView()
      );
    } catch {
      editor.chain().focus().insertContent(finalBlock).run();
    }
  }
}
