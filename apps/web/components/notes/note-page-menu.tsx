"use client";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  MoreHorizontal,
  Link2,
  Copy,
  CopyPlus,
  Maximize2,
  Type,
} from "lucide-react";

/** 笔记页字体族选项 */
export type NoteFont = "default" | "serif" | "mono";

interface NotePageMenuProps {
  fullWidth: boolean;
  onToggleFullWidth: () => void;
  font: NoteFont;
  onFontChange: (font: NoteFont) => void;
  smallFont: boolean;
  onToggleSmallFont: () => void;
  onCopyLink: () => void;
  onCopyContent: () => void;
  onDuplicate: () => void;
}

const FONT_OPTIONS: { value: NoteFont; label: string }[] = [
  { value: "default", label: "默认" },
  { value: "serif", label: "衬线体" },
  { value: "mono", label: "等宽体" },
];

export function NotePageMenu({
  fullWidth,
  onToggleFullWidth,
  font,
  onFontChange,
  smallFont,
  onToggleSmallFont,
  onCopyLink,
  onCopyContent,
  onDuplicate,
}: NotePageMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="更多">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* 字体族：三选一，选中项打勾 */}
        <DropdownMenuLabel className="flex items-center gap-1.5 text-muted-foreground">
          <Type className="h-3.5 w-3.5" />
          字体
        </DropdownMenuLabel>
        {FONT_OPTIONS.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={font === opt.value}
            onCheckedChange={() => onFontChange(opt.value)}
            onSelect={(e) => e.preventDefault()}
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}

        <DropdownMenuSeparator />

        {/* 展示开关 */}
        <DropdownMenuCheckboxItem
          checked={smallFont}
          onCheckedChange={onToggleSmallFont}
          onSelect={(e) => e.preventDefault()}
        >
          小字号
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={fullWidth}
          onCheckedChange={onToggleFullWidth}
          onSelect={(e) => e.preventDefault()}
        >
          <span className="flex items-center gap-2">
            <Maximize2 className="h-3.5 w-3.5" />
            全宽
          </span>
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />

        {/* 操作 */}
        <DropdownMenuItem onSelect={onCopyLink}>
          <Link2 className="mr-2 h-4 w-4" />
          拷贝链接
          <DropdownMenuShortcut>⌘L</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopyContent}>
          <Copy className="mr-2 h-4 w-4" />
          拷贝页面内容
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicate}>
          <CopyPlus className="mr-2 h-4 w-4" />
          创建副本
          <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
