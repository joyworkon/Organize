import { describe, expect, it } from "vitest";
import {
  buildNoteTree,
  getDescendantIds,
  getNoteAncestors,
  getParentCandidates,
  limitNoteRoots,
  type NoteTreeItem,
  type NoteTreeNode,
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

  it("excludes deep descendants from parent candidates", () => {
    const deep: NoteTreeItem[] = [
      { id: "r", title: "R", icon: null, parent_note_id: null },
      { id: "a", title: "A", icon: null, parent_note_id: "r" },
      { id: "b", title: "B", icon: null, parent_note_id: "a" },
      { id: "c", title: "C", icon: null, parent_note_id: "b" },
      { id: "sibling", title: "S", icon: null, parent_note_id: null },
    ];
    // 对中间节点 'a' 来说，候选必须排除它自己和后代(b, c)
    const candidates = getParentCandidates(deep, "a").map((n) => n.id).sort();
    expect(candidates).toEqual(["r", "sibling"]);
  });

  it("treats notes whose parent is missing (soft-deleted) as roots", () => {
    const broken: NoteTreeItem[] = [
      { id: "orphan", title: "O", icon: null, parent_note_id: "gone" },
      { id: "ok", title: "K", icon: null, parent_note_id: null },
    ];
    const tree = buildNoteTree(broken);
    expect(tree.map((n) => n.id).sort()).toEqual(["ok", "orphan"]);
  });

  it("returns empty descendant set for a leaf note with no children", () => {
    expect(getDescendantIds(notes, "leaf").size).toBe(0);
    expect(getDescendantIds(notes, "other").size).toBe(0);
  });
});

describe("limitNoteRoots", () => {
  const mk = (id: string, extra: Partial<NoteTreeNode> = {}): NoteTreeNode => ({
    id,
    title: id,
    icon: null,
    parent_note_id: null,
    children: [],
    ...extra,
  });

  it("只保留前 N 个，并报告隐藏数量", () => {
    const roots = ["a", "b", "c", "d", "e", "f", "g"].map((id) => mk(id));
    const { visible, hiddenCount } = limitNoteRoots(roots, 5);
    expect(visible.map((n) => n.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(hiddenCount).toBe(2);
  });

  it("置顶笔记排最前且总是可见；包含当前笔记的顶层笔记超出也保留", () => {
    const roots = [
      ...["a", "b", "c", "d", "e", "f"].map((id) => mk(id)),
      mk("g", { children: [mk("g1", { parent_note_id: "g" })] }),
      mk("p", { is_pinned: true }),
    ];
    const { visible, hiddenCount } = limitNoteRoots(roots, 3, "g1");
    expect(visible.map((n) => n.id)).toEqual(["p", "a", "b", "g"]);
    expect(hiddenCount).toBe(4);
  });
});
