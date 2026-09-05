// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderNoteExport, downloadNoteExport } from "./note-export";

const docOf = (...content: unknown[]) => ({ type: "doc", content });
const paraOf = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("renderNoteExport：本地快照渲染", () => {
  it("离线编辑后导出包含最新本地文字（不依赖网络保存）", () => {
    const snapshot = {
      title: "离线笔记",
      content: docOf(paraOf("断网后输入的唯一文字辛丑")),
    };
    const rendered = renderNoteExport(snapshot);
    expect(rendered.markdown).toContain("断网后输入的唯一文字辛丑");
  });

  it("保存冲突时导出的是传入的本地快照内容", () => {
    // 冲突场景：服务器内容与本地不同；导出函数只看快照，不偷偷拉服务器版本
    const localSnapshot = {
      title: "冲突笔记",
      content: docOf(paraOf("本地版本唯一文字壬寅")),
    };
    const rendered = renderNoteExport(localSnapshot);
    expect(rendered.markdown).toContain("本地版本唯一文字壬寅");
    expect(rendered.markdown).not.toContain("服务器版本");
  });

  it("快照引用在渲染后不被修改", () => {
    const content = docOf(paraOf("不可变检查"));
    const snapshot = { title: "t", content };
    renderNoteExport(snapshot);
    expect(snapshot.content).toBe(content);
  });

  it("中文标题保留，非法文件名字符替换为下划线（全角冒号合法保留）", () => {
    const rendered = renderNoteExport({ title: "中文：标题?Alpha", content: null });
    expect(rendered.filename).toBe("中文：标题_Alpha");
  });

  it("标题回退：markdown 用“无标题”，文件名用 note", () => {
    const rendered = renderNoteExport({ title: "", content: docOf(paraOf("x")) }, "回退标题");
    expect(rendered.markdown).toContain("# 回退标题");
    expect(rendered.filename).toBe("回退标题");

    const empty = renderNoteExport({ title: "", content: null });
    expect(empty.markdown).toBe("# 无标题\n");
    expect(empty.filename).toBe("note");
  });

  it("降级警告与正文分离返回（数据库块仅引用）", () => {
    const rendered = renderNoteExport({
      title: "含数据库",
      content: docOf({ type: "databaseBlock", attrs: { databaseId: "db-9" } }),
    });
    expect(rendered.markdown).toContain("db-9");
    expect(rendered.warnings.some((w) => w.code === "database-rows-excluded")).toBe(true);
  });
});

describe("downloadNoteExport：触发下载", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("调用浏览器下载（Blob + 锚点），并返回渲染结果", () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const appendChild = vi.spyOn(document.body, "appendChild");
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") {
        (el as HTMLAnchorElement).click = clickSpy;
      }
      return el;
    });

    const rendered = downloadNoteExport({
      title: "下载笔记",
      content: docOf(paraOf("下载内容唯一文字癸卯")),
    });

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(appendChild).toHaveBeenCalledOnce();
    expect(rendered.filename).toBe("下载笔记");
    expect(rendered.markdown).toContain("下载内容唯一文字癸卯");
  });
});
