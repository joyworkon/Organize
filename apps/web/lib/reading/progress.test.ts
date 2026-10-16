import { describe, expect, it } from "vitest";
import { nextReadingProgress } from "./progress";

describe("nextReadingProgress", () => {
  it("only moves forward", () => {
    expect(nextReadingProgress(40, 0.5, "reading")).toBeNull();
    expect(nextReadingProgress(50, 0.5, "reading")).toBeNull();
    expect(nextReadingProgress(60, 0.5, "reading")).toEqual({ progress: 0.6, status: "reading" });
  });
  it("marks read at 95% and reading after 5%", () => {
    expect(nextReadingProgress(95, 0, "reading")).toEqual({ progress: 0.95, status: "read" });
    expect(nextReadingProgress(10, 0, "unread")).toEqual({ progress: 0.1, status: "reading" });
    expect(nextReadingProgress(3, 0, "unread")).toEqual({ progress: 0.03, status: "unread" });
  });
  it("stores the same rounded value it compares with", () => {
    expect(nextReadingProgress(33.333, 0, "reading")?.progress).toBe(0.33);
    expect(nextReadingProgress(33.4, 0.33, "reading")).toBeNull();
  });
});
