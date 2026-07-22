import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  buildPresentationSlides,
  isAllowedAIContent,
  isSameNodeSnapshot,
  moveBlockTransaction,
  stripBlockIds,
} from "./block-utils";

describe("block utilities", () => {
  it("clears every nested block id before duplication", () => {
    const copy = stripBlockIds({
      type: "bulletList",
      content: [{
        type: "listItem",
        attrs: { id: "item-1" },
        content: [{ type: "paragraph", attrs: { id: "paragraph-1" } }],
      }],
    });

    expect(copy.content?.[0].attrs?.id).toBeNull();
    expect(copy.content?.[0].content?.[0].attrs?.id).toBeNull();
  });

  it("compares JSONB snapshots without depending on object key order", () => {
    const editorNode = {
      type: "heading",
      attrs: { id: "block-1", level: 1, backgroundColor: null },
    };
    const databaseNode = {
      attrs: { backgroundColor: null, level: 1, id: "block-1" },
      type: "heading",
    };

    expect(isSameNodeSnapshot(editorNode, databaseNode)).toBe(true);
    expect(isSameNodeSnapshot(editorNode, { ...databaseNode, attrs: { ...databaseNode.attrs, level: 2 } })).toBe(false);
  });

  it("groups presentation slides from the selected block using H1/H2 boundaries", () => {
    const slides = buildPresentationSlides({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "intro" }, content: [{ type: "text", text: "忽略" }] },
        { type: "heading", attrs: { id: "chapter-1", level: 1 }, content: [{ type: "text", text: "第一章" }] },
        { type: "paragraph", attrs: { id: "body-1" }, content: [{ type: "text", text: "正文" }] },
        { type: "heading", attrs: { id: "chapter-2", level: 2 }, content: [{ type: "text", text: "第二章" }] },
      ],
    }, "chapter-1");

    expect(slides).toHaveLength(2);
    expect(slides[0]).toMatchObject({ id: "chapter-1", title: "第一章" });
    expect(slides[0].content).toHaveLength(1);
    expect(slides[1]).toMatchObject({ id: "chapter-2", title: "第二章" });
  });

  it("rejects AI nodes outside the editor whitelist", () => {
    expect(isAllowedAIContent([{ type: "paragraph", content: [{ type: "text", text: "安全文本" }] }])).toBe(true);
    expect(isAllowedAIContent([{ type: "image", attrs: { src: "https://example.com/a.png" } }])).toBe(false);
  });

  it("moves complete top-level blocks and nested list items without merging content", () => {
    const schema = getSchema([StarterKit]);
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "一" }] },
        { type: "paragraph", content: [{ type: "text", text: "二" }] },
        { type: "paragraph", content: [{ type: "text", text: "三" }] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "甲" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "乙" }] }] },
          ],
        },
      ],
    });
    const initial = EditorState.create({ doc });
    const secondPos = doc.child(0).nodeSize;
    const thirdPos = secondPos + doc.child(1).nodeSize;
    const afterThird = thirdPos + doc.child(2).nodeSize;
    const topLevelMove = moveBlockTransaction(initial, secondPos, afterThird);

    expect(topLevelMove).not.toBeNull();
    const movedDoc = topLevelMove!.doc;
    expect([0, 1, 2].map((index) => movedDoc.child(index).textContent)).toEqual(["一", "三", "二"]);
    expect(movedDoc.child(3).type.name).toBe("bulletList");

    const listPos = movedDoc.child(0).nodeSize + movedDoc.child(1).nodeSize + movedDoc.child(2).nodeSize;
    const list = movedDoc.child(3);
    const firstItemPos = listPos + 1;
    const secondItemPos = firstItemPos + list.child(0).nodeSize;
    const afterSecondItem = secondItemPos + list.child(1).nodeSize;
    const listMove = moveBlockTransaction(
      EditorState.create({ doc: movedDoc }),
      firstItemPos,
      afterSecondItem
    );

    expect(listMove).not.toBeNull();
    const movedList = listMove!.doc.child(3);
    expect([0, 1].map((index) => movedList.child(index).textContent)).toEqual(["乙", "甲"]);
    expect(moveBlockTransaction(EditorState.create({ doc: movedDoc }), firstItemPos, firstItemPos)).toBeNull();
  });
});
