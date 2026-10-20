// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { zoomToFit, zoomToFitBounds } from "./canvas-viewport";

describe("zoomToFitBounds", () => {
  it("只框选区，保留120px边距并居中，负坐标也成立", () => {
    const set = vi.fn();
    zoomToFitBounds({ x: -300, y: 200, width: 1000, height: 400 }, set, { width: 920, height: 720 });
    expect(set).toHaveBeenCalledWith({ zoom: 0.8, x: 300, y: 40 });
  });
  it("不超过100%，巨大选区遵守10%下限", () => {
    const set = vi.fn();
    zoomToFitBounds({ x: 0, y: 0, width: 10, height: 10 }, set, { width: 900, height: 700 });
    expect(set.mock.calls[0][0].zoom).toBe(1);
    zoomToFitBounds({ x: 0, y: 0, width: 100000, height: 100000 }, set, { width: 900, height: 700 });
    expect(set.mock.calls[1][0].zoom).toBe(0.1);
  });
  it("空选区 no-op，适合全部空场景仍重置视口", () => {
    const set = vi.fn();
    zoomToFitBounds(null, set, { width: 900, height: 700 });
    zoomToFitBounds({ x: 0, y: 0, width: 0, height: 0 }, set, { width: 900, height: 700 });
    expect(set).not.toHaveBeenCalled();
    zoomToFit({ boards: [], freeItems: [] }, set, { width: 900, height: 700 });
    expect(set).toHaveBeenCalledWith({ x: 40, y: 40, zoom: 1 });
  });
});
