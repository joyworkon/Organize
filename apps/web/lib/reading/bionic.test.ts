// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { bionicProcessText } from "./bionic";

function render(html: string) {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}

describe("bionic text preserves content", () => {
  for (const source of ["A & B < C > D", "literal &amp; &lt; entities", "中文段落：React 18 / 2026。", '<img src=x onerror="alert(1)"> & 内容']) {
    it(`fallback round-trips ${source}`, () => {
      const result = render(bionicProcessText(source, null));
      expect(result.textContent).toBe(source);
      expect(result.querySelectorAll("b").length).toBeGreaterThan(0);
      expect(result.querySelector("img, script")).toBeNull();
    });
  }
  it("Segmenter also preserves entities and punctuation", () => {
    const source = "Reading & 中文 <代码> is 100%";
    expect(render(bionicProcessText(source)).textContent).toBe(source);
  });
});
