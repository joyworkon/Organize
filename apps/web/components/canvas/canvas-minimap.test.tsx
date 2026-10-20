// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Scene } from "@/lib/canvas/layout";
import {
  MINIMAP_STORAGE_KEY,
  centerViewportOn,
  cameraWorldRect,
  containsPoint,
  contentBounds,
  layoutMinimap,
  minimapToWorld,
  viewportFromMinimapPoint,
  viewportMinimapRect,
  type MinimapViewport,
} from "@/lib/canvas/minimap";
import { CanvasMinimap, CanvasMinimapToggle, useMinimapOpen } from "./canvas-minimap";

const VIEW = { width: 800, height: 600 };
const INITIAL: MinimapViewport = { x: 0, y: 0, zoom: 1 };

const scene: Scene = {
  boards: [{ boardId: "b", x: 0, y: 0, width: 2000, height: 800, regions: [] }],
  freeItems: [],
};

let container: HTMLDivElement;
let root: Root;
let latest: MinimapViewport;
let restorePointerEvent: () => void;

function installPointerEvent() {
  const previous = globalThis.PointerEvent;
  if (typeof previous === "function") return () => {};
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "";
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
  return () => {
    globalThis.PointerEvent = previous;
  };
}

function render(node: ReactNode) {
  act(() => {
    root.render(node);
  });
}

function mockSvgBox() {
  const svg = container.querySelector("svg");
  if (!svg) return;
  svg.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 180,
    bottom: 112,
    width: 180,
    height: 112,
    toJSON() { return {}; },
  });
}

function MinimapHarness() {
  const [viewport, setViewport] = useState(INITIAL);
  return (
    <CanvasMinimap
      open
      scene={scene}
      names={{}}
      viewport={viewport}
      viewSize={VIEW}
      onViewport={(next) => {
        latest = next;
        setViewport(next);
      }}
    />
  );
}

function PersistHarness({ narrow }: { narrow: boolean }) {
  const [open, toggle] = useMinimapOpen(narrow);
  return <CanvasMinimapToggle open={open} onToggle={toggle} />;
}

describe("canvas minimap", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    restorePointerEvent = installPointerEvent();
    localStorage.clear();
    latest = INITIAL;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    localStorage.clear();
    restorePointerEvent();
  });

  it("centers the viewport on a clicked world point without changing zoom", () => {
    render(<MinimapHarness />);
    mockSvgBox();
    const layout = layoutMinimap(contentBounds(scene)!);
    const camera = viewportMinimapRect(INITIAL, VIEW, layout);
    expect(containsPoint(camera, 170, 100)).toBe(false);
    const minimap = container.querySelector(".canvas-minimap") as HTMLElement;
    act(() => {
      minimap.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 170, clientY: 100, pointerId: 1 }));
      minimap.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: 170, clientY: 100, pointerId: 1 }));
    });
    const expected = centerViewportOn(minimapToWorld(170, 100, layout), INITIAL, VIEW);
    expect(latest.zoom).toBe(1);
    expect(latest.x).toBeCloseTo(expected.x);
    expect(latest.y).toBeCloseTo(expected.y);
  });

  it("drags the camera frame to pan and leaves zoom unchanged", () => {
    render(<MinimapHarness />);
    mockSvgBox();
    const frame = container.querySelector(".canvas-minimap-camera") as SVGRectElement;
    const startX = Number(frame.getAttribute("x")) + Number(frame.getAttribute("width")) / 2;
    const startY = Number(frame.getAttribute("y")) + Number(frame.getAttribute("height")) / 2;
    const layout = layoutMinimap(contentBounds(scene)!);
    const world = minimapToWorld(startX, startY, layout);
    const seen = cameraWorldRect(INITIAL, VIEW);
    const grab = {
      x: world.x - (seen.x + seen.width / 2),
      y: world.y - (seen.y + seen.height / 2),
    };
    const minimap = container.querySelector(".canvas-minimap") as HTMLElement;
    const nextX = startX + 30;
    const nextY = startY + 20;
    act(() => {
      minimap.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: startX, clientY: startY, pointerId: 3 }));
      minimap.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: nextX, clientY: nextY, pointerId: 3 }));
    });
    const expected = viewportFromMinimapPoint({ x: nextX, y: nextY }, layout, INITIAL, VIEW, grab);
    expect(latest.zoom).toBe(expected.zoom);
    expect(latest.x).toBeCloseTo(expected.x);
    expect(latest.y).toBeCloseTo(expected.y);
    expect(latest.x === INITIAL.x && latest.y === INITIAL.y).toBe(false);
  });

  it("nudges the camera with the arrow keys", () => {
    render(<MinimapHarness />);
    const frame = container.querySelector(".canvas-minimap-camera") as SVGRectElement;
    act(() => {
      frame.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    });
    expect(latest).toEqual({ x: -48, y: 0, zoom: 1 });
  });

  it("shows an empty state and renders nothing while closed", () => {
    const empty: Scene = { boards: [], freeItems: [] };
    render(
      <CanvasMinimap open scene={empty} names={{}} viewport={INITIAL} viewSize={VIEW} onViewport={() => {}} />,
    );
    expect(container.querySelector("[aria-label='画布小地图']")?.textContent).toContain("画布是空的");
    render(
      <CanvasMinimap open={false} scene={scene} names={{}} viewport={INITIAL} viewSize={VIEW} onViewport={() => {}} />,
    );
    expect(container.querySelector("[aria-label='画布小地图']")).toBeNull();
  });

  it("persists the toggle, defaulting open on desktop and closed on a narrow screen", () => {
    render(<PersistHarness narrow={false} />);
    const button = () => container.querySelector("button") as HTMLButtonElement;
    expect(button().getAttribute("aria-pressed")).toBe("true");
    act(() => {
      button().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(localStorage.getItem(MINIMAP_STORAGE_KEY)).toBe("0");
    expect(button().getAttribute("aria-pressed")).toBe("false");

    act(() => root.unmount());
    root = createRoot(container);
    render(<PersistHarness narrow={false} />);
    expect(button().getAttribute("aria-pressed")).toBe("false");

    localStorage.clear();
    act(() => root.unmount());
    root = createRoot(container);
    render(<PersistHarness narrow />);
    expect(button().getAttribute("aria-pressed")).toBe("false");

    localStorage.setItem(MINIMAP_STORAGE_KEY, "1");
    act(() => root.unmount());
    root = createRoot(container);
    render(<PersistHarness narrow />);
    expect(button().getAttribute("aria-pressed")).toBe("true");
  });
});
