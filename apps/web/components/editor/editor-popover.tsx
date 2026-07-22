"use client";

import { useEffect, useRef } from "react";
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

  const left = Math.min(point.left, Math.max(12, window.innerWidth - 360));
  const top = Math.min(point.top, Math.max(12, window.innerHeight - 580));

  return createPortal(
    <div ref={ref} className={`editor-popover ${className}`} style={{ left, top }}>
      {children}
    </div>,
    document.body
  );
}
