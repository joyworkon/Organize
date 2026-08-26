import { describe, expect, it } from "vitest";
import { computeForceLayout } from "./force-layout";
import type { GraphData } from "./build-graph";

function chainGraph(): GraphData {
  return {
    nodes: [
      { id: "a", kind: "note", label: "a", degree: 1 },
      { id: "b", kind: "note", label: "b", degree: 2 },
      { id: "c", kind: "note", label: "c", degree: 1 },
    ],
    edges: [
      { source: "a", target: "b", kind: "link" },
      { source: "b", target: "c", kind: "link" },
    ],
  };
}

describe("computeForceLayout", () => {
  it("空图返回空数组", () => {
    expect(computeForceLayout({ nodes: [], edges: [] }, { width: 800, height: 600 })).toEqual([]);
  });

  it("每个节点都有有限坐标", () => {
    const layout = computeForceLayout(chainGraph(), { width: 800, height: 600 });
    expect(layout).toHaveLength(3);
    for (const node of layout) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it("确定性：同输入两次计算结果一致", () => {
    const first = computeForceLayout(chainGraph(), { width: 800, height: 600 });
    const second = computeForceLayout(chainGraph(), { width: 800, height: 600 });
    expect(first).toEqual(second);
  });

  it("两对相连节点各自聚类：对内距离小于跨对距离", () => {
    const graph: GraphData = {
      nodes: [
        { id: "a", kind: "note", label: "a", degree: 1 },
        { id: "b", kind: "note", label: "b", degree: 1 },
        { id: "c", kind: "note", label: "c", degree: 1 },
        { id: "d", kind: "note", label: "d", degree: 1 },
      ],
      edges: [
        { source: "a", target: "b", kind: "link" },
        { source: "c", target: "d", kind: "link" },
      ],
    };
    const layout = computeForceLayout(graph, { width: 800, height: 600 });
    const at = (id: string) => layout.find((n) => n.id === id)!;
    const dist = (p: { x: number; y: number }, q: { x: number; y: number }) =>
      Math.hypot(p.x - q.x, p.y - q.y);
    expect(dist(at("a"), at("b"))).toBeLessThan(dist(at("a"), at("c")));
    expect(dist(at("a"), at("b"))).toBeLessThan(dist(at("a"), at("d")));
    expect(dist(at("c"), at("d"))).toBeLessThan(dist(at("c"), at("a")));
  });

  it("单节点图不发散", () => {
    const layout = computeForceLayout(
      { nodes: [{ id: "solo", kind: "note", label: "s", degree: 0 }], edges: [] },
      { width: 800, height: 600 }
    );
    expect(layout).toHaveLength(1);
    expect(Number.isFinite(layout[0].x)).toBe(true);
  });
});
