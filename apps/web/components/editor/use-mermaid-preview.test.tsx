// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Deferred = { resolve: (svg: string) => void; reject: (error: unknown) => void };
const mermaid = vi.hoisted(() => {
  const queue: Deferred[] = [];
  return {
    queue,
    initialize: vi.fn(),
    render: vi.fn((id: string, text: string) => {
      if (/boom/.test(text)) return Promise.reject(new Error("Parse error on line 1"));
      if (/defer/.test(text)) return new Promise<{ svg: string }>((resolve, reject) => queue.push({ resolve: (svg) => resolve({ svg }), reject }));
      return Promise.resolve({ svg: `<svg id="${id}"><text>${text.split("\n")[0]}</text></svg>` });
    }),
  };
});
vi.mock("mermaid", () => ({ default: mermaid }));

import { useMermaidPreview, type MermaidPreviewOptions, type MermaidPreviewState } from "./use-mermaid-preview";

function Probe({ code, options }: { code: string; options?: MermaidPreviewOptions }) {
  const state = useMermaidPreview(code, options);
  return <pre data-testid="state">{JSON.stringify(state)}</pre>;
}

describe("useMermaidPreview", () => {
  let root: Root, host: HTMLDivElement;
  const state = (): MermaidPreviewState => JSON.parse(host.querySelector("pre")!.textContent!);
  const render = (code: string, options?: MermaidPreviewOptions) => act(() => root.render(<Probe code={code} options={options} />));
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mermaid.render.mockClear(); mermaid.queue.length = 0;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("renders immediately without debounce and reports pending until the svg lands", async () => {
    await render("defer graph");
    expect(state()).toMatchObject({ svg: "", error: null, pending: true });
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    await act(async () => { mermaid.queue[0].resolve("<svg>graph</svg>"); }); await flush();
    expect(state()).toEqual({ svg: "<svg>graph</svg>", error: null, pending: false });
  });

  it("debounces edits and only renders the latest draft", async () => {
    await render("graph TD\nA-->B", { debounceMs: 250 });
    await act(async () => { vi.advanceTimersByTime(250); }); await flush();
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    await render("graph LR\nA-->B", { debounceMs: 250 });
    await act(async () => { vi.advanceTimersByTime(200); });
    await render("graph RL\nA-->B", { debounceMs: 250 });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    expect(state().pending).toBe(true);
    await act(async () => { vi.advanceTimersByTime(50); }); await flush();
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    expect(mermaid.render).toHaveBeenLastCalledWith(expect.any(String), "graph RL\nA-->B");
    expect(state()).toMatchObject({ svg: expect.stringContaining("graph RL"), pending: false });
  });

  it("keeps the last good svg on failure only when asked", async () => {
    await render("graph TD\nA-->B", { keepLastSvg: true }); await flush();
    const good = state().svg;
    await render("boom", { keepLastSvg: true }); await flush();
    expect(state()).toEqual({ svg: good, error: "Parse error on line 1", pending: false });
    await render("boom", { keepLastSvg: false }); await flush();
    expect(state()).toEqual({ svg: "", error: "Parse error on line 1", pending: false });
    await render("graph TD\nA-->B"); await flush();
    expect(state().error).toBeNull();
  });

  it("discards results that arrive after a newer render started", async () => {
    await render("defer one"); await flush();
    await render("defer two"); await flush();
    expect(mermaid.queue).toHaveLength(2);
    await act(async () => { mermaid.queue[1].resolve("<svg>two</svg>"); }); await flush();
    expect(state()).toMatchObject({ svg: "<svg>two</svg>", pending: false });
    await act(async () => { mermaid.queue[0].resolve("<svg>one</svg>"); }); await flush();
    expect(state().svg).toBe("<svg>two</svg>");
  });

  it("is idle for empty source or when disabled, and resets when disabled after a render", async () => {
    await render("   "); await flush();
    expect(state()).toEqual({ svg: "", error: null, pending: false });
    await render("graph TD\nA-->B", { enabled: false }); await flush();
    expect(mermaid.render).not.toHaveBeenCalled();
    await render("graph TD\nA-->B", { enabled: true }); await flush();
    expect(state().svg).toContain("graph TD");
    await render("graph TD\nA-->B", { enabled: false }); await flush();
    expect(state()).toEqual({ svg: "", error: null, pending: false });
  });
});
