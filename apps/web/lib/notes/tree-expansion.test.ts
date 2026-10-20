import { describe, expect, it } from "vitest";
import { buildNoteTree, type NoteTreeItem } from "./tree";
import {
  SIDEBAR_TREE_COLLAPSED_KEY,
  expandTreeIds,
  findTreeAncestorIds,
  loadCollapsedTreeIds,
  persistCollapsedTreeIds,
  toggleCollapsedTreeId,
} from "./tree-expansion";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    dump: () => Object.fromEntries(map),
  };
}

const items: NoteTreeItem[] = [
  { id: "root", title: "根", icon: null, parent_note_id: null },
  { id: "child", title: "子页", icon: null, parent_note_id: "root" },
  { id: "leaf", title: "叶子", icon: null, parent_note_id: "child" },
  { id: "other", title: "其它", icon: null, parent_note_id: null },
];

describe("折叠状态持久化", () => {
  it("空存储读回空集合", () => {
    expect(loadCollapsedTreeIds(fakeStorage())).toEqual(new Set());
  });

  it("写入后读回同一集合", () => {
    const storage = fakeStorage();
    persistCollapsedTreeIds(storage, new Set(["a", "b"]));
    expect(loadCollapsedTreeIds(storage)).toEqual(new Set(["a", "b"]));
    expect(storage.dump()[SIDEBAR_TREE_COLLAPSED_KEY]).toBe('["a","b"]');
  });

  it("非法 JSON / 非数组 / 非字符串元素一律静默回退为空集合", () => {
    expect(loadCollapsedTreeIds(fakeStorage({ [SIDEBAR_TREE_COLLAPSED_KEY]: "{oops" }))).toEqual(new Set());
    expect(loadCollapsedTreeIds(fakeStorage({ [SIDEBAR_TREE_COLLAPSED_KEY]: '{"a":1}' }))).toEqual(new Set());
    expect(loadCollapsedTreeIds(fakeStorage({ [SIDEBAR_TREE_COLLAPSED_KEY]: '["a", 1, null]' }))).toEqual(new Set(["a"]));
  });

  it("存储抛错时静默：读回空、写不炸", () => {
    const broken = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    expect(loadCollapsedTreeIds(broken)).toEqual(new Set());
    expect(persistCollapsedTreeIds(broken, new Set(["a"]))).toEqual(new Set(["a"]));
  });

  it("toggle：读-合并-翻转-写回（保留存储里其它实例折叠的 id）", () => {
    const storage = fakeStorage({ [SIDEBAR_TREE_COLLAPSED_KEY]: '["other-instance-id"]' });
    const next = toggleCollapsedTreeId(storage, "mine");
    expect(next).toEqual(new Set(["other-instance-id", "mine"]));
    expect(loadCollapsedTreeIds(storage)).toEqual(new Set(["other-instance-id", "mine"]));
    // 再翻一次 = 展开
    const after = toggleCollapsedTreeId(storage, "mine");
    expect(after).toEqual(new Set(["other-instance-id"]));
  });

  it("expandTreeIds：只移除目标 id；本就全展开时不写存储", () => {
    const storage = fakeStorage({ [SIDEBAR_TREE_COLLAPSED_KEY]: '["root","child"]' });
    const next = expandTreeIds(storage, ["root"]);
    expect(next).toEqual(new Set(["child"]));
    expect(storage.dump()[SIDEBAR_TREE_COLLAPSED_KEY]).toBe('["child"]');

    const before = storage.dump()[SIDEBAR_TREE_COLLAPSED_KEY];
    const same = expandTreeIds(storage, ["not-collapsed"]);
    expect(same).toEqual(new Set(["child"]));
    expect(storage.dump()[SIDEBAR_TREE_COLLAPSED_KEY]).toBe(before);
  });
});

describe("findTreeAncestorIds 自动展开祖先", () => {
  const tree = buildNoteTree(items);

  it("返回从顶层到直接父级的祖先链", () => {
    expect(findTreeAncestorIds(tree, "leaf")).toEqual(["root", "child"]);
  });

  it("顶层节点返回空数组；不在树里返回 null", () => {
    expect(findTreeAncestorIds(tree, "root")).toEqual([]);
    expect(findTreeAncestorIds(tree, "missing")).toBeNull();
  });
});
