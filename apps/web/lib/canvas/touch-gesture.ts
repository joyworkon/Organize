/**
 * 触屏平移 / 双指缩放的纯状态机。
 *
 * 缩放锚点是两指中点下的世界坐标：之后每一帧都把该点放回「当前」中点下，
 * 所以中点下的内容不跳，中点移动时视口跟着平移。缩放范围与视口一致（10%–400%）。
 */

export interface Point {
  x: number;
  y: number;
}

export interface TouchViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface TouchPointer {
  id: number;
  x: number;
  y: number;
}

/** 与 canvas-viewport 的 MIN_ZOOM / MAX_ZOOM 保持一致。 */
export const TOUCH_MIN_ZOOM = 0.1;
export const TOUCH_MAX_ZOOM = 4;

const PAN_SLOP = 4;

export type TouchTargetKind = "native" | "blank" | "content";

export type TouchMode =
  | { kind: "idle" }
  | {
      kind: "pan";
      pointerId: number;
      start: Point;
      origin: TouchViewport;
      moved: boolean;
      /** 落点是视口或世界容器本身，轻点应清选区。 */
      blank: boolean;
    }
  | {
      kind: "pinch";
      a: number;
      b: number;
      startDistance: number;
      startZoom: number;
      anchorWorld: Point;
    };

export interface TouchSession {
  pointers: TouchPointer[];
  mode: TouchMode;
  /** 捏合结束后还按着的手指：抬起前不再开一次新的单指平移。 */
  inert: number[];
}

export interface TouchStepInput {
  type: "down" | "move" | "up" | "cancel";
  pointer: TouchPointer;
  /** 仅 down 使用。native = 输入框 / 按钮 / 把手，不参与画布手势。 */
  kind?: TouchTargetKind;
  /** 只读或预览：按在版面内容上也可以单指平移。 */
  panContent?: boolean;
  viewport: TouchViewport;
  /** 视口元素左上角的 client 坐标。 */
  origin: Point;
}

export interface TouchStepResult {
  session: TouchSession;
  viewport: TouchViewport | null;
  /** 第二指落下：调用方要取消框选、模块拖动和其它单指拖动。 */
  cancelSingleFinger: boolean;
  suppressClick: boolean;
  /** 空白处轻点，等价于点空白清选区。 */
  tapBlank: boolean;
}

const NATIVE_SELECTOR = "button, input, textarea, select, a, [contenteditable='true']";
const HANDLE_SELECTOR = ".canvas-board-resize, .canvas-board-handle, .canvas-divider, .canvas-free-move, .canvas-free-resize";

export function createTouchSession(): TouchSession {
  return { pointers: [], mode: { kind: "idle" }, inert: [] };
}

/** 单指平移是否该从这里开始。native 留给文本选择和按钮。 */
export function touchTargetKind(target: Element): TouchTargetKind {
  if (target.closest(NATIVE_SELECTOR) || target.closest(HANDLE_SELECTOR)) return "native";
  if (target.classList.contains("canvas-viewport") || target.classList.contains("canvas-world")) return "blank";
  return "content";
}

export function touchSessionOwns(session: TouchSession, pointerId: number): boolean {
  const mode = session.mode;
  if (mode.kind === "pan") return mode.pointerId === pointerId;
  if (mode.kind === "pinch") return mode.a === pointerId || mode.b === pointerId;
  return false;
}

export function clampTouchZoom(zoom: number): number {
  return Math.min(TOUCH_MAX_ZOOM, Math.max(TOUCH_MIN_ZOOM, zoom));
}

/** 把捏合开始时的世界锚点放在当前两指中点下。zoom 已被夹紧时锚点仍然不漂。 */
export function pinchViewport(args: {
  anchorWorld: Point;
  startDistance: number;
  startZoom: number;
  midpoint: Point;
  distance: number;
}): TouchViewport {
  const zoom = clampTouchZoom(args.startZoom * (args.distance / args.startDistance));
  return {
    zoom,
    x: args.midpoint.x - args.anchorWorld.x * zoom,
    y: args.midpoint.y - args.anchorWorld.y * zoom,
  };
}

function unchanged(session: TouchSession): TouchStepResult {
  return { session, viewport: null, cancelSingleFinger: false, suppressClick: false, tapBlank: false };
}

function upsert(pointers: TouchPointer[], pointer: TouchPointer): TouchPointer[] {
  const index = pointers.findIndex((item) => item.id === pointer.id);
  if (index < 0) return [...pointers, pointer];
  const next = pointers.slice();
  next[index] = pointer;
  return next;
}

function distance(a: TouchPointer, b: TouchPointer): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: TouchPointer, b: TouchPointer, origin: Point): Point {
  return { x: (a.x + b.x) / 2 - origin.x, y: (a.y + b.y) / 2 - origin.y };
}

