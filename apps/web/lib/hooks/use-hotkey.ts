"use client";

import { useEffect, useRef, useCallback } from "react";

/**
 * 判断按键事件是否发生在输入元素中（input/textarea/contentEditable），
 * 这种情况下的按键不应该触发全局快捷键。
 * （画布区块名编辑输入框复用本判定，见 components/canvas/canvas-workspace.tsx）
 */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * 当前是否有打开的弹层：Radix Dialog 渲染 role="dialog"，
 * DropdownMenu/ContextMenu 渲染 role="menu"，Select 列表渲染 role="listbox"。
 * 页面级快捷键（如 n 新建、v 分组、Esc 关闭详情）应在这些弹层打开时让位，
 * 否则 Select 展开时焦点不在输入框上，按 Esc/v/m 会同时误触发页面动作。
 * 版本历史侧栏的 listbox 是常驻列表，不是弹层，用 .note-history-listbox 排除。
 */
export function hasOpenDialog(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector(
      '[role="dialog"], [role="menu"], [role="listbox"]:not(.note-history-listbox)'
    )
  );
}

export interface HotkeyHandler {
  /** 按下的键（小写），如 "g"、"l"、"/"、"?" */
  key: string;
  /** 是否需要修饰键。设为 false 表示该修饰键按下时不触发。 */
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** 触发的回调。收到原始事件，便于弹层打开时跳过 preventDefault。 */
  handler: (event: KeyboardEvent) => void;
  /**
   * 是否允许在输入框中触发。默认 false（输入时屏蔽）
   */
  allowInInput?: boolean;
  /** 是否阻止默认行为，默认 true */
  preventDefault?: boolean;
}

/**
 * 全局键盘快捷键 hook。可以多次调用注册多组快捷键。
 *
 * 用法：
 *   useHotkey([{ key: "g", handler: () => ... }, ...]);
 *
 * 对于双键序列（如 `g l`），用 sequence 形式：
 *   useHotkeySequence([{ sequence: ["g", "l"], handler: () => router.push("/library") }]);
 */
export function useHotkey(handlers: HotkeyHandler[]) {
  // 用 ref 持有最新 handlers，避免每次重渲染都重新绑监听
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const list = handlersRef.current;
      for (const h of list) {
        const key = e.key.toLowerCase();
        const keyMatches =
          h.key.toLowerCase() === key ||
          (h.key === "/" && e.key === "/") ||
          (h.key === "?" && e.key === "?");

        if (!keyMatches) continue;
        if (h.ctrlKey !== undefined && h.ctrlKey !== e.ctrlKey) continue;
        if (h.metaKey !== undefined && h.metaKey !== e.metaKey) continue;
        if (h.altKey !== undefined && h.altKey !== e.altKey) continue;
        if (h.shiftKey !== undefined && h.shiftKey !== e.shiftKey) continue;

        if (isTypingTarget(e) && !h.allowInInput) return;

        if (h.preventDefault !== false) e.preventDefault();
        h.handler(e);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export interface SequenceHandler {
  sequence: string[];
  handler: () => void;
}

export interface UseHotkeySequenceOptions {
  onBufferChange?: (buffer: string[]) => void;
}

/**
 * 双键序列快捷键（如 Gmail/Notion 风格 `g l`）。
 * 在 1.5 秒内按完整个序列才触发。
 */
export function useHotkeySequence(
  sequences: SequenceHandler[],
  options?: UseHotkeySequenceOptions
) {
  const seqsRef = useRef(sequences);
  seqsRef.current = sequences;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const bufferRef = useRef<string[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const notifyBufferChange = useCallback(() => {
    optionsRef.current?.onBufferChange?.([...bufferRef.current]);
  }, []);

  const reset = useCallback(() => {
    bufferRef.current = [];
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    notifyBufferChange();
  }, [notifyBufferChange]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 输入中不响应序列
      if (isTypingTarget(e)) return;
      // 只处理可见字符
      if (e.key.length !== 1 && e.key !== "Escape") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // 弹层（Dialog/Menu/Popover）打开时序列让位并清空缓冲：
      // 例如日历页单键 g 会弹出「跳转到日期」面板，随后 1.5s 内的字母
      // 不应再补全 g x 序列把用户带离当前页面（与单键快捷键的 hasOpenDialog 口径一致）。
      if (hasOpenDialog()) {
        reset();
        return;
      }

      if (e.key === "Escape") {
        reset();
        return;
      }

      const key = e.key.toLowerCase();
      // 页面快捷键（日历上的 g）可能注册得更晚，要等本事件的其它监听器跑完
      // 再决定要不要入缓冲。已被 preventDefault 认领的键不能再拼成 g x 把人带走。
      queueMicrotask(() => {
        if (e.defaultPrevented || hasOpenDialog()) {
          if (hasOpenDialog()) reset();
          return;
        }
        bufferRef.current = [...bufferRef.current, key];
        // 只保留最后 N 位（最长序列的长度）
        const maxLen = Math.max(...seqsRef.current.map((s) => s.sequence.length), 1);
        if (bufferRef.current.length > maxLen) {
          bufferRef.current = bufferRef.current.slice(-maxLen);
        }
        notifyBufferChange();

        const buf = bufferRef.current;
        for (const s of seqsRef.current) {
          if (buf.length < s.sequence.length) continue;
          const tail = buf.slice(-s.sequence.length);
          if (tail.join("") === s.sequence.join("")) {
            e.preventDefault();
            s.handler();
            reset();
            return;
          }
        }

        // 1.5 秒内没继续按就清空
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(reset, 1500);
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [reset, notifyBufferChange]);
}
