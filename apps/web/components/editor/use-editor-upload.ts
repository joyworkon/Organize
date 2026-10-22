"use client";

import type { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { useCallback, useRef } from "react";
import type React from "react";
import { toast } from "@/hooks/use-toast";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { replaceAt } from "./block-utils";

interface AttachmentDestination {
  replace: boolean;
  range?: { from: number; to: number };
}

/** Shared upload contract: images retain the existing inline fallback; files fail without creating a block. */
export async function uploadEditorFile(file: File): Promise<JSONContent | null> {
  const isImage = file.type.startsWith("image/");
  try {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok || typeof data.url !== "string" || !data.url) throw new Error(data.error || "上传失败");
    return isImage ? { type: "image", attrs: { src: data.url } } : {
      type: "fileAttachment",
      attrs: { src: data.url, name: data.name || file.name, size: typeof data.size === "number" ? data.size : file.size, mime: data.mime || file.type },
    };
  } catch (error) {
    if (isImage) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => resolve("");
        reader.readAsDataURL(file);
      });
      if (dataUrl) return { type: "image", attrs: { src: dataUrl } };
    }
    toast({ title: `「${file.name}」上传失败`, description: error instanceof Error ? error.message : "请稍后重试", variant: "destructive" });
    return null;
  }
}

/** Slash uses an empty paragraph/range; drag and paste retain their existing point insertion. */
export function insertUploadedFiles(editor: Editor, nodes: JSONContent[], pos?: number, destination?: AttachmentDestination) {
  if (editor.isDestroyed || !editor.isEditable || !nodes.length) return;
  if (pos === undefined) { editor.chain().focus().insertContent(nodes).run(); return; }
  try {
    const node = editor.state.doc.nodeAt(pos);
    const at = destination?.replace && node?.type.name === "paragraph" && !node.content.size
      ? { from: pos, to: pos + node.nodeSize }
      : destination?.range ?? pos;
    if (editor.chain().focus().insertContentAt(at, nodes).run()) return;
  } catch { /* Match the existing invalid block destination fallback. */ }
  editor.chain().focus("end").insertContent(nodes).run();
}

/**
 * 编辑器上传与插入（R09 自 tiptap-editor 抽离）：
 * - uploadImage：文件选择 → 上传 → 插入；上传接口失败回退 base64 内联（既有策略）
 * - insertFiles：拖入/粘贴/多选文件——图片为图片块，其余为附件块
 * - uploadAttachment / addImageUrl：菜单入口
 * - 插入前的 isDestroyed 守卫（R09 验收）：文件选择到上传完成期间编辑器已销毁
 *   （切页/关页）时不再插入，绝不会把内容插到「别的文档」——每个编辑器实例
 *   只属于一个笔记文档，销毁即放弃插入。
 * 取消语义保持：文件选择框取消不触发 onchange，静默返回。
 */
export function useEditorUpload(editor: Editor | null) {
  // editorProps 在编辑器初始化时定型，通过 ref 拿到最新的回调（与原实现一致）
  const insertFilesRef = useRef<(files: File[], pos?: number) => Promise<void>>();

  const insertImage = useCallback(
    (url: string, pos?: number, nested?: boolean, range?: { from: number; to: number }) => {
      if (!editor || editor.isDestroyed) return;
      if (nested && range) {
        editor.chain().focus().deleteRange(range).insertContent({ type: "image", attrs: { src: url } }).run();
      } else if (pos === undefined) {
        editor.chain().focus().setImage({ src: url }).run();
      } else {
        replaceAt(editor, pos, { type: "image", attrs: { src: url } });
      }
    },
    [editor]
  );

  const uploadImage = useCallback(
    (pos?: number, nested?: boolean, range?: { from: number; to: number }, onUploaded?: (src: string) => void) => {
      if (!editor || editor.isDestroyed) return;
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/gif,image/webp,image/svg+xml";
      const deliver = (src: string) => {
        if (editor.isDestroyed) return;
        if (onUploaded) {
          if (editor.isEditable) onUploaded(src);
        } else insertImage(src, pos, nested, range);
      };
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const formData = new FormData();
        formData.append("file", file);
        try {
          const response = await fetch("/api/upload", { method: "POST", body: formData });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "上传失败");
          deliver(data.url);
        } catch {
          const reader = new FileReader();
          reader.onload = () => deliver(String(reader.result));
          reader.readAsDataURL(file);
        }
      };
      input.click();
    },
    [editor, insertImage]
  );

  // 从外部拖入 / 粘贴 / 菜单选择的文件：图片插入图片块，其余作为附件块（视频/音频内联播放）
  const insertFiles = useCallback(
    async (files: File[], pos?: number, destination?: AttachmentDestination) => {
      if (!editor || editor.isDestroyed || !editor.isEditable || !files.length) return;
      const nodes: JSONContent[] = [];
      for (const file of files) {
        const node = await uploadEditorFile(file);
        if (node) nodes.push(node);
      }
      if (!nodes.length || editor.isDestroyed || !editor.isEditable) return;
      insertUploadedFiles(editor, nodes, pos, destination);
    },
    [editor]
  );
  insertFilesRef.current = insertFiles;

  const uploadAttachment = useCallback((pos?: number, nested?: boolean, range?: { from: number; to: number }, onUploaded?: (node: JSONContent) => void) => {
    if (!editor || editor.isDestroyed || !editor.isEditable) return;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = !onUploaded;
    const destination = pos === undefined ? undefined : { replace: !nested, range };
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (!files.length || editor.isDestroyed || !editor.isEditable) return;
      if (onUploaded) {
        const node = await uploadEditorFile(files[0]);
        if (node && !editor.isDestroyed && editor.isEditable) onUploaded(node);
      } else {
        await insertFiles(files, pos, destination);
      }
    };
    input.click();
  }, [editor, insertFiles]);

  const addImageUrl = useCallback(() => {
    void showPrompt({ title: "输入图片 URL", placeholder: "https://" }).then((url) => {
      if (url) insertImage(url);
    });
  }, [insertImage]);

  return {
    insertImage,
    uploadImage,
    insertFiles,
    /** editorProps 定型时经 ref 取最新 insertFiles（与原实现一致） */
    insertFilesRef: insertFilesRef as React.MutableRefObject<(files: File[], pos?: number) => Promise<void>>,
    uploadAttachment,
    addImageUrl,
  };
}
