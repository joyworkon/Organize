"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BLOCK_COMMANDS } from "./block-commands";
import { BACKGROUNDS, TEXT_COLORS, TEXT_TRANSFORMABLE_TYPES } from "./block-action-options";
import { colorSelectedBlocks, contiguousBlockGroup, deleteSelectedBlocksWithConfirmation, moveSelectedBlocks, selectedBlocks, transformSelectedBlocks, wrapSelectedBlocks } from "./block-multi-select-actions";
import { duplicateBlocksAtPositions } from "./block-shortcuts";
import { getMultiSelectedBlocks, setMultiSelectedBlocks } from "./extensions/block-multi-select";

export function BlockMultiSelectBar({ editor, count }: { editor: Editor; count: number }) {
  const [panel, setPanel] = useState<"transform" | "color" | "wrap" | null>(null);
  const [feedback, setFeedback] = useState("");
  const [, refresh] = useState(0);
  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    editor.on("transaction", update);
    editor.on("update", update);
    return () => { editor.off("transaction", update); editor.off("update", update); };
  }, [editor]);
  const positions = getMultiSelectedBlocks(editor);
  const group = contiguousBlockGroup(editor.state.doc, positions);
  const canEdit = editor.isEditable;
  const canTransform = selectedBlocks(editor.state.doc, positions).some(({ node }) => TEXT_TRANSFORMABLE_TYPES.has(node.type.name));
  const moveTitle = group ? undefined : "请选择连续的块再移动";
  const finish = (action: () => unknown) => { setFeedback(""); action(); setPanel(null); };
  const popover = (kind: "transform" | "color" | "wrap", label: string, disabled: boolean, children: React.ReactNode, title?: string) => (
    <Popover open={panel === kind} onOpenChange={(open) => setPanel(open ? kind : null)}>
      <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" aria-label={label} disabled={disabled} title={title}>{label}</Button></PopoverTrigger>
      <PopoverContent align="start" className="max-h-[min(60vh,28rem)] w-64 overflow-y-auto p-1" aria-label={`${label}选项`} onCloseAutoFocus={(event) => { if (editor.view.hasFocus()) event.preventDefault(); }} onMouseDown={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.stopPropagation()}>
        {children}
      </PopoverContent>
    </Popover>
  );
  return (
    <div className="sticky top-2 z-30 h-0">
      <div role="group" aria-label="多选块操作" className="block-multi-select-bar mx-auto flex w-max max-w-full items-center gap-1 overflow-x-auto rounded-md border bg-background/95 p-1 shadow-sm" onMouseDown={(event) => event.preventDefault()}>
        <span className="shrink-0 whitespace-nowrap px-2 text-xs text-muted-foreground" role="status">已选 {count} 个块</span>
        {popover("transform", "转换成", !canEdit || !canTransform, BLOCK_COMMANDS.filter((command) => command.canTransform).map((command) => (
          <Button key={command.id} type="button" variant="ghost" size="sm" className="h-auto w-full justify-start gap-2 px-2 py-1 font-normal" disabled={!canEdit || command.id === "page"} title={command.id === "page" ? "页面需要逐块转换" : undefined} onClick={() => {
            const result = transformSelectedBlocks(editor, command.id);
            setFeedback(result.skipped ? `已跳过 ${result.skipped} 个结构化块` : ""); setPanel(null);
          }}><command.icon className="h-4 w-4" />{command.label}</Button>
        )))}
        {popover("color", "颜色", !canEdit, <>
          {([{ kind: "text", label: "文字颜色", colors: TEXT_COLORS }, { kind: "background", label: "背景颜色", colors: BACKGROUNDS }] as const).map(({ kind, label, colors }) => (
            <div key={kind} role="group" aria-label={label} className="p-2">
              <p className="mb-1 text-xs text-muted-foreground">{label}</p>
              <div className="grid grid-cols-5 gap-1">{colors.map((color) => (
                <Button key={color.label} type="button" variant="ghost" size="sm" className="px-1" title={`${label}：${color.label}`} aria-label={`${label}：${color.label}`} disabled={!canEdit} onClick={() => finish(() => colorSelectedBlocks(editor, kind, color.value))}>
                  <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded border" style={kind === "text" ? { color: color.value ?? undefined } : { backgroundColor: color.value ?? undefined }}>A</span>
                </Button>
              ))}</div>
            </div>
          ))}
        </>)}
        <Button type="button" variant="ghost" size="sm" aria-label="上移多选块" title={moveTitle ?? "整组上移"} disabled={!canEdit || !group || group.index === 0} onClick={() => finish(() => moveSelectedBlocks(editor, -1))}>上移</Button>
        <Button type="button" variant="ghost" size="sm" aria-label="下移多选块" title={moveTitle ?? "整组下移"} disabled={!canEdit || !group || group.index + group.blocks.length === group.parent.childCount} onClick={() => finish(() => moveSelectedBlocks(editor, 1))}>下移</Button>
        {popover("wrap", "包裹", !canEdit || group?.depth !== 0, <>
          <Button type="button" variant="ghost" size="sm" className="w-full justify-start font-normal" disabled={!canEdit} onClick={() => finish(() => wrapSelectedBlocks(editor, "callout"))}>标注</Button>
          <Button type="button" variant="ghost" size="sm" className="w-full justify-start font-normal" disabled={!canEdit} onClick={() => finish(() => wrapSelectedBlocks(editor, "details"))}>折叠</Button>
        </>, group?.depth === 0 ? "将所选块包裹为容器" : "请选择连续的顶层块再包裹")}
        <Button type="button" variant="ghost" size="sm" aria-label="创建多选块副本" title="创建副本（⌘D / Ctrl+D）" disabled={!canEdit} onClick={() => finish(() => duplicateBlocksAtPositions(editor, getMultiSelectedBlocks(editor)))}>创建副本</Button>
        <Button type="button" variant="ghost" size="sm" aria-label="删除多选块" title="删除（Del / Backspace）" disabled={!canEdit} onClick={() => { void deleteSelectedBlocksWithConfirmation(editor); }}>删除</Button>
        <Button type="button" variant="ghost" size="sm" aria-label="取消块多选" title="取消（Esc）" onClick={() => { setMultiSelectedBlocks(editor, []); editor.view.focus(); }}>取消</Button>
        {feedback && <span role="status" className="px-2 text-xs text-muted-foreground">{feedback}</span>}
      </div>
    </div>
  );
}
