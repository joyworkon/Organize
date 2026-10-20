// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { hasOpenDialog } from "./use-hotkey";

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