function beginPinch(pointers: TouchPointer[], viewport: TouchViewport, origin: Point): TouchMode {
  const [a, b] = pointers;
  const dist = Math.max(distance(a, b), 1);
  const mid = midpoint(a, b, origin);
  return {
    kind: "pinch",
    a: a.id,
    b: b.id,
    startDistance: dist,
    startZoom: viewport.zoom,
    anchorWorld: {
      x: (mid.x - viewport.x) / viewport.zoom,
      y: (mid.y - viewport.y) / viewport.zoom,
    },
  };
}

function endPointer(session: TouchSession, pointerId: number, abort: boolean): TouchStepResult {
  const pointers = session.pointers.filter((item) => item.id !== pointerId);
  const mode = session.mode;
  if (mode.kind === "pinch" && (pointerId === mode.a || pointerId === mode.b || pointers.length < 2)) {
    return {
      session: { pointers, mode: { kind: "idle" }, inert: pointers.map((item) => item.id) },
      viewport: null,
      cancelSingleFinger: false,
      suppressClick: true,
      tapBlank: false,
    };
  }
  if (mode.kind === "pan" && mode.pointerId === pointerId) {
    return {
      session: { pointers, mode: { kind: "idle" }, inert: session.inert.filter((id) => id !== pointerId) },
      viewport: null,
      cancelSingleFinger: false,
      suppressClick: mode.moved || abort,
      tapBlank: !abort && mode.blank && !mode.moved,
    };
  }
  return {
    session: { pointers, mode, inert: session.inert.filter((id) => id !== pointerId) },
    viewport: null,
    cancelSingleFinger: false,
    suppressClick: false,
    tapBlank: false,
  };
}

export function stepTouch(session: TouchSession, input: TouchStepInput): TouchStepResult {
  if (input.type === "down") {
    if (input.kind === "native") return unchanged(session);
    const pointers = upsert(session.pointers, input.pointer);
    const inert = session.inert.filter((id) => id !== input.pointer.id);
    if (pointers.length >= 2) {
      if (session.mode.kind === "pinch") {
        return unchanged({ ...session, pointers, inert });
      }
      return {
        session: { pointers, inert: [], mode: beginPinch(pointers, input.viewport, input.origin) },
        viewport: null,
        cancelSingleFinger: true,
        suppressClick: true,
        tapBlank: false,
      };
    }
    const pan = input.kind === "blank" || (input.kind === "content" && input.panContent === true);
    if (!pan || inert.includes(input.pointer.id)) {
      return { ...unchanged(session), session: { ...session, pointers, inert } };
    }
    return {
      session: {
        pointers,
        inert,
        mode: {
          kind: "pan",
          pointerId: input.pointer.id,
          start: { x: input.pointer.x, y: input.pointer.y },
          origin: input.viewport,
          moved: false,
          blank: input.kind === "blank",
        },
      },
      viewport: null,
      cancelSingleFinger: false,
      suppressClick: false,
      tapBlank: false,
    };
  }

  if (input.type === "move") {
    const known = session.pointers.some((item) => item.id === input.pointer.id);
    if (!known) return unchanged(session);
    const pointers = upsert(session.pointers, input.pointer);
    if (session.mode.kind === "pinch") {
      const mode = session.mode;
      const a = pointers.find((item) => item.id === mode.a);
      const b = pointers.find((item) => item.id === mode.b);
      if (!a || !b) return { ...unchanged(session), session: { ...session, pointers } };
      const viewport = pinchViewport({
        anchorWorld: mode.anchorWorld,
        startDistance: mode.startDistance,
        startZoom: mode.startZoom,
        midpoint: midpoint(a, b, input.origin),
        distance: Math.max(distance(a, b), 1),
      });
      return {
        session: { ...session, pointers },
        viewport,
        cancelSingleFinger: false,
        suppressClick: true,
        tapBlank: false,
      };
    }
    if (session.mode.kind === "pan" && session.mode.pointerId === input.pointer.id) {
      const dx = input.pointer.x - session.mode.start.x;
      const dy = input.pointer.y - session.mode.start.y;
      const moved = session.mode.moved || Math.hypot(dx, dy) >= PAN_SLOP;
      return {
        session: { ...session, pointers, mode: { ...session.mode, moved } },
        viewport: moved
          ? { ...session.mode.origin, x: session.mode.origin.x + dx, y: session.mode.origin.y + dy }
          : null,
        cancelSingleFinger: false,
        suppressClick: moved,
        tapBlank: false,
      };
    }
    return { ...unchanged(session), session: { ...session, pointers } };
  }

  return endPointer(session, input.pointer.id, input.type === "cancel");
}
