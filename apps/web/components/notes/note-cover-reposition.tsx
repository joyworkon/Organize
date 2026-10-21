"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const clamp = (value: number) => Math.max(0, Math.min(100, value));

/** A local preview only; the existing metadata callback runs once on confirmation. */
export function NoteCoverReposition({ url, position, onSave, onCancel }: {
  url: string;
  position: number;
  onSave: (position: number) => void;
  onCancel: () => void;
}) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => { region.current?.focus(); }, []);
  const naturalSize = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const image = new window.Image();
    image.onload = () => { naturalSize.current = { width: image.naturalWidth, height: image.naturalHeight }; };
    image.src = url;
    return () => { image.onload = null; };
  }, [url]);
  const [draft, setDraft] = useState(position);
  const drag = useRef<{ id: number; y: number; position: number } | null>(null);
  return (
    <div className="note-cover-reposition absolute inset-0 bg-cover bg-no-repeat"
      style={{ backgroundImage: `url(${JSON.stringify(url)})`, backgroundPosition: `center ${draft}%` }}
      role="group" aria-label="调整封面位置" tabIndex={0} ref={region}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
        // Buttons keep their native Enter behavior (including Cancel).
        if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); onSave(draft); }
        if (["ArrowUp", "ArrowDown"].includes(event.key) && event.target === event.currentTarget) {
          event.preventDefault();
          setDraft((value) => clamp(value + (event.key === "ArrowDown" ? 1 : -1)));
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("button, input")) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, y: event.clientY, position: draft };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        // Percent background-position spans the cropped overflow, not the viewport.
        const { clientWidth: width, clientHeight: height } = event.currentTarget;
        const size = naturalSize.current;
        const overflow = size && size.width && size.height
          ? Math.max(width / size.width, height / size.height) * size.height - height
          : height;
        if (overflow > 0) setDraft(clamp(start.position - (event.clientY - start.y) / overflow * 100));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
    >
      <div className="note-cover-position" onPointerDown={(event) => event.stopPropagation()}>
        <span className="text-sm">拖动图片调整位置</span>
        <input type="range" min={0} max={100} value={draft} aria-label="封面垂直位置" onChange={(event) => setDraft(Number(event.target.value))} />
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => onSave(draft)}>保存位置</Button>
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>取消</Button>
        </div>
      </div>
    </div>
  );
}
