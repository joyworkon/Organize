import { describe, expect, it } from "vitest";
import {
  extractLinksFromContent,
  internalLinkKeyFromHref,
} from "./note-links";

describe("note links", () => {
  it("从带查询和块 hash 的站内地址生成统一 key", () => {
    expect(internalLinkKeyFromHref("/notes/note-1?view=full#block-a")).toBe("note:note-1");
    expect(internalLinkKeyFromHref("/library/read%20one#highlight")).toBe("reading:read one");
    expect(internalLinkKeyFromHref("https://example.com")).toBeNull();
  });

  it("提取、解码并去重正文站内链接", () => {
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "链接",
              marks: [
                { type: "link", attrs: { href: "/notes/note%201#block-a" } },
                { type: "link", attrs: { href: "/notes/note%201?mode=peek" } },
              ],
            },
            {
              type: "text",
              text: "阅读",
              marks: [{ type: "link", attrs: { href: "/library/read-1" } }],
            },
          ],
        },
      ],
    };

    expect(extractLinksFromContent(content)).toEqual([
      { type: "note", url: "note 1" },
      { type: "reading", url: "read-1" },
    ]);
  });

  it("畸形编码不会导致正文渲染或点击崩溃", () => {
    expect(internalLinkKeyFromHref("/notes/%E0%A4%A")).toBe("note:%E0%A4%A");
  });
});
