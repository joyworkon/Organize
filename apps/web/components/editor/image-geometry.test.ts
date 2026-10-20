import { describe, expect, it } from "vitest";
import { clampWidth, currentPreset, draggedWidth, fitScale, keyboardWidth, pinchTransform, presetWidth, constrainTransform, zoomTransform } from "./image-geometry";

describe("image widths", () => {
  it("converts presets to existing pixel/null attributes and identifies the active preset", () => {
    expect([null, 50, 75, 100].map((p) => presetWidth(p as 50 | 75 | 100 | null, 760))).toEqual([null, 380, 570, 760]);
    expect(currentPreset(null, 760)).toBeNull();
    expect(currentPreset(380, 760)).toBe(50);
    expect(currentPreset(444, 760)).toBeUndefined();
    expect(presetWidth(50, 80)).toBe(80);
  });
  it("clamps both handles in narrow containers", () => {
    expect(draggedWidth(320, 80, "left", 760)).toBe(240);
    expect(draggedWidth(320, 80, "right", 760)).toBe(400);
    expect(clampWidth(999, 760)).toBe(760);
    expect(clampWidth(0, 760)).toBe(96);
    expect(clampWidth(999, 60)).toBe(60);
  });
  it("handles arrows, Shift, Home and End", () => {
    expect(keyboardWidth(320, "ArrowRight", false, 760)).toBe(336);
    expect(keyboardWidth(320, "ArrowLeft", true, 760)).toBe(256);
    expect(keyboardWidth(320, "Home", false, 760)).toBe(96);
    expect(keyboardWidth(320, "End", false, 760)).toBe(760);
    expect(keyboardWidth(320, "Escape", false, 760)).toBeNull();
  });
});
describe("image viewer geometry", () => {
  const image = { width: 2000, height: 1000 }, viewport = { width: 1000, height: 600 };
  it("fits large images and keeps smaller images at natural size", () => {
    expect(fitScale(image, viewport)).toBe(.5);
    expect(fitScale(viewport, image)).toBe(1);
  });
  it("clamps panning to visible image bounds", () => {
    expect(constrainTransform({ x: 999, y: -999, scale: 1 }, image, viewport)).toEqual({ x: 500, y: -200, scale: 1 });
    expect(constrainTransform({ x: 999, y: -999, scale: .5 }, image, viewport)).toEqual({ x: 0, y: -0, scale: .5 });
  });
  it("zooms around the cursor and limits extreme scales", () => {
    expect(zoomTransform({ x: 0, y: 0, scale: .5 }, 1, { x: 100, y: 0 }, image, viewport)).toEqual({ x: -100, y: 0, scale: 1 });
    expect(zoomTransform({ x: 0, y: 0, scale: 1 }, 100, { x: 0, y: 0 }, image, viewport).scale).toBe(8);
  });
  it("pinches to zoom and follows the moving midpoint", () => {
    expect(pinchTransform({ x: 0, y: 0, scale: .5 }, [{ x: -50, y: 0 }, { x: 50, y: 0 }], [{ x: -80, y: 20 }, { x: 120, y: 20 }], image, viewport)).toEqual({ scale: 1, x: 20, y: 20 });
  });
});
