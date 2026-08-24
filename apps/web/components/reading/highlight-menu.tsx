"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Copy, ListTodo, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { HighlightColor } from "@organize/shared";

const HIGHLIGHT_COLORS: { color: HighlightColor; bg: string }[] = [
  { color: "yellow", bg: "bg-yellow-300" },
  { color: "green", bg: "bg-green-300" },
  { color: "blue", bg: "bg-blue-300" },
  { color: "pink", bg: "bg-pink-300" },
  { color: "purple", bg: "bg-purple-300" },
];

interface HighlightMenuProps {
  children: React.ReactNode;
  onCreateHighlight: (
    content: string,
    color: HighlightColor,
    targetType?: "note" | "task"
  ) => Promise<void>;
}

interface MenuPosition {
  x: number;
  y: number;
}

export function HighlightMenu({ children, onCreateHighlight }: HighlightMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [selectedText, setSelectedText] = useState("");

  const hideMenu = useCallback(() => {
    setPosition(null);
    setSelectedText("");
  }, []);

  const updateMenuPosition = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      hideMenu();
      return;
    }

    const text = selection.toString().trim();
    if (text.length < 1) {
      hideMenu();
      return;
    }

    if (containerRef.current && !containerRef.current.contains(selection.anchorNode)) {
      hideMenu();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) {
      hideMenu();
      return;
    }

    setSelectedText(text);
    setPosition({
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  }, [hideMenu]);

  useEffect(() => {
    const handleMouseUp = () => {
      setTimeout(updateMenuPosition, 0);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        hideMenu();
        window.getSelection()?.removeAllRanges();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) {
        return;
      }
      setTimeout(updateMenuPosition, 0);
    };

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        hideMenu();
      }
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [updateMenuPosition, hideMenu]);

  const applyHighlight = useCallback((color: HighlightColor, targetType?: "note" | "task") => {
    if (!selectedText) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);

    try {
      const mark = document.createElement("mark");
      mark.className = `hl-${color}`;
      mark.dataset.highlightColor = color;
      range.surroundContents(mark);
    } catch {
      console.log("surroundContents failed (cross-element selection), will save to DB only");
    }

    void onCreateHighlight(selectedText, color, targetType);

    selection.removeAllRanges();
    hideMenu();
  }, [selectedText, onCreateHighlight, hideMenu]);

  const handleCopy = useCallback(async () => {
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
      toast({ title: "已复制到剪贴板" });
    } catch {
      toast({ title: "复制失败", variant: "destructive" });
    }
    hideMenu();
  }, [selectedText, hideMenu]);

  return (
    <div ref={containerRef}>
      {children}
      {position && (
        <div
          ref={menuRef}
          className="fixed z-50 flex items-center gap-1 rounded-lg border bg-popover p-1.5 shadow-lg"
          style={{
            left: `${position.x}px`,
            top: `${position.y}px`,
            transform: "translate(-50%, -100%)",
          }}
        >
          {HIGHLIGHT_COLORS.map(({ color, bg }) => (
            <button
              key={color}
              onClick={() => applyHighlight(color)}
              className={cn(
                "h-6 w-6 rounded-full border border-border transition-transform hover:scale-110",
                bg
              )}
              title={`${color}高亮`}
            />
          ))}
          <div className="mx-1 h-5 w-px bg-border" />
          <button
            onClick={() => applyHighlight("yellow", "note")}
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors"
            title="转为笔记"
          >
            <StickyNote className="h-4 w-4 text-muted-foreground" />
          </button>
          <button
            onClick={() => applyHighlight("yellow", "task")}
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors"
            title="转为任务"
          >
            <ListTodo className="h-4 w-4 text-muted-foreground" />
          </button>
          <button
            onClick={handleCopy}
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors"
            title="复制"
          >
            <Copy className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      )}
    </div>
  );
}
