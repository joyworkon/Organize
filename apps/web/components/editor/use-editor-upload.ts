"use client";

import type { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { useCallback, useRef } from "react";
import type React from "react";
import { toast } from "@/hooks/use-toast";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { replaceAt } from "./block-utils";

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
    (pos?: number, nested?: boolean, range?: { from: number; to: number }) => {
      if (!editor || editor.isDestroyed) return;
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/gif,image/webp,image/svg+xml";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const formData = new FormData();
        formData.append("file", file);
        try {
          const response = await fetch("/api/upload", { method: "POST", body: formData });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "上传失败");
          insertImage(data.url, pos, nested, range);
        } catch {
          const reader = new FileReader();
          reader.onload = () => insertImage(String(reader.result), pos, nested, range);
          reader.readAsDataURL(file);
        }
      };
      input.click();
    },
    [editor, insertImage]
  );

  // 从外部拖入 / 粘贴 / 菜单选择的文件：图片插入图片块，其余作为附件块（视频/音频内联播放）
  const insertFiles = useCallback(
    async (files: File[], pos?: number) => {
      if (!editor || editor.isDestroyed || !files.length) return;
      const nodes: JSONContent[] = [];
      for (const file of files) {
        const isImage = file.type.startsWith("image/");
        try {
          const formData = new FormData();
          formData.append("file", file);
          const response = await fetch("/api/upload", { method: "POST", body: formData });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "上传失败");
          nodes.push(
            isImage
              ? { type: "image", attrs: { src: data.url as string } }
              : {
                  type: "fileAttachment",
                  attrs: {
                    src: data.url as string,
                    name: (data.name as string) || file.name,
                    size: typeof data.size === "number" ? data.size : file.size,
                    mime: (data.mime as string) || file.type,
                  },
                }
          );
        } catch (error) {
          if (isImage) {
            // 上传接口不可用时图片回退为 base64 内联（与 uploadImage 一致）
            const dataUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => resolve("");
              reader.readAsDataURL(file);
            });
            if (dataUrl) nodes.push({ type: "image", attrs: { src: dataUrl } });
          } else {
            console.warn("[editor] 附件上传失败", error);
            toast({
              title: `「${file.name}」上传失败`,
              description: error instanceof Error ? error.message : "请稍后重试",
              variant: "destructive",
            });
          }
        }
      }
      if (!nodes.length || editor.isDestroyed) return;
      if (pos === undefined) {
        editor.chain().focus().insertContent(nodes).run();
        return;
      }
      try {
        editor.chain().focus().insertContentAt(pos, nodes).run();
      } catch {
        // 落点放不下块级内容（如表格单元格内）时追加到文末
        editor.chain().focus("end").insertContent(nodes).run();
      }
    },
    [editor]
  );
  insertFilesRef.current = insertFiles;

  const uploadAttachment = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length) void insertFilesRef.current?.(files);
    };
    input.click();
  }, [editor]);

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
