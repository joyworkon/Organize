// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { createBoardShape } from "./model";
import { NEW_REGION, readCanvasAddTarget, rememberCanvasAddTarget, resolveCanvasAddTarget } from "./add-target-memory";

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
const target = { canvasId: "canvas", boardId: "board", regionId: "region" };

it("round trips the successful destination within the current user only", () => {
  rememberCanvasAddTarget("alice", target);
  expect(readCanvasAddTarget("alice")).toEqual(target);
  expect(readCanvasAddTarget("bob")).toBeNull();
  rememberCanvasAddTarget("", target);
  expect(readCanvasAddTarget("")).toBeNull();
});
it("ignores malformed data and inaccessible/full storage", () => {
  for (const value of ["bad json", "null", "3", '{"canvasId":3}', '{"canvasId":"","boardId":"b","regionId":"r"}']) {
    localStorage.setItem("organize:canvas-add-target:alice", value);
    expect(readCanvasAddTarget("alice")).toBeNull();
  }
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
  expect(readCanvasAddTarget("alice")).toBeNull();
  expect(() => rememberCanvasAddTarget("alice", target)).not.toThrow();
});
it("restores the second page and its exact region; deleted region resets only the region", () => {
  const boards = [createBoardShape({ x: 0, y: 0 }), createBoardShape({ x: 1000, y: 0 })];
  const saved = { boardId: boards[1].id, regionId: boards[1].regions[0].id };
  expect(resolveCanvasAddTarget(boards, saved)).toEqual(saved);
  expect(resolveCanvasAddTarget(boards, { ...saved, regionId: "deleted" })).toEqual({ boardId: saved.boardId, regionId: NEW_REGION });
});
it("deleted page resets to the first page/new region; empty canvas has no target page", () => {
  const board = createBoardShape({ x: 0, y: 0 });
  expect(resolveCanvasAddTarget([board], { boardId: "deleted", regionId: board.regions[0].id })).toEqual({ boardId: board.id, regionId: NEW_REGION });
  expect(resolveCanvasAddTarget([], target)).toEqual({ boardId: "", regionId: NEW_REGION });
});
