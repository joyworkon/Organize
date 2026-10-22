// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeScene } from "@/lib/canvas/layout";
import { createConnector } from "@/lib/canvas/connectors";
import { createFreeText } from "@/lib/canvas/commands";
import {
  createColumn,
  createRegion,
  createSection,
  createTextBlock,
  type CanvasDoc,
} from "@/lib/canvas/model";
import { createCanvasStore } from "./canvas-store";
import { CanvasBoardExportSurface } from "./canvas-board-export";

/** 纯 DOM 测量器替身：文本固定 24px 内容高，几何仍走 computeScene。 */
const stubMeasure = () => 24;

function fixtureDoc(): CanvasDoc {
  let doc: CanvasDoc = {
    schemaVersion: 2,
    boards: [
      {
        id: "b1",
        name: "封面",
        x: 100,
        y: 100,
        width: 640,
        padding: 24,
        gap: 16,
        regions: [createRegion([createSection([createColumn([createTextBlock("title", "标题")])])])],
      },
    ],
    freeItems: [],
    connectors: [],
  };
  // 两个页内自由文本（与页面包围盒相交；标题块场景高约 130px）
  doc = createFreeText(doc, { x: 200, y: 120 }).doc;
  doc = createFreeText(doc, { x: 300, y: 180 }).doc;
  // 页外自由文本
  doc = createFreeText(doc, { x: 5000, y: 5000 }).doc;
  const ids = doc.freeItems.map((item) => item.id);
  // 两端都在页内的连接线（导出）；页内→页外的连接线（不导出）
  doc = createConnector(doc, ids[0], ids[1]).doc;
  doc = createConnector(doc, ids[0], ids[2]).doc;
  return doc;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("CanvasBoardExportSurface", () => {
  it("只渲染目标页面、相交自由元素与两端在内的连接线", () => {
    const doc = fixtureDoc();
    const scene = computeScene(doc, stubMeasure);
    const store = createCanvasStore({ doc });
    act(() => {
      root.render(
        <CanvasBoardExportSurface doc={doc} scene={scene} store={store} assetUrls={{}} boardId="b1" />,
      );
    });

    const exportRoot = container.querySelector<HTMLElement>(".canvas-export-root");
    expect(exportRoot).not.toBeNull();
    // 导出根尺寸 = 页面包围盒
    expect(exportRoot!.style.width).toBe("640px");

    // 页面本体渲染
    expect(container.querySelector("[data-board-id='b1']")).not.toBeNull();
    // 页内自由元素渲染，页外不渲染
    const freeIds = doc.freeItems.map((item) => item.id);
    expect(container.querySelector(`[data-free-item-id='${freeIds[0]}']`)).not.toBeNull();
    expect(container.querySelector(`[data-free-item-id='${freeIds[1]}']`)).not.toBeNull();
    expect(container.querySelector(`[data-free-item-id='${freeIds[2]}']`)).toBeNull();
    // 连接线渲染（两端都在集合内）
    expect(container.querySelectorAll("[data-connector-id]").length).toBe(1);

    // 无编辑 chrome：加号 / 把手 / 连接端口 / 选区框
    expect(container.querySelector(".canvas-plus")).toBeNull();
    expect(container.querySelector(".canvas-board-handle")).toBeNull();
    expect(container.querySelector("[data-connector-port]")).toBeNull();
    expect(container.querySelector(".canvas-free-actions")).toBeNull();
  });

  it("页面不存在时不渲染任何内容", () => {
    const doc = fixtureDoc();
    const scene = computeScene(doc, stubMeasure);
    const store = createCanvasStore({ doc });
    act(() => {
      root.render(
        <CanvasBoardExportSurface doc={doc} scene={scene} store={store} assetUrls={{}} boardId="missing" />,
      );
    });
    expect(container.querySelector(".canvas-export-root")).toBeNull();
  });
});
