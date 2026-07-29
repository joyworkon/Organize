import { describe, expect, it } from "vitest";
import {
  buildNoteTree,
  getDescendantIds,
  getNoteAncestors,
  getParentCandidates,
  type NoteTreeItem,
} from "./tree";

const notes: NoteTreeItem[] = [
  { id: "root", title: "根", icon: "📁", parent_note_id: null },
  { id: "child", title: "子页", icon: null, parent_note_id: "root" },
  { id: "leaf", title: "叶子", icon: null, parent_note_id: "child" },
  { id: "other", title: "其它", icon: null, parent_note_id: null },
];

describe("note tree", () => {
  it("builds nested branches and keeps roots", () => {
    const tree = buildNoteTree(notes);
    const root = tree.find((item) => item.id === "root");
    expect(tree.map((item) => item.id).sort()).toEqual(["other", "root"]);
    expect(root?.children[0].id).toBe("child");
    expect(root?.children[0].children[0].id).toBe("leaf");
  });

  it("returns ancestors from root to direct parent", () => {
    expect(getNoteAncestors(notes, "leaf").map((item) => item.id)).toEqual([
      "root",
      "child",
    ]);
  });

  it("excludes the page and descendants from parent choices", () => {
    expect(Array.from(getDescendantIds(notes, "root"))).toEqual(["child", "leaf"]);
    expect(getParentCandidates(notes, "root").map((item) => item.id)).toEqual([
      "other",
    ]);
  });

  it("promotes invalid cycles to roots instead of recursing forever", () => {
    const cyclic: NoteTreeItem[] = [
      { id: "a", title: "A", icon: null, parent_note_id: "b" },
      { id: "b", title: "B", icon: null, parent_note_id: "a" },
    ];
    expect(buildNoteTree(cyclic).map((item) => item.id).sort()).toEqual([
      "a",
      "b",
    ]);
  });
});
