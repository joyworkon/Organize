// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findAndWrapHighlightText, focusHighlight } from "./highlight-locate";

function renderArticle(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const markSelector = "mark.hl-yellow, mark.hl-green, mark.hl-blue, mark.hl-pink, mark.hl-purple";

describe("findAndWrapHighlightText", () => {
  it("单段落内纯文本：包裹为对应颜色 mark", () => {
    const root = renderArticle("<p>前缀内容</p><p>这是需要定位的目标句子</p><p>后缀</p>");
    const target = findAndWrapHighlightText(root, "这是需要定位的目标句子", "green");
    expect(target).not.toBeNull();
    expect(target!.marked).toBe(true);
    const mark = root.querySelector(markSelector);
    expect(mark).not.toBeNull();
    expect(mark!.className).toBe("hl-green");
    expect(mark!.textContent).toBe("这是需要定位的目标句子");
  });

  it("跨内联节点（文本+strong+文本）命中并保持结构", () => {
    const root = renderArticle("<p>前半<strong>加粗目标</strong>后半</p>");
    const target = findAndWrapHighlightText(root, "前半加粗目标后半", "yellow");
    expect(target).not.toBeNull();
    expect(target!.marked).toBe(true);
    const mark = root.querySelector("mark.hl-yellow");
    expect(mark).not.toBeNull();
    expect(mark!.querySelector("strong")?.textContent).toBe("加粗目标");
    expect(mark!.textContent).toBe("前半加粗目标后半");
  });

  it("HTML 空白与选中正文空白不一致时按归一化匹配", () => {
    const root = renderArticle(
      "<p>段首\n   跨行\n  目标词 仍应命中\n 尾部</p>"
    );
    const target = findAndWrapHighlightText(root, "段首 跨行 目标词 仍应命中 尾部", "blue");
    expect(target).not.toBeNull();
    expect(target!.marked).toBe(true);
    expect(root.querySelector("mark.hl-blue")?.textContent).toBe(
      "段首\n   跨行\n  目标词 仍应命中\n 尾部"
    );
  });

  it("跨块级元素：不包裹，降级返回起始块元素", () => {
    const root = renderArticle("<p>第一段开头</p><p>第二段结尾</p>");
    const target = findAndWrapHighlightText(root, "第一段开头第二段结尾", "pink");
    expect(target).not.toBeNull();
    expect(target!.marked).toBe(false);
    expect(target!.el.tagName).toBe("P");
    expect(target!.el.textContent).toBe("第一段开头");
    expect(root.querySelector(markSelector)).toBeNull();
  });

  it("正文里匹配不到时返回 null", () => {
    const root = renderArticle("<p>完全无关的正文</p>");
    expect(findAndWrapHighlightText(root, "不存在的内容", "yellow")).toBeNull();
  });

  it("连续空白折叠后命中：多个空格等价于单个空格", () => {
    const root = renderArticle("<p>hello   world</p>");
    const target = findAndWrapHighlightText(root, "hello world", "purple");
    expect(target).not.toBeNull();
    expect(target!.marked).toBe(true);
  });
});

describe("focusHighlight", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("立即与 600ms 各滚动一次，1500ms 后移除闪烁样式", () => {
    const el = document.createElement("mark");
    focusHighlight(el);
    expect(el.classList.contains("ring-2")).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(600);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(900);
    expect(el.classList.contains("ring-2")).toBe(false);
    expect(el.classList.contains("ring-primary")).toBe(false);
    expect(el.classList.contains("ring-offset-1")).toBe(false);
  });
});
