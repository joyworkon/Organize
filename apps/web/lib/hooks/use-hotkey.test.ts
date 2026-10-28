// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasOpenDialog, useHotkeySequence } from "./use-hotkey";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("hasOpenDialog", () => {
  it("版本历史侧栏的 listbox 不是弹层，不挡住编辑器快捷键", () => {
    const list = document.createElement("div");
    list.className = "note-history-listbox";
    list.setAttribute("role", "listbox");
    document.body.append(list);
    expect(hasOpenDialog()).toBe(false);
  });

  it("菜单、对话框和其它 listbox 仍然算弹层", () => {
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.append(menu);
    expect(hasOpenDialog()).toBe(true);
    menu.remove();

    const select = document.createElement("div");
    select.setAttribute("role", "listbox");
    document.body.append(select);
    expect(hasOpenDialog()).toBe(true);
  });
});

function SequenceProbe({ onGo, onBuffer }: { onGo: () => void; onBuffer: (buffer: string[]) => void }) {
  useHotkeySequence([{ sequence: ["g", "l"], handler: onGo }], { onBufferChange: onBuffer });
  return null;
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useHotkeySequence", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    document.body.innerHTML = "";
  });

  function mount(onGo: () => void, onBuffer: (buffer: string[]) => void) {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(createElement(SequenceProbe, { onGo, onBuffer }));
    });
  }

  function key(value: string) {
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
    });
  }

  it("g l 在后续微任务里拼成序列", async () => {
    const onGo = vi.fn();
    const buffers: string[][] = [];
    mount(onGo, (buffer) => buffers.push(buffer));
    key("g");
    await flushMicrotasks();
    expect(buffers.at(-1)).toEqual(["g"]);
    key("l");
    await flushMicrotasks();
    expect(onGo).toHaveBeenCalledTimes(1);
  });

  it("已被 preventDefault 的 g 不进入缓冲，后面的字母不能拼成跳转", async () => {
    const onGo = vi.fn();
    const buffers: string[][] = [];
    mount(onGo, (buffer) => buffers.push(buffer));
    const claim = (event: KeyboardEvent) => {
      if (event.key === "g") event.preventDefault();
    };
    window.addEventListener("keydown", claim);
    key("g");
    await flushMicrotasks();
    key("l");
    await flushMicrotasks();
    window.removeEventListener("keydown", claim);
    expect(onGo).not.toHaveBeenCalled();
    expect(buffers).toEqual([["l"]]);
  });
});
