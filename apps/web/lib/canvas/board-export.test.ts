import { describe, expect, it } from "vitest";
import type { Scene } from "@/lib/canvas/layout";
import {
  exportFileName,
  exportPixelRatio,
  fontFaceNeededForText,
  fontFamiliesInStack,
  membersForBoardExport,
  parseFontUnicodeRange,
  rectsIntersect,
} from "@/lib/canvas/board-export";
import type { CanvasDoc } from "@/lib/canvas/model";

/** 场景几何直接手写（computeScene 是纯函数另有测试），这里只测导出成员归属。 */
const scene: Scene = {
  boards: [{ boardId: "b1", x: 100, y: 100, width: 640, height: 400, regions: [] }],
  freeItems: [
    // 完全在页内
    { itemId: "f-in", x: 200, y: 200, width: 120, height: 80, zIndex: 1 },
    // 恰好压到页面右边界（边界重合 = 相交）
    { itemId: "f-edge", x: 700, y: 150, width: 100, height: 60, zIndex: 2 },
    // 与页面无交集
    { itemId: "f-out", x: 2000, y: 100, width: 100, height: 60, zIndex: 3 },
  ],
};

const doc: CanvasDoc = {
  schemaVersion: 2,
  boards: [
    {
      id: "b1",
      x: 100,
      y: 100,
      width: 640,
      padding: 24,
      gap: 16,
      name: "封面",
      regions: [],
    },
  ],
  freeItems: [],
  connectors: [
    { id: "c-both", from: "f-in", to: "f-edge", arrow: "none", line: "solid", color: "", label: "" },
    { id: "c-half", from: "f-in", to: "f-out", arrow: "none", line: "solid", color: "", label: "" },
    { id: "c-none", from: "f-out", to: "f-out", arrow: "none", line: "solid", color: "", label: "" },
  ],
};

describe("membersForBoardExport", () => {
  it("页面存在时返回包围盒与相交自由元素（含压边）", () => {
    const members = membersForBoardExport(doc, scene, "b1");
    expect(members).not.toBeNull();
    expect(members!.bounds).toEqual({ x: 100, y: 100, width: 640, height: 400 });
    expect(members!.freeItemIds).toEqual(["f-in", "f-edge"]);
  });

  it("仅两端自由元素都纳入的连接线被导出", () => {
    const members = membersForBoardExport(doc, scene, "b1");
    expect(members!.connectorIds).toEqual(["c-both"]);
  });

  it("页面不存在返回 null", () => {
    expect(membersForBoardExport(doc, scene, "missing")).toBeNull();
    const emptyDoc: CanvasDoc = { schemaVersion: 2, boards: [], freeItems: [], connectors: [] };
    expect(membersForBoardExport(emptyDoc, scene, "b1")).toBeNull();
  });
});

describe("rectsIntersect", () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };
  it("边界重合算相交（压边）", () => {
    expect(rectsIntersect(a, { x: 100, y: 50, width: 10, height: 10 })).toBe(true);
    expect(rectsIntersect(a, { x: -10, y: 0, width: 10, height: 10 })).toBe(true);
  });
  it("完全在外不相交", () => {
    expect(rectsIntersect(a, { x: 100.1, y: 0, width: 10, height: 10 })).toBe(false);
    expect(rectsIntersect(a, { x: 0, y: 200, width: 10, height: 10 })).toBe(false);
  });
});

describe("exportFileName", () => {
  it("拼接画布标题与页面名", () => {
    expect(exportFileName("发布会方案", "封面")).toBe("发布会方案-封面.png");
  });

  it("去掉非法文件名字符与首尾空白/句点", () => {
    expect(exportFileName('a/b:c*d?"<>|\\e', "第 1 页.")).toBe("abcde-第 1 页.png");
  });

  it("空标题/空页面名回退默认文案", () => {
    expect(exportFileName("", "")).toBe("未命名画布-未命名页面.png");
    expect(exportFileName("  ", "  ")).toBe("未命名画布-未命名页面.png");
    expect(exportFileName("方案", "   ")).toBe("方案-未命名页面.png");
  });
});

describe("exportPixelRatio", () => {
  it("devicePixelRatio 夹在 1–2", () => {
    expect(exportPixelRatio(0.5)).toBe(1);
    expect(exportPixelRatio(1)).toBe(1);
    expect(exportPixelRatio(1.5)).toBe(1.5);
    expect(exportPixelRatio(3)).toBe(2);
    expect(exportPixelRatio(0)).toBe(1);
    expect(exportPixelRatio(Number.NaN)).toBe(1);
  });
});

describe("字体子集过滤", () => {
  it("fontFamiliesInStack 去引号拆分", () => {
    expect(fontFamiliesInStack('"MiSans VF", "PingFang SC", system-ui, sans-serif')).toEqual([
      "MiSans VF",
      "PingFang SC",
      "system-ui",
      "sans-serif",
    ]);
  });

  it("parseFontUnicodeRange 支持单点、区间与通配符", () => {
    expect(parseFontUnicodeRange("U+20")).toEqual([[0x20, 0x20]]);
    expect(parseFontUnicodeRange("U+2013-2014")).toEqual([[0x2013, 0x2014]]);
    expect(parseFontUnicodeRange("U+4??")).toEqual([[0x400, 0x4ff]]);
    expect(parseFontUnicodeRange("U+20, U+4e00-4e01")).toEqual([[0x20, 0x20], [0x4e00, 0x4e01]]);
    expect(parseFontUnicodeRange("")).toBeNull();
    expect(parseFontUnicodeRange("nonsense")).toEqual([]);
  });

  it("fontFaceNeededForText 按码点命中范围判定", () => {
    const cjk = parseFontUnicodeRange("U+4e00-4e2d")!;
    expect(fontFaceNeededForText("中文", cjk)).toBe(true);
    expect(fontFaceNeededForText("abc", cjk)).toBe(false);
    expect(fontFaceNeededForText("", cjk)).toBe(false);
    expect(fontFaceNeededForText("abc", null)).toBe(true);
    // 无有效片段的 range 视为需要（宁多勿漏）
    expect(fontFaceNeededForText("abc", [])).toBe(true);
  });
});
