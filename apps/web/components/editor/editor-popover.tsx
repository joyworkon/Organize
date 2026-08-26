"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorMenuPoint } from "./types";

export function EditorPopover({
  point,
  onClose,
  className = "",
  ignoreOutsideSelector,
  children,
}: {
  point: EditorMenuPoint;
  onClose: () => void;
  className?: string;
  /** 命中该选择器的元素视为弹层的一部分（如二级 flyout 菜单），点它不算"点外面" */
  ignoreOutsideSelector?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(point);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  const isIgnoredTarget = (target: EventTarget | null) => {
    if (!ignoreOutsideSelector || !(target instanceof Element)) return false;
    return target.closest(ignoreOutsideSelector) !== null;
  };

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (isIgnoredTarget(event.target)) return;
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, ignoreOutsideSelector]);

  useLayoutEffect(() => {
    const popover = ref.current;
    if (!popover) return;
    const gap = 12;
    // 至少给菜单留这么多高度，低于它且上方更宽敞时翻转到上方展开
    const MIN_MENU_HEIGHT = 240;
    const updatePosition = () => {
      const rect = popover.getBoundingClientRect();
      const anchorBottom = point.top;
      const anchorTop = point.anchorTop ?? point.top;
      const spaceBelow = window.innerHeight - anchorBottom - gap;
      const spaceAbove = anchorTop - gap * 2;
      const openAbove = spaceBelow < MIN_MENU_HEIGHT && spaceAbove > spaceBelow;
      const space = openAbove ? spaceAbove : spaceBelow;
      const nextMaxHeight = Math.max(160, Math.min(space, window.innerHeight - gap * 2));
      const visibleHeight = Math.min(rect.height, nextMaxHeight);
      const next = {
        left: Math.max(gap, Math.min(point.left, window.innerWidth - rect.width - gap)),
        top: openAbove
          ? Math.max(gap, anchorTop - gap - visibleHeight)
          : Math.max(gap, Math.min(anchorBottom, window.innerHeight - visibleHeight - gap)),
      };
      setMaxHeight((current) => (current === nextMaxHeight ? current : nextMaxHeight));
      setPosition((current) => (
        current.left === next.left && current.top === next.top ? current : next
      ));
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(popover);
    window.addEventListener("resize", updatePosition);
    // 页面滚动时弹层会与目标块脱节：捕获阶段监听，滚动即关闭。
    // 但有两种滚动不算：1）菜单内部滚动（浏览菜单项）；
    // 2）打开菜单前的 scrollIntoView 会让浏览器在下一帧补发一个 scroll 事件，
    //    给一个短暂的宽限期，避免菜单一开就被它误关。
    const mountedAt = Date.now();
    const onScroll = (event: Event) => {
      if (Date.now() - mountedAt < 200) return;
      if (popover.contains(event.target as Node)) return;
      if (isIgnoredTarget(event.target)) return;
      onClose();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [point, onClose, ignoreOutsideSelector]);

  return createPortal(
    <div
      ref={ref}
      className={`editor-popover ${className}`}
      style={{ ...position, maxHeight }}
    >
      {children}
    </div>,
    document.body
  );
}
