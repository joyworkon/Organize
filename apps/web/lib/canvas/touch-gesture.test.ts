import { describe, expect, it } from "vitest";
import { MIN_ZOOM, MAX_ZOOM } from "@/components/canvas/canvas-viewport";
import {
  TOUCH_MAX_ZOOM,
  TOUCH_MIN_ZOOM,
  createTouchSession,
  pinchViewport,
  stepTouch,
  type TouchSession,
  type TouchStepInput,
  type TouchViewport,
} from "./touch-gesture";

const origin = { x: 0, y: 0 };

function down(session: TouchSession, pointer: { id: number; x: number; y: number }, extra: Partial<TouchStepInput> = {}) {
  return stepTouch(session, {
    type: "down",
    pointer,
    kind: "blank",
    viewport: extra.viewport ?? { x: 0, y: 0, zoom: 1 },
    origin,
    ...extra,
  });
}

function worldAt(viewport: TouchViewport, client: { x: number; y: number }) {
  return {
    x: (client.x - origin.x - viewport.x) / viewport.zoom,
    y: (client.y - origin.y - viewport.y) / viewport.zoom,
  };
}

describe("touch pan and pinch", () => {
  it("uses the same zoom clamp as the canvas viewport", () => {
    expect(TOUCH_MIN_ZOOM).toBe(MIN_ZOOM);
    expect(TOUCH_MAX_ZOOM).toBe(MAX_ZOOM);
  });

  it("pans from the gesture origin and ignores sub-slop jitter", () => {
    let session = createTouchSession();
    let step = down(session, { id: 1, x: 10, y: 10 }, { viewport: { x: 40, y: 20, zoom: 1 } });
    session = step.session;
    step = stepTouch(session, {
      type: "move",
      pointer: { id: 1, x: 12, y: 11 },
      viewport: { x: 40, y: 20, zoom: 1 },
      origin,
    });
    expect(step.viewport).toBeNull();
    expect(step.session.mode.kind).toBe("pan");
    step = stepTouch(step.session, {
      type: "move",
      pointer: { id: 1, x: 30, y: 50 },
      viewport: { x: 40, y: 20, zoom: 1 },
      origin,
    });
    expect(step.viewport).toEqual({ x: 60, y: 60, zoom: 1 });
    expect(step.suppressClick).toBe(true);
    const ended = stepTouch(step.session, {
      type: "up",
      pointer: { id: 1, x: 30, y: 50 },
      viewport: step.viewport!,
      origin,
    });
    expect(ended.session.mode.kind).toBe("idle");
    expect(ended.suppressClick).toBe(true);
    expect(ended.tapBlank).toBe(false);
  });

  it("replaces an in-progress pan when the second finger lands", () => {
    const viewport = { x: 40, y: 20, zoom: 1 };
    let step = down(createTouchSession(), { id: 1, x: 10, y: 10 }, { viewport });
    step = stepTouch(step.session, { type: "move", pointer: { id: 1, x: 40, y: 10 }, viewport, origin });
    expect(step.session.mode.kind).toBe("pan");
    const panned = step.viewport!;
    step = down(step.session, { id: 2, x: 80, y: 10 }, { viewport: panned });
    expect(step.cancelSingleFinger).toBe(true);
    expect(step.session.mode.kind).toBe("pinch");
    const again = stepTouch(step.session, { type: "move", pointer: { id: 1, x: 70, y: 40 }, viewport: panned, origin });
    expect(again.session.mode.kind).toBe("pinch");
    expect(again.viewport?.zoom).not.toBe(panned.zoom);
  });

  it("does not pan an editable content target, but a second finger cancels that gesture and pinches", () => {
    let session = createTouchSession();
    const viewport = { x: 40, y: 20, zoom: 1 };
    let step = down(session, { id: 1, x: 10, y: 10 }, { kind: "content", panContent: false, viewport });
    expect(step.session.mode.kind).toBe("idle");
    expect(step.cancelSingleFinger).toBe(false);
    expect(step.viewport).toBeNull();
    session = step.session;
    step = down(session, { id: 2, x: 110, y: 10 }, { kind: "content", panContent: false, viewport });
    expect(step.cancelSingleFinger).toBe(true);
    expect(step.session.mode.kind).toBe("pinch");
    expect(step.suppressClick).toBe(true);
    const moved = stepTouch(step.session, {
      type: "move",
      pointer: { id: 2, x: 210, y: 10 },
      viewport,
      origin,
    });
    expect(moved.viewport?.zoom).toBeGreaterThan(1);
    expect(moved.session.mode.kind).toBe("pinch");
  });

  it("keeps the world point under the midpoint stable while spreading and sliding", () => {
    const start = { x: 0, y: 0, zoom: 1 };
    let session = createTouchSession();
    let step = down(session, { id: 1, x: 100, y: 100 }, { viewport: start });
    step = down(step.session, { id: 2, x: 300, y: 100 }, { viewport: start });
    const anchor = worldAt(start, { x: 200, y: 100 });
    const spread = stepTouch(step.session, {
      type: "move",
      pointer: { id: 2, x: 400, y: 100 },
      viewport: start,
      origin,
    });
    // 手指仍在 (100,100) 与 (400,100)，中点 (250, 100) 已经跟着平移过；锚点仍在中点下。
    const mid = { x: 250, y: 100 };
    expect(spread.viewport).not.toBeNull();
    expect(worldAt(spread.viewport!, mid)).toEqual(anchor);

    const slide = stepTouch(spread.session, {
      type: "move",
      pointer: { id: 1, x: 50, y: 80 },
      viewport: spread.viewport!,
      origin,
    });
    const slidMid = { x: (50 + 400) / 2, y: (80 + 100) / 2 };
    expect(worldAt(slide.viewport!, slidMid).x).toBeCloseTo(anchor.x);
    expect(worldAt(slide.viewport!, slidMid).y).toBeCloseTo(anchor.y);
  });

  it("clamps a wide pinch and still pins the anchor under the midpoint", () => {
    const start = { x: 10, y: 20, zoom: 2 };
    const direct = pinchViewport({
      anchorWorld: { x: 40, y: 30 },
      startDistance: 20,
      startZoom: 2,
      midpoint: { x: 90, y: 80 },
      distance: 400,
    });
    expect(direct.zoom).toBe(TOUCH_MAX_ZOOM);
    expect(worldAt(direct, { x: 90, y: 80 })).toEqual({ x: 40, y: 30 });

    let step = down(createTouchSession(), { id: 1, x: 0, y: 0 }, { viewport: start });
    step = down(step.session, { id: 2, x: 20, y: 0 }, { viewport: start });
    const opened = stepTouch(step.session, {
      type: "move",
      pointer: { id: 2, x: 400, y: 0 },
      viewport: start,
      origin,
    });
    expect(opened.viewport?.zoom).toBe(MAX_ZOOM);
    const mid = { x: 200, y: 0 };
    const before = worldAt(start, { x: 10, y: 0 });
    expect(worldAt(opened.viewport!, mid).x).toBeCloseTo(before.x);
    expect(worldAt(opened.viewport!, mid).y).toBeCloseTo(before.y);
  });

  it("a blank tap clears via tapBlank, and a native target never joins the gesture", () => {
    let step = down(createTouchSession(), { id: 1, x: 4, y: 4 }, { viewport: { x: 1, y: 2, zoom: 1 } });
    step = stepTouch(step.session, {
      type: "up",
      pointer: { id: 1, x: 5, y: 4 },
      viewport: { x: 1, y: 2, zoom: 1 },
      origin,
    });
    expect(step.tapBlank).toBe(true);
    expect(step.suppressClick).toBe(false);

    const native = down(createTouchSession(), { id: 7, x: 0, y: 0 }, { kind: "native" });
    expect(native.session.pointers).toHaveLength(0);
    expect(native.session.mode.kind).toBe("idle");
  });
});
