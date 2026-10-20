// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ImageViewer } from "./image-viewer";
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
}
describe("ImageViewer", () => {
  let root: Root, host: HTMLDivElement;
  const close = vi.fn(), focus = vi.fn();
  const stage = () => document.querySelector<HTMLDivElement>(".organize-image-viewer-stage")!;
  const image = () => document.querySelector<HTMLImageElement>(".organize-image-viewer-stage img")!;
  function click(label: string) {
    act(() => [...document.querySelectorAll<HTMLButtonElement>("button")].find((e) => e.getAttribute("aria-label") === label || e.textContent === label)!.click());
  }
  function pointer(type: string, id: number, x: number, y: number) { act(() => image().dispatchEvent(new TestPointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true }))); }
  const scale = () => Number(stage().dataset.scale);
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    close.mockReset(); focus.mockReset(); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    Element.prototype.setPointerCapture = vi.fn();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000); vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(2000); vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(1000);
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    act(() => root.render(<ImageViewer src="https://example.com/a.png" alt="图片说明" onClose={close} returnFocus={focus} />));
    act(() => image().dispatchEvent(new Event("load")));
  });
  afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  it("uses a body portal and fits, zooms, toggles natural size and shows alt", () => {
    expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(document.body.textContent).toContain("图片说明"); expect(scale()).toBe(.5);
    click("放大图片"); expect(scale()).toBe(.625); click("缩小图片"); expect(scale()).toBe(.5);
    act(() => image().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))); expect(scale()).toBe(1);
    act(() => image().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))); expect(scale()).toBe(.5);
    act(() => stage().dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }))); expect(scale()).toBeGreaterThan(.5);
    click("适应屏幕"); expect(scale()).toBe(.5);
  });
  it("pans, clamps boundaries and supports two pointer pinch", () => {
    click("100%"); pointer("pointerdown", 1, 0, 0); pointer("pointermove", 1, 100, 50); pointer("pointerup", 1, 100, 50);
    expect(image().style.transform).toContain("translate(100px, 50px)");
    click("适应屏幕"); pointer("pointerdown", 1, -50, 0); pointer("pointerdown", 2, 50, 0); pointer("pointermove", 2, 150, 0);
    expect(scale()).toBe(1); pointer("pointercancel", 1, 0, 0); pointer("pointercancel", 2, 0, 0);
  });
  it("closes on Escape, backdrop and button, and restores focus on unmount", async () => {
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); expect(close).toHaveBeenCalledTimes(1);
    act(() => stage().click()); expect(close).toHaveBeenCalledTimes(2); click("关闭图片查看器"); expect(close).toHaveBeenCalledTimes(3);
    await act(async () => { root.render(null); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); }); expect(focus).toHaveBeenCalled();
  });
});
