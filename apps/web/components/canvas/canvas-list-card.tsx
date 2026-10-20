"use client";

import type { CanvasListItem } from "@/lib/canvas/repository";
import { MoreHorizontal, Copy, Trash2, Pencil, ExternalLink } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { CanvasListThumbnail } from "./canvas-list-thumbnail";

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function CanvasListCard({ item, busy, onOpen, onRename, onDuplicate, onRemove }: {
  item: CanvasListItem;
  busy: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const title = item.title || "未命名画布";
  return (
    <li className="canvas-list-card">
      <button type="button" className="canvas-list-open focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={onOpen} title="打开画布">
        <CanvasListThumbnail summary={item.summary} />
        <span className="canvas-list-info">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{item.summary ? `${item.summary.pages} 个版面 · 约 ${item.summary.blocks} 个块` : "内容摘要暂不可用"}</span>
          <span className="block truncate text-xs text-muted-foreground">{item.summary?.excerpt || (!item.summary ? "打开画布查看内容" : item.summary.blocks ? "暂无文字摘要" : "从空白开始，记录灵感")}</span>
          <span className="block text-xs text-muted-foreground">修改于 {timeLabel(item.updated_at)}</span>
        </span>
      </button>
      <div className="canvas-list-menu">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label={`画布操作：${title}`} disabled={busy}><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onOpen}><ExternalLink className="mr-2 h-4 w-4" />打开</DropdownMenuItem>
            <DropdownMenuItem onSelect={onRename}><Pencil className="mr-2 h-4 w-4" />重命名</DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}><Copy className="mr-2 h-4 w-4" />创建副本</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRemove} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />移入垃圾箱</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
