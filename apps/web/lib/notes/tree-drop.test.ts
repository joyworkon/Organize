import { describe, expect, it, vi } from "vitest";
import { buildNoteTree, type NoteTreeItem } from "./tree";
import {
  canDropNoteOn,
  flattenNoteTree,
  persistNoteMove,
  persistNoteRename,
  type NoteMoveClient,
  type NoteRenameClient,
} from "./tree-drop";

const items: NoteTreeItem[] = [
  { id: "root", title: "根", icon: null, parent_note_id: null },
  { id: "child", title: "子页", icon: null, parent_note_id: "root" },
  { id: "leaf", title: "叶子", icon: null, parent_note_id: "child" },
  { id: "other", title: "其它", icon: null, parent_note_id: null },
];

function fakeClient({
  revision = 3,
  updateError = null as unknown,
} = {}) {
  const update = vi.fn(() => ({
    eq: vi.fn(async () => ({ error: updateError })),
  }));
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      single: async () => ({ data: { content_revision: revision } }),
    })),
  }));
  const client: NoteMoveClient & NoteRenameClient = {
    from: vi.fn(() => ({ select, update })) as never,
  };
  return { client, select, update };
}

describe("flattenNoteTree", () => {
  it("DFS 展平为「先父后子」的扁平行", () => {
    const tree = buildNoteTree(items);
    expect(flattenNoteTree(tree).map((n) => n.id)).toEqual([
      "root",
      "child",
      "leaf",
      "other",
    ]);
  });
});

describe("canDropNoteOn 合法 drop 判断", () => {
  it("普通嵌套目标合法", () => {
    expect(canDropNoteOn(items, "other", "root")).toBe(true);
    expect(canDropNoteOn(items, "leaf", "other")).toBe(true);
  });

  it("拖到自己上非法", () => {
    expect(canDropNoteOn(items, "root", "root")).toBe(false);
  });

  it("拖到自己的后代上非法（防成环）", () => {
    expect(canDropNoteOn(items, "root", "child")).toBe(false);
    expect(canDropNoteOn(items, "root", "leaf")).toBe(false);
    expect(canDropNoteOn(items, "child", "leaf")).toBe(false);
  });

  it("拖到祖先 / 无关节点合法", () => {
    expect(canDropNoteOn(items, "leaf", "root")).toBe(true);
    expect(canDropNoteOn(items, "child", "other")).toBe(true);
  });

  it("draggedId 为空或不在本段树（跨段 / 列表卡片拖来）时本段目标全部合法", () => {
    expect(canDropNoteOn(items, null, "root")).toBe(true);
    expect(canDropNoteOn(items, undefined, "root")).toBe(true);
    expect(canDropNoteOn(items, "not-in-this-tree", "leaf")).toBe(true);
  });
});

describe("persistNoteMove", () => {
  it("读 revision 后更新 parent 并递增 content_revision，成功后回调 onPersisted", async () => {
    const { client, update } = fakeClient({ revision: 7 });
    const onPersisted = vi.fn();
    await persistNoteMove(client, "note-1", "root", onPersisted);
    expect(update).toHaveBeenCalledWith({ parent_note_id: "root", content_revision: 8 });
    expect(onPersisted).toHaveBeenCalledTimes(1);
  });

  it("移到顶层（null parent）", async () => {
    const { client, update } = fakeClient();
    await persistNoteMove(client, "note-1", null, () => {});
    expect(update).toHaveBeenCalledWith({ parent_note_id: null, content_revision: 4 });
  });

  it("写库失败抛出原错误且不回调", async () => {
    const failure = new Error("db down");
    const { client } = fakeClient({ updateError: failure });
    const onPersisted = vi.fn();
    await expect(persistNoteMove(client, "note-1", "root", onPersisted)).rejects.toBe(failure);
    expect(onPersisted).not.toHaveBeenCalled();
  });
});

describe("persistNoteRename", () => {
  it("更新 title 并递增 content_revision，成功后回调", async () => {
    const { client, update } = fakeClient({ revision: 0 });
    const onPersisted = vi.fn();
    await persistNoteRename(client, "note-1", "新标题", onPersisted);
    expect(update).toHaveBeenCalledWith({ title: "新标题", content_revision: 1 });
    expect(onPersisted).toHaveBeenCalledTimes(1);
  });

  it("写库失败抛出原错误且不回调", async () => {
    const failure = new Error("db down");
    const { client } = fakeClient({ updateError: failure });
    const onPersisted = vi.fn();
    await expect(persistNoteRename(client, "note-1", "x", onPersisted)).rejects.toBe(failure);
    expect(onPersisted).not.toHaveBeenCalled();
  });
});
