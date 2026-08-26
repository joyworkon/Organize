import { describe, expect, it } from "vitest";
import {
  buildNoteGraph,
  buildTaskGraph,
  filterIsolatedNodes,
  type NoteGraphRow,
} from "./build-graph";

function noteWithLink(id: string, href: string | null, parent: string | null = null): NoteGraphRow {
  return {
    id,
    title: `笔记${id}`,
    parent_note_id: parent,
    content: href
      ? {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "见", marks: [{ type: "link", attrs: { href } }] },
              ],
            },
          ],
        }
      : { type: "doc", content: [{ type: "paragraph" }] },
  };
}

describe("buildNoteGraph", () => {
  it("内部链接生成 link 边，父子层级生成 parent 边", () => {
    const graph = buildNoteGraph([
      noteWithLink("a", "/notes/b"),
      noteWithLink("b", null, "a"),
      noteWithLink("c", null),
    ]);
    expect(graph.edges).toContainEqual({ source: "a", target: "b", kind: "link" });
    expect(graph.edges).toContainEqual({ source: "a", target: "b", kind: "parent" });
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.find((n) => n.id === "a")?.degree).toBe(2);
    expect(graph.nodes.find((n) => n.id === "b")?.degree).toBe(2);
    expect(graph.nodes.find((n) => n.id === "c")?.degree).toBe(0);
  });

  it("指向不存在笔记的链接被丢弃", () => {
    const graph = buildNoteGraph([noteWithLink("a", "/notes/ghost")]);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes[0].degree).toBe(0);
  });

  it("重复链接去重（同 source/target/kind 只保留一条）", () => {
    const note: NoteGraphRow = {
      id: "a",
      title: "a",
      parent_note_id: null,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "x", marks: [{ type: "link", attrs: { href: "/notes/b" } }] },
              { type: "text", text: "y", marks: [{ type: "link", attrs: { href: "/notes/b?mode=peek" } }] },
            ],
          },
        ],
      },
    };
    const graph = buildNoteGraph([note, noteWithLink("b", null)]);
    expect(graph.edges.filter((e) => e.kind === "link")).toHaveLength(1);
  });

  it("自链接与自父子不产生边", () => {
    const graph = buildNoteGraph([noteWithLink("a", "/notes/a", "a")]);
    expect(graph.edges).toHaveLength(0);
  });

  it("外部链接与阅读链接不进入笔记图谱", () => {
    const graph = buildNoteGraph([
      noteWithLink("a", "https://example.com"),
      noteWithLink("b", "/library/read-1"),
    ]);
    expect(graph.edges).toHaveLength(0);
  });

  it("空标题回退为「无标题笔记」", () => {
    const graph = buildNoteGraph([{ id: "a", title: "  ", content: null, parent_note_id: null }]);
    expect(graph.nodes[0].label).toBe("无标题笔记");
  });
});

describe("buildTaskGraph", () => {
  const tasks = [
    { id: "t1", title: "前置", status: "done" },
    { id: "t2", title: "后续", status: "todo" },
    { id: "t3", title: "孤立", status: "todo" },
  ];

  it("依赖边方向为 前置 → 被阻塞", () => {
    const graph = buildTaskGraph(tasks, [{ task_id: "t2", depends_on_task_id: "t1" }]);
    expect(graph.edges).toEqual([{ source: "t1", target: "t2", kind: "dependency" }]);
    expect(graph.nodes.find((n) => n.id === "t1")?.degree).toBe(1);
    expect(graph.nodes.find((n) => n.id === "t3")?.degree).toBe(0);
  });

  it("引用不存在任务的依赖被丢弃，重复依赖去重", () => {
    const graph = buildTaskGraph(tasks, [
      { task_id: "t2", depends_on_task_id: "ghost" },
      { task_id: "t2", depends_on_task_id: "t1" },
      { task_id: "t2", depends_on_task_id: "t1" },
    ]);
    expect(graph.edges).toEqual([{ source: "t1", target: "t2", kind: "dependency" }]);
  });
});

describe("filterIsolatedNodes", () => {
  it("移除无连接节点并保留有效边", () => {
    const graph = buildNoteGraph([
      noteWithLink("a", "/notes/b"),
      noteWithLink("b", null),
      noteWithLink("c", null),
    ]);
    const filtered = filterIsolatedNodes(graph);
    expect(filtered.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(filtered.edges.length).toBeGreaterThan(0);
    expect(filtered.nodes.every((n) => n.degree > 0)).toBe(true);
  });
});
