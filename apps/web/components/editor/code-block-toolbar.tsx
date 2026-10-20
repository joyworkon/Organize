"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Copy } from "@/components/icons";
import { PLAIN_LANGUAGE_LABEL, codeBlockLanguageLabel, codeBlockLanguageOptions } from "@/lib/editor/code-block-language";

/**
 * 代码块选中 / 聚焦时的浮动工具栏（语言 / 自动换行 / 复制）。
 * 与图片工具栏同一套做法：portal 到 body、fixed 定位到块上方、跟随滚动与尺寸变化；
 * 容器 mousedown 阻止默认行为，点按钮不会让编辑器失焦。只读只保留「复制」。
 */
export function CodeBlockToolbar({ anchor, editable, language, wrap, onLanguageChange, onWrapChange, onCopy, onInteractionStart, onInteractionEnd }: {
  anchor: RefObject<HTMLElement>;
  editable: boolean;
  language: string | null;
  wrap: boolean;
  onLanguageChange: (language: string | null) => void;
  onWrapChange: (wrap: boolean) => void;
  onCopy: () => void;
  /** 语言菜单打开：调用方据此在编辑器失焦期间保持工具栏可见 */
  onInteractionStart: () => void;
  /** 语言菜单关闭并完成焦点处理；refocusEditor 为 true 表示用户选了语言，应把焦点还给编辑器 */
  onInteractionEnd: (refocusEditor: boolean) => void;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [visible, setVisible] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Picking a language or pressing Escape hands focus back to the editor; clicking elsewhere must not steal it back.
  const refocusOnClose = useRef(false);
  useLayoutEffect(() => {
    const element = toolbar.current, block = anchor.current;
    if (!element || !block) return;
    const update = () => {
      const rect = block.getBoundingClientRect(), bar = element.getBoundingClientRect();
      setVisible(rect.bottom > 0 && rect.top < window.innerHeight);
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - bar.width - 8)),
        top: Math.max(8, Math.min(rect.top - bar.height - 8, window.innerHeight - bar.height - 8)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(block); observer.observe(element);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [anchor]);
  return createPortal(<div ref={toolbar} className="organize-code-block-toolbar" role="group" aria-label="代码块工具栏"
    style={{ ...position, visibility: visible ? "visible" : "hidden" }}
    onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    {editable && <>
      <DropdownMenu open={menuOpen} onOpenChange={(open) => { setMenuOpen(open); if (open) { refocusOnClose.current = false; onInteractionStart(); } }}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="代码语言" title="代码语言">
            <span className="organize-code-block-language">{codeBlockLanguageLabel(language)}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="organize-code-block-menu" align="start"
          onEscapeKeyDown={() => { refocusOnClose.current = true; }}
          onCloseAutoFocus={(event) => { event.preventDefault(); const refocus = refocusOnClose.current; refocusOnClose.current = false; onInteractionEnd(refocus); }}>
          <DropdownMenuRadioGroup value={language ?? ""} onValueChange={(value) => { refocusOnClose.current = true; onLanguageChange(value || null); }}>
            <DropdownMenuRadioItem value="">{PLAIN_LANGUAGE_LABEL}</DropdownMenuRadioItem>
            {codeBlockLanguageOptions(language).map((option) => <DropdownMenuRadioItem key={option.id} value={option.id}>{option.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" aria-pressed={wrap} title={wrap ? "关闭自动换行，长行横向滚动" : "开启自动换行"} onClick={() => onWrapChange(!wrap)}>自动换行</Button>
    </>}
    <Button variant="ghost" size="icon" aria-label="复制代码" title="复制代码" onClick={onCopy}><Copy className="h-4 w-4" /></Button>
  </div>, document.body);
}
