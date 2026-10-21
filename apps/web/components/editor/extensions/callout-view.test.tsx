// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Callout, CalloutView } from "./callout";

describe("Callout 图标选择器权限", () => {
  let editor: Editor;
  let root: Root;
  let host: HTMLDivElement;
  const updateAttributes = vi.fn();
  const trigger = () => host.querySelector<HTMLButtonElement>(".callout-emoji")!;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    updateAttributes.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    editor = new Editor({
      extensions: [StarterKit, Callout],
      content: { type: "doc", content: [{ type: "callout", content: [{ type: "paragraph" }] }] },
    });
    act(() => root.render(<CalloutView {...{
      editor, node: editor.state.doc.firstChild!, updateAttributes,
    } as unknown as NodeViewProps} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    editor.destroy();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("撤销编辑权限会关闭已打开的选择器、禁用图标并阻止修改", () => {
    act(() => trigger().click());
    expect(document.querySelector(".callout-icon-popover")).not.toBeNull();
    const tone = document.querySelector<HTMLButtonElement>('.callout-tone-row [data-tone="warning"]')!;
    act(() => editor.setEditable(false));
    expect(trigger().disabled).toBe(true);
    expect(document.querySelector(".callout-icon-popover")).toBeNull();
    act(() => { tone.click(); trigger().click(); });
    expect(updateAttributes).not.toHaveBeenCalled();
    expect(document.querySelector(".callout-icon-popover")).toBeNull();
    act(() => editor.setEditable(true));
    expect(trigger().disabled).toBe(false);
  });
});
