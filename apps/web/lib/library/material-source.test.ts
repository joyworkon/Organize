// 阶段 E：material-source 纯函数（快照标题/摘录/HTML 取图/消毒）
import { describe, expect, it } from "vitest";
import {
  excerptSnapshot,
  firstImageSrcFromHtml,
  firstLine,
  sourceRefFromLibraryItem,
  stripHtml,
} from "./material-source";
import type { LibraryItem } from "@organize/shared";

const item = (over: Partial<LibraryItem> = {}): LibraryItem => ({
  id: "r1",
  source_type: "reading",
  title: "文章标题",
  excerpt: "摘要文字",
  url: "https://example.com/a",
  tags: [],
  is_pinned: false,
  reading_status: "unread",
  reading_progress: 0,
  is_link_only: false,
  created_at: "2026-09-22T00:00:00Z",
  ...over,
});

describe("material-source", () => {
  it("firstLine：取首行去空白；空文本回退空串", () => {
    expect(firstLine("  标题行\n第二行")).toBe("标题行");
    expect(firstLine("\n\n")).toBe("");
    expect(firstLine("单行")).toBe("单行");
  });

  it("excerptSnapshot：截断到 500 字并加省略号；短文本原样", () => {
    const long = "字".repeat(600);
    const snap = excerptSnapshot(long);
    expect(snap.length).toBe(501);
    expect(snap.endsWith("…")).toBe(true);
    expect(excerptSnapshot("短文本")).toBe("短文本");
    expect(excerptSnapshot("  去空白  ")).toBe("去空白");
  });

  it("firstImageSrcFromHtml：取第一张图 src 与 alt；无图为 null", () => {
    expect(firstImageSrcFromHtml('<p>x</p><img src="/storage/a.png" alt="图A">'))
      .toEqual({ src: "/storage/a.png", alt: "图A" });
    expect(firstImageSrcFromHtml("<img src='https://cdn.x/y.jpg'>"))
      ?.toEqual({ src: "https://cdn.x/y.jpg", alt: "" });
    expect(firstImageSrcFromHtml("<p>无图</p>")).toBeNull();
    expect(firstImageSrcFromHtml("<img>")).toBeNull();
  });

  it("stripHtml：块级换行、去标签、解实体", () => {
    expect(stripHtml("<p>甲</p><p>乙</p>")).toBe("甲\n乙");
    expect(stripHtml("甲<br>乙")).toBe("甲\n乙");
    expect(stripHtml("<p>A &amp; B &lt;C&gt; &quot;D&quot;</p>")).toBe('A & B <C> "D"');
  });

  it("sourceRefFromLibraryItem：reading 用标题；memo 用正文首行", () => {
    const r = sourceRefFromLibraryItem(item());
    expect(r.kind).toBe("reading");
    expect(r.title).toBe("文章标题");
    expect(r.url).toBe("https://example.com/a");
    expect(r.updatedAt).toBeTruthy();

    const m = sourceRefFromLibraryItem(
      item({ source_type: "memo", title: null, excerpt: "速记第一行\n第二行", url: null }),
    );
    expect(m.kind).toBe("memo");
    expect(m.title).toBe("速记第一行");
    expect(m.url).toBe("");
  });
});
