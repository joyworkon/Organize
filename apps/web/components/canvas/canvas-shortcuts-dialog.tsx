"use client";

import { useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { canvasShortcutLabels } from "./canvas-shortcuts";

export function CanvasShortcutsDialog({ open, onOpenChange, labels }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labels: ReturnType<typeof canvasShortcutLabels>;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const { mod, shift } = labels;
  const shortcuts = [
    ["撤销", `${mod}Z`],
    ["重做", `${shift}${mod}Z`],
    ["全选画布模块", `${mod}A`],
    ["复制选中模块 / 区块", `${mod}D`],
    ["删除选中对象", "Delete / Backspace"],
    ["取消选择 / 退出编辑或预览", "Esc"],
    ["微移版面 / 自由容器（操作柄聚焦时）", "↑ ↓ ← →"],
    ["加大微移步长", `${shift}↑ ↓ ← →`],
    ["拖拽平移", "Space + 拖拽"],
    ["围绕指针缩放", `${mod}滚轮`],
    ["围绕中心放大", `${mod}= / ${mod}+`],
    ["围绕中心缩小", `${mod}-`],
    ["回到 100%", `${mod}0`],
    ["适合全部", `${shift}1`],
    ["打开键盘快捷键", "?"],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement | null; }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle>键盘快捷键</DialogTitle>
          <DialogDescription>画布输入框内保留文字编辑快捷键；只读或预览时可全选、缩放和查看本面板。</DialogDescription>
        </DialogHeader>
        <dl className="space-y-2">
          {shortcuts.map(([description, keys]) => (
            <div key={description} className="flex items-center justify-between gap-4">
              <dt className="text-sm text-muted-foreground">{description}</dt>
              <dd className="shrink-0"><kbd className="rounded border bg-muted px-2 py-1 font-mono text-xs">{keys}</kbd></dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
