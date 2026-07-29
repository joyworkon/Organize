// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
  findListParent,
  ListStyleExtension,
  setListStyle,
} from "./list-style";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("ListStyleExtension", () => {
  it("persists an ordered list style in JSON and HTML", () => {
    editor = new Editor({
      extensions: [StarterKit, ListStyleExtension],
      content: {
        type: "doc",
        content: [
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
              },
            ],
          },
        ],
      },
    });

    expect(setListStyle(editor, 1, "lower-roman")).toBe(true);
    expect(editor.getJSON().content?.[0].attrs?.listStyle).toBe("lower-roman");
    expect(editor.getHTML()).toContain('data-list-style="lower-roman"');
  });

  it("finds the containing bullet list from a list item position", () => {
    editor = new Editor({
      extensions: [StarterKit, ListStyleExtension],
      content: {
        type: "doc",
        content: [
          {
            type: "bulletList",
            attrs: { listStyle: "square" },
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }],
              },
            ],
          },
        ],
      },
    });

    expect(findListParent(editor.state.doc, 1)).toMatchObject({
      pos: 0,
      type: "bulletList",
      style: "square",
    });
  });

  it("rejects a marker style from the other list family", () => {
    editor = new Editor({
      extensions: [StarterKit, ListStyleExtension],
      content: {
        type: "doc",
        content: [
          {
            type: "orderedList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph" }],
              },
            ],
          },
        ],
      },
    });

    expect(setListStyle(editor, 1, "square")).toBe(false);
    expect(editor.getJSON().content?.[0].attrs?.listStyle).toBe("default");
  });
});
