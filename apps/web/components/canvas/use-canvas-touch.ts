"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  createTouchSession,
  stepTouch,
  touchSessionOwns,
  touchTargetKind,
  type TouchStepResult,
} from "@/lib/canvas/touch-gesture";
import type { CanvasStore } from "./canvas-store";

/** 子元素上的拖动捕获要放开，否则第二指捏合时第一次拖动还会在松手时提交。 */
function releaseForeignCaptures(viewport: HTMLElement, ids: number[]) {
  const nodes = viewport.querySelectorAll("*");
  for (const id of ids) {
    for (const node of nodes) {
      if (typeof node.hasPointerCapture === "function" && node.hasPointerCapture(id)) {
        node.releasePointerCapture(id);
      }
    }
    captureOn(viewport, id);
  }
}

function captureOn(el: HTMLElement, id: number) {
  if (typeof el.setPointerCapture !== "function") return;
  try {
    if (!el.hasPointerCapture(id)) el.setPointerCapture(id);
  } catch {
    // 指针已经抬起时浏览器会拒绝捕获。
  }
}

function releaseOn(el: HTMLElement, id: number) {
  if (typeof el.hasPointerCapture !== "function" || !el.hasPointerCapture(id)) return;
  try {
    el.releasePointerCapture(id);
  } catch {
    // 同上。
  }
}

/**
 * 触屏单指平移 / 双指捏合。鼠标与触控板不进这里。
 * 返回 true 表示这次 pointerdown 已由平移或捏合接管，调用方不要再走框选或模块拖动。
 */
export function useCanvasTouch(store: CanvasStore, interactive: boolean, cancelPointer: () => void) {
  const sessionRef = useRef(createTouchSession());
  const swallowClick = useRef(false);
  const pinchingRef = useRef(false);
  const cancelRef = useRef(cancelPointer);
  cancelRef.current = cancelPointer;
  const [navigating, setNavigating] = useState(false);

  const sync = (result: TouchStepResult) => {
    sessionRef.current = result.session;
    pinchingRef.current = result.session.mode.kind === "pinch";
    const navigatingNow = result.session.mode.kind !== "idle";
    setNavigating((prev) => (prev === navigatingNow ? prev : navigatingNow));
    if (result.suppressClick) swallowClick.current = true;
    if (result.viewport) store.getState().setViewport(result.viewport);
    if (result.tapBlank) {
      store.getState().select(null);
      store.getState().stopEdit();
    }
    if (result.cancelSingleFinger) cancelRef.current();
    return result;
  };

  const step = (e: ReactPointerEvent<HTMLElement>, type: "down" | "move" | "up" | "cancel") => {
    if (e.pointerType !== "touch") return null;
    if (type === "down" && e.button > 0) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    return sync(stepTouch(sessionRef.current, {
      type,
      pointer: { id: e.pointerId, x: e.clientX, y: e.clientY },
      kind: type === "down" ? touchTargetKind(e.target as Element) : undefined,
      panContent: !interactive,
      viewport: store.getState().viewport,
      origin: { x: rect.left, y: rect.top },
    }));
  };

  return {
    pinchingRef,
    navigating,
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      const result = step(e, "down");
      if (!result) return false;
      const mode = result.session.mode.kind;
      if (result.cancelSingleFinger) {
        releaseForeignCaptures(e.currentTarget, result.session.pointers.map((pointer) => pointer.id));
      }
      if (mode !== "pan" && mode !== "pinch") return false;
      e.preventDefault();
      e.stopPropagation();
      captureOn(e.currentTarget, e.pointerId);
      return true;
    },
    onPointerMove(e: ReactPointerEvent<HTMLElement>) {
      const result = step(e, "move");
      if (!result?.viewport) return;
      e.preventDefault();
      e.stopPropagation();
    },
    /** 调用前先记下是否由触屏平移/捏合持有这根指针；松手捕获要等模块拖动提交之后。 */
    owns(pointerId: number) {
      return touchSessionOwns(sessionRef.current, pointerId);
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      step(e, "up");
    },
    onPointerCancel(e: ReactPointerEvent<HTMLElement>) {
      step(e, "cancel");
    },
    release(e: ReactPointerEvent<HTMLElement>) {
      releaseOn(e.currentTarget, e.pointerId);
    },
    onClickCapture(e: React.MouseEvent) {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
