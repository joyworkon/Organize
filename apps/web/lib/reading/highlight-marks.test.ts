// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { canWriteReadingState, findHighlightMarks, unwrapMark } from "./progress";

describe("findHighlightMarks / unwrapMark", () => {
  it("removes only the mark with the given id even when text repeats", () => {
    document.body.innerHTML =
      '<div id="c"><p><mark class="hl-yellow" data-highlight-id="a">重复文本</mark></p>' +
      '<p><mark class="hl-yellow" data-highlight-id="b">重复文本</mark></p></div>';
    findHighlightMarks(document, "b").forEach(unwrapMark);
    const marks = Array.from(document.querySelectorAll("mark")).map((m) => (m as HTMLElement).dataset.highlightId);
    expect(marks).toEqual(["a"]);
    expect(document.querySelectorAll("p")[1].textContent).toBe("重复文本");
  });
  it("ignores marks without an id", () => {
    document.body.innerHTML = '<p><mark class="hl-yellow">x</mark></p>';
    expect(findHighlightMarks(document, "x")).toEqual([]);
  });
});

describe("canWriteReadingState", () => {
  it("only lets the owner write status/progress", () => {
    expect(canWriteReadingState("u1", "u1")).toBe(true);
    expect(canWriteReadingState("owner", "viewer")).toBe(false);
    expect(canWriteReadingState("owner", null)).toBe(false);
    expect(canWriteReadingState(null, "u1")).toBe(false);
  });
});
