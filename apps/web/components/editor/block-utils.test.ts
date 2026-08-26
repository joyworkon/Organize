import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import UniqueID from "@tiptap/extension-unique-id";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  buildPresentationSlides,
  isAllowedAIContent,
  isSameNodeSnapshot,
  moveBlockTransaction,
  stripBlockIds,
} from "./block-utils";
import { buildBlockReplacement, preserveBlockId } from "./block-commands";

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

  it("preserves the logical block id when transforming text into a list", () => {
    const transformed = preserveBlockId({
      type: "orderedList",
      content: [{
        type: "listItem",
        content: [{ type: "paragraph" }],
      }],
    }, "block-1");

    expect(transformed.attrs?.id).toBeUndefined();
    expect(transformed.content?.[0].attrs?.id).toBe("block-1");
    expect(transformed.content?.[0].content?.[0].attrs?.id).toBeUndefined();
  });

  it("preserves the id on a direct text-block conversion", () => {
    const transformed = preserveBlockId({ type: "heading", attrs: { level: 2 } }, "block-2");
    expect(transformed.attrs).toMatchObject({ id: "block-2", level: 2 });
  });

  it("replaces a paragraph with exactly one list at the same document position", () => {
    const schema = getSchema([
      StarterKit,
      UniqueID.configure({ types: ["paragraph", "heading", "listItem"] }),
    ]);
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "block-list" },
          content: [{ type: "text", text: "第一项" }],
        },
        {
          type: "paragraph",
          attrs: { id: "block-next" },
          content: [{ type: "text", text: "下一块" }],
        },
      ],
    });
    const source = doc.child(0);
    const replacement = buildBlockReplacement(source, {
      type: "orderedList",
      content: [{
        type: "listItem",
        content: [{ type: "paragraph" }],
      }],
    });
    const transaction = EditorState.create({ doc }).tr.replaceWith(
      0,
      source.nodeSize,
      schema.nodeFromJSON(replacement)
    );

    expect(transaction.doc.childCount).toBe(2);
    expect(transaction.doc.child(0).type.name).toBe("orderedList");
    expect(transaction.doc.child(0).child(0).attrs.id).toBe("block-list");
    expect(transaction.doc.child(0).textContent).toBe("第一项");
    expect(transaction.doc.child(1).textContent).toBe("下一块");
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

  it("backfills an empty paragraph when the only child is dragged out of details content", async () => {
    const { default: Details } = await import("@tiptap/extension-details");
    const { default: DetailsContent } = await import("@tiptap/extension-details-content");
    const { default: DetailsSummary } = await import("@tiptap/extension-details-summary");
    const schema = getSchema([StarterKit, Details, DetailsContent, DetailsSummary]);
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "外部" }] },
        {
          type: "details",
          content: [
            { type: "detailsSummary", content: [{ type: "text", text: "折叠" }] },
            {
              type: "detailsContent",
              content: [{ type: "paragraph", content: [{ type: "text", text: "唯一块" }] }],
            },
          ],
        },
      ],
    });
    const state = EditorState.create({ doc });
    // 结构：doc(0) > paragraph「外部」| details > detailsSummary | detailsContent > paragraph「唯一块」
    const detailsPos = doc.child(0).nodeSize;
    const details = doc.child(1);
    const detailsContentPos = detailsPos + 1 + details.child(0).nodeSize;
    const innerPos = detailsContentPos + 1;

    // 把唯一子块拖到折叠块之后（顶层）：原内容区应补一个空段落，而不是被掏空
    const afterDetails = detailsPos + details.nodeSize;
    const moveOut = moveBlockTransaction(state, innerPos, afterDetails);
    expect(moveOut).not.toBeNull();
    const movedDetails = moveOut!.doc.child(1);
    expect(movedDetails.type.name).toBe("details");
    const content = movedDetails.child(1);
    expect(content.childCount).toBe(1);
    expect(content.child(0).type.name).toBe("paragraph");
    expect(content.child(0).textContent).toBe("");
    expect(moveOut!.doc.child(2).textContent).toBe("唯一块");

    // 目标落在源块内部（拖进自己）：不动作
    expect(moveBlockTransaction(state, detailsPos, innerPos)).toBeNull();

    // 顶层块拖进折叠内容区：插到内容区子块之前
    const moveIn = moveBlockTransaction(state, 0, innerPos);
    expect(moveIn).not.toBeNull();
    const targetContent = moveIn!.doc.child(0).child(1);
    expect(targetContent.childCount).toBe(2);
    expect(targetContent.child(0).textContent).toBe("外部");
    expect(targetContent.child(1).textContent).toBe("唯一块");
  });
});
