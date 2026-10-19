import { isTypingTarget } from "@/lib/hooks/use-hotkey";
import { duplicateBlock, duplicateRegion } from "@/lib/canvas/commands";
import { findBlockLocation, type CanvasCommandResult, type CanvasDoc } from "@/lib/canvas/model";
import type { CanvasSelection, CanvasViewport } from "./canvas-store";
import { clampZoom } from "./canvas-viewport";

export type CanvasShortcut = "select-all" | "duplicate" | "zoom-in" | "zoom-out" | "zoom-reset" | "zoom-fit" | "help";

/** Only match canvas keys outside native text editing; callers also guard modal/editor state. */
export function matchCanvasShortcut(e: KeyboardEvent): CanvasShortcut | null {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.altKey || isTypingTarget(e)) return null;
  const key = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey) {
    if (key === "=" || key === "+") return "zoom-in";
    if (e.shiftKey) return null;
    if (key === "-") return "zoom-out";
    if (key === "0") return "zoom-reset";
    if (key === "a") return "select-all";
    if (key === "d") return "duplicate";
    return null;
  }
  if (key === "?" || (e.shiftKey && (key === "/" || e.code === "Slash"))) return "help";
  if (e.shiftKey && (e.code === "Digit1" || key === "!" || key === "1")) return "zoom-fit";
  return null;
}

/** Explicit platform input keeps server rendering safe and labels independently testable. */
export function canvasShortcutLabels(platform = "") {
  const mac = /mac|iphone|ipad|ipod/i.test(platform);
  return { mod: mac ? "⌘" : "Ctrl+", shift: mac ? "⇧" : "Shift+" };
}

/** rect is the visible area in viewport-local screen coordinates, including panel offsets. */
export function zoomCanvasAtCenter(
  viewport: CanvasViewport,
  nextZoom: number,
  rect: { x: number; y: number; width: number; height: number },
): CanvasViewport {
  const zoom = clampZoom(nextZoom);
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  return {
    zoom,
    x: x - ((x - viewport.x) / viewport.zoom) * zoom,
    y: y - ((y - viewport.y) / viewport.zoom) * zoom,
  };
}

export function allCanvasBlockIds(doc: CanvasDoc): string[] {
  return doc.boards.flatMap((b) => b.regions).flatMap((r) => r.sections)
    .flatMap((s) => s.columns).flatMap((c) => c.blocks).map((b) => b.id);
}

/** Compose existing commands into one apply/undo transaction; free/board have no duplicate command. */
export function duplicateCanvasSelection(
  doc: CanvasDoc,
  selection: CanvasSelection,
): CanvasCommandResult & { blockIds?: string[] } {
  if (selection?.kind === "region") return duplicateRegion(doc, selection);
  const ids = selection?.kind === "block" ? [selection.blockId]
    : selection?.kind === "blocks" ? [...new Set(selection.blockIds)] : [];
  let next = doc;
  const blockIds: string[] = [];
  let focus: CanvasCommandResult["focus"];
  for (const blockId of ids) {
    if (!findBlockLocation(next, blockId)) continue;
    const result = duplicateBlock(next, { blockId });
    next = result.doc;
    if (result.focus?.kind === "block") {
      blockIds.push(result.focus.blockId);
      focus = { ...result.focus, edit: false };
    }
  }
  return { doc: next, focus, blockIds };
}
