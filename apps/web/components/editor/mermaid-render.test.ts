import { beforeEach, describe, expect, it, vi } from "vitest";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string, text: string) => {
    if (/boom/.test(text)) throw new Error("Parse error on line 2");
    if (/plain/.test(text)) return Promise.reject("plain failure");
    return { svg: `<svg id="${id}"><text>${text.split("\n")[0]}</text></svg>` };
  }),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

import { describeMermaidError, loadMermaid, nextMermaidRenderId, renderMermaidPreview } from "./mermaid-render";

describe("renderMermaidPreview", () => {
  beforeEach(() => { mermaid.render.mockClear(); });

  it("returns svg for valid code and a fresh id per call", async () => {
    const first = await renderMermaidPreview("graph TD\n  A --> B");
    const second = await renderMermaidPreview("graph TD\n  A --> B");
    expect(first).toEqual({ svg: expect.stringContaining("<text>graph TD</text>"), error: null });
    expect(second.error).toBeNull();
    const [[idA], [idB]] = mermaid.render.mock.calls;
    expect(idA).not.toBe(idB);
    expect(idA).toMatch(/^organize-mermaid-\d+$/);
  });

  it("honours an explicit id and trims the source before rendering", async () => {
    await renderMermaidPreview("  pie\n  \"a\": 1\n\n", "custom-id");
    expect(mermaid.render).toHaveBeenCalledWith("custom-id", "pie\n  \"a\": 1");
  });

  it("collapses renderer failures into an error string and never throws", async () => {
    await expect(renderMermaidPreview("boom")).resolves.toEqual({ svg: "", error: "Parse error on line 2" });
    await expect(renderMermaidPreview("plain")).resolves.toEqual({ svg: "", error: "plain failure" });
  });

  it("treats empty source as an error without touching mermaid", async () => {
    await expect(renderMermaidPreview("   \n ")).resolves.toEqual({ svg: "", error: "图表源码为空" });
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("initializes mermaid once with strict security and no error diagram rendering", async () => {
    await loadMermaid();
    await loadMermaid();
    await renderMermaidPreview("graph LR\nA-->B");
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true }));
  });
});

describe("helpers", () => {
  it("nextMermaidRenderId is monotonic", () => {
    const a = nextMermaidRenderId(), b = nextMermaidRenderId();
    expect(a).not.toBe(b);
    expect(Number(b.split("-").pop())).toBeGreaterThan(Number(a.split("-").pop()));
  });
  it("describeMermaidError falls back to the error name and String()", () => {
    expect(describeMermaidError(new Error("x"))).toBe("x");
    expect(describeMermaidError(new RangeError(""))).toBe("RangeError");
    expect(describeMermaidError(42)).toBe("42");
  });
});
