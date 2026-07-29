"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorMenuPoint } from "./types";

export function EditorPopover({
  point,
  onClose,
  className = "",
  children,
}: {
  point: EditorMenuPoint;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(point);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
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
  }, [onClose]);

  useLayoutEffect(() => {
    const popover = ref.current;
    if (!popover) return;
    const updatePosition = () => {
      const gap = 12;
      const rect = popover.getBoundingClientRect();
      const next = {
        left: Math.max(gap, Math.min(point.left, window.innerWidth - rect.width - gap)),
        top: Math.max(gap, Math.min(point.top, window.innerHeight - rect.height - gap)),
      };
      setPosition((current) => (
        current.left === next.left && current.top === next.top ? current : next
      ));
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(popover);
    window.addEventListener("resize", updatePosition);
    // 页面滚动时弹层会与目标块脱节：捕获阶段监听，滚动即关闭
    window.addEventListener("scroll", onClose, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [point, onClose]);

  return createPortal(
    <div ref={ref} className={`editor-popover ${className}`} style={position}>
      {children}
    </div>,
    document.body
  );
}
