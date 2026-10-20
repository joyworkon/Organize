// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { highlightMatch } from "./highlight-match";

const html = (text: string, query: string) => renderToStaticMarkup(<>{highlightMatch(text, query)}</>);

describe("highlightMatch（菜单项标签命中高亮）", () => {
  it("wraps the first case-insensitive hit in <mark> and leaves the rest untouched", () => {
    expect(html("标题 1", "标题")).toBe("<mark>标题</mark> 1");
    expect(html("HTML · 嵌入", "html")).toBe("<mark>HTML</mark> · 嵌入");
    expect(html("数据库（行内）", "行内")).toBe("数据库（<mark>行内</mark>）");
    expect(html("折叠标题 1", " 标题 ")).toBe("折叠<mark>标题</mark> 1");
  });

  it("returns plain text when the label has no hit (keyword/description matches) or the query is empty", () => {
    expect(html("标题 1", "h1")).toBe("标题 1");
    expect(html("标题 1", "")).toBe("标题 1");
    expect(html("标题 1", "   ")).toBe("标题 1");
    expect(html("", "x")).toBe("");
  });
});
