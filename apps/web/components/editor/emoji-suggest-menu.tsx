"use client";

import type { Editor } from "@tiptap/core";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { searchEmoji, type EmojiOption } from "@/lib/editor/emoji-catalog";
import { readRecentEmojis, rememberEmoji } from "@/lib/editor/emoji-recents";
import { EditorPopover } from "./editor-popover";
import { highlightMatch } from "./highlight-match";
import { insertEmoji, type EmojiSuggestEvent } from "./extensions/emoji-trigger";

type Session = Extract<EmojiSuggestEvent, { type: "start" | "update" }>;

export function EmojiSuggestMenu({ editor, onOpenChange }: {
  editor: Editor; onOpenChange?: (open: boolean) => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const close = useCallback(() => setSession(null), []);
  const open = Boolean(session && editor.isEditable);
  useLayoutEffect(() => {
    onOpenChange?.(open);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);
  useEffect(close, [editor, close]);
  useEffect(() => {
    const dom = editor.view.dom;
    const handler = (event: Event) => {
      if (event.target !== dom) return;
      const detail = (event as CustomEvent<EmojiSuggestEvent>).detail;
      if (detail.type === "start") setSession(detail);
      // Esc 关闭后继续输入不重开（与页面链接菜单一致），新一轮触发才会再次打开
      if (detail.type === "update") setSession((current) => current ? detail : null);
      if (detail.type === "exit") close();
    };
    dom.addEventListener("organize-emoji-suggest", handler);
    const checkEditable = () => { if (!editor.isEditable) close(); };
    editor.on("blur", close);
    editor.on("transaction", checkEditable);
    editor.on("update", checkEditable);
    return () => { dom.removeEventListener("organize-emoji-suggest", handler); editor.off("blur", close); editor.off("transaction", checkEditable); editor.off("update", checkEditable); };
  }, [editor, close]);
  return session && editor.isEditable
    ? <EmojiSuggestResults editor={editor} session={session} onClose={close} />
    : null;
}

function EmojiSuggestResults({ editor, session, onClose }: {
  editor: Editor; session: Session; onClose: () => void;
}) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const query = session.query;
  // 本地表同步匹配，无需防抖；最近使用只在 1 字符查询时优先（见 searchEmoji）
  const matches = useMemo(() => searchEmoji(query, readRecentEmojis()), [query]);
  useEffect(() => setActive(0), [query]);

  const select = (index: number) => {
    const option: EmojiOption | undefined = matches[index];
    if (!option || !editor.isEditable) return;
    if (insertEmoji(editor, session.range, option.emoji)) {
      rememberEmoji(option.emoji);
      onClose();
    }
  };
  const keyHandler = useRef<(event: Event) => void>(() => {});
  keyHandler.current = (event) => {
    const detail = (event as CustomEvent<EmojiSuggestEvent>).detail;
    if (detail.type !== "key") return;
    event.preventDefault();
    if (detail.key === "Escape") { onClose(); return; }
    if (!matches.length) return;
    if (detail.key === "ArrowDown") setActive((value) => Math.min(value + 1, matches.length - 1));
    else if (detail.key === "ArrowUp") setActive((value) => Math.max(value - 1, 0));
    else select(Math.min(active, matches.length - 1));
  };
  useEffect(() => {
    const dom = editor.view.dom;
    const handler = (event: Event) => { if (event.target === dom) keyHandler.current(event); };
    dom.addEventListener("organize-emoji-suggest", handler);
    return () => dom.removeEventListener("organize-emoji-suggest", handler);
  }, [editor]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  // 无匹配时不显示浮层，也不监听键盘，完全不挡输入
  if (!matches.length) return null;
  const clamped = Math.min(active, matches.length - 1);
  return <EditorPopover point={session.point} onClose={onClose} className="emoji-suggest-popover">
    <div ref={listRef} className="editor-menu-scroll" role="listbox" aria-label="插入表情">
      {matches.map((option, index) => <Button key={option.emoji} type="button" variant="ghost" role="option" aria-selected={index === clamped}
        className={cn("h-auto w-full justify-start gap-2.5 whitespace-normal px-2 py-2 text-left font-normal", index === clamped && "is-active bg-accent")}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => select(index)}>
        <span className="skill-icon" aria-hidden="true">{option.emoji}</span>
        <span className="min-w-0 break-words"><strong>{highlightMatch(option.keywords[0], query)}</strong></span>
      </Button>)}
    </div>
  </EditorPopover>;
}
