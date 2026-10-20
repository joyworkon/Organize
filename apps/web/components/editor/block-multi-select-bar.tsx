"use client";

import type { Editor } from "@tiptap/core";
import { Button } from "@/components/ui/button";
import { duplicateBlocksAtPositions } from "./block-shortcuts";
import { deleteMultiSelectedBlocks, getMultiSelectedBlocks, setMultiSelectedBlocks } from "./extensions/block-multi-select";

export function BlockMultiSelectBar({ editor, count }: { editor: Editor; count: number }) {
  return (
    <div
      role="group"
      aria-label="多选块操作"
      className="block-multi-select-bar sticky top-2 z-30 mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm"
      onMouseDown={(event) => event.preventDefault()}
    >
      <span className="px-2 text-xs text-muted-foreground" role="status">已选 {count} 个块</span>
      <Button type="button" variant="ghost" size="sm" aria-label="创建多选块副本" title="创建副本（⌘D / Ctrl+D）" disabled={!editor.isEditable} onClick={() => duplicateBlocksAtPositions(editor, getMultiSelectedBlocks(editor))}>创建副本</Button>
      <Button type="button" variant="ghost" size="sm" aria-label="删除多选块" title="删除（Del / Backspace）" disabled={!editor.isEditable} onClick={() => deleteMultiSelectedBlocks(editor)}>删除</Button>
      <Button type="button" variant="ghost" size="sm" aria-label="取消块多选" title="取消（Esc）" onClick={() => {
        setMultiSelectedBlocks(editor, []);
        editor.view.focus();
      }}>取消</Button>
    </div>
  );
}
