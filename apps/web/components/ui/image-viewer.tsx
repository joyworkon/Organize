"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogTitle } from "./dialog";
import { Minus, Plus, X } from "@/components/icons";
import { constrainTransform, fitScale, pinchTransform, zoomTransform, type ImageSize, type ImageTransform, type Point } from "@/components/editor/image-geometry";

/** Body portal + Radix focus trap. Transform applies only to the displayed image. */
export function ImageViewer({ src, alt, onClose, returnFocus }: {
  src: string; alt: string; onClose: () => void; returnFocus?: () => void;
}) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [image, setImage] = useState<ImageSize>({ width: 1, height: 1 });
  const [viewport, setViewport] = useState<ImageSize>({ width: 1, height: 1 });
  const [value, setValue] = useState<ImageTransform>({ scale: 1, x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const moved = useRef(false);
  const minimum = fitScale(image, viewport);

  useEffect(() => {
    const element = stage;
    if (!element) return;
    const measure = () => setViewport({ width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [stage]);
  useEffect(() => {
    setValue({ scale: fitScale(image, viewport), x: 0, y: 0 });
  }, [image, viewport]);
  // A non-passive native listener also prevents page scroll on trackpads.
  useEffect(() => {
    const element = stage;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      setValue((current) => zoomTransform(current, current.scale * Math.exp(-event.deltaY * 0.002), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }, image, viewport));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [image, viewport, stage]);

  const point = (event: React.PointerEvent): Point => {
    const rect = stage!.getBoundingClientRect();
    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
  };
  const zoom = (factor: number) => setValue((current) => zoomTransform(current, current.scale * factor, { x: 0, y: 0 }, image, viewport));
  const toggle = () => setValue((current) => ({ scale: Math.abs(current.scale - minimum) < 0.001 ? 1 : minimum, x: 0, y: 0 }));
  const release = (event: React.PointerEvent) => { pointers.current.delete(event.pointerId); };

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent hideCloseButton className="organize-image-viewer" aria-describedby={undefined}
      onCloseAutoFocus={(event) => { if (returnFocus) { event.preventDefault(); returnFocus(); } }}>
      <DialogTitle className="sr-only">图片查看器</DialogTitle>
      <div className="organize-image-viewer-controls" role="group" aria-label="图片缩放">
        <Button variant="ghost" size="icon" aria-label="缩小图片" onClick={() => zoom(1 / 1.25)}><Minus className="h-4 w-4" /></Button>
        <output aria-live="polite">{Math.round(value.scale * 100)}%</output>
        <Button variant="ghost" size="icon" aria-label="放大图片" onClick={() => zoom(1.25)}><Plus className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => setValue({ scale: minimum, x: 0, y: 0 })}>适应屏幕</Button>
        <Button variant="ghost" size="sm" onClick={() => setValue({ scale: 1, x: 0, y: 0 })}>100%</Button>
        <Button variant="ghost" size="icon" aria-label="关闭图片查看器" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div ref={setStage} className="organize-image-viewer-stage" data-scale={value.scale}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if (!pointers.current.size) moved.current = false;
          pointers.current.set(event.pointerId, point(event));
          if (pointers.current.size > 1) moved.current = true;
          // Capture on the original target so a click on the image cannot become a backdrop click.
          (event.target as HTMLElement).setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const previous = pointers.current.get(event.pointerId);
          if (!previous) return;
          const next = point(event);
          const before = [...pointers.current.values()];
          pointers.current.set(event.pointerId, next);
          if (Math.hypot(next.x - previous.x, next.y - previous.y) > 0) moved.current = true;
          if (before.length >= 2) {
            const after = [...pointers.current.values()];
            setValue((current) => pinchTransform(current, [before[0], before[1]], [after[0], after[1]], image, viewport));
          } else {
            setValue((current) => constrainTransform({ ...current, x: current.x + next.x - previous.x, y: current.y + next.y - previous.y }, image, viewport));
          }
        }}
        onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
        onClick={(event) => { if (event.target === event.currentTarget && !moved.current) onClose(); }}>
        {failed && <p role="status">图片加载失败，可关闭后通过工具栏打开原图。</p>}
        {/* eslint-disable-next-line @next/next/no-img-element -- Original dimensions are required for 100% zoom. */}
        <img ref={imageRef} src={src} alt={alt} draggable={false} onDoubleClick={toggle}
          onLoad={() => { const element = imageRef.current!; setImage({ width: element.naturalWidth || 1, height: element.naturalHeight || 1 }); }}
          onError={() => setFailed(true)}
          style={{ width: image.width, height: image.height, transform: `translate(${value.x}px, ${value.y}px) scale(${value.scale})` }} />
      </div>
      {alt && <p className="organize-image-viewer-caption">{alt}</p>}
    </DialogContent>
  </Dialog>;
}
