import type { CanvasInkBlock } from "@/lib/canvas/model";
import { inkPath } from "@/lib/canvas/ink";

/** Shared by the live canvas and the existing offscreen PNG renderer. */
export function CanvasInk({ block }: { block: CanvasInkBlock }) {
  return <svg className="canvas-ink-path" width="100%" height="100%" viewBox={`0 0 ${block.baseWidth} ${block.baseHeight}`}
    preserveAspectRatio="none" aria-hidden="true">
    <path d={inkPath(block.points)} fill="none" stroke={block.color ? `var(--cv-text-${block.color})` : "hsl(var(--foreground))"}
      strokeWidth={block.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
