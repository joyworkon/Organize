// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresentationMode } from "./presentation-mode";

describe("PresentationMode", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("turns pages with arrow keys and exits with Escape", () => {
    const onClose = vi.fn();
    act(() => root.render(
      createElement(PresentationMode, {
        startBlockId: "chapter-1",
        onClose,
        doc: {
          type: "doc",
          content: [
            { type: "heading", attrs: { id: "chapter-1", level: 1 }, content: [{ type: "text", text: "第一章" }] },
            { type: "paragraph", attrs: { id: "body-1" }, content: [{ type: "text", text: "第一页正文" }] },
            { type: "heading", attrs: { id: "chapter-2", level: 2 }, content: [{ type: "text", text: "第二章" }] },
            { type: "paragraph", attrs: { id: "body-2" }, content: [{ type: "text", text: "第二页正文" }] },
          ],
        },
      })
    ));

    expect(container.textContent).toContain("第一章");
    expect(container.textContent).toContain("第一页正文");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })));
    expect(container.textContent).toContain("第二章");
    expect(container.textContent).toContain("第二页正文");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
