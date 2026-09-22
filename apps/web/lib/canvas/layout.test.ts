import { describe, expect, it } from "vitest";
import {
  BOARD_DEFAULT_WIDTH,
  BOARD_GAP,
  BOARD_PADDING,
  BLOCK_PADDING,
  COLUMN_MIN_WIDTH,
  MIN_TEXT_CONTENT_HEIGHT,
  createBoardShape,
  emptyDoc,
  type CanvasImageBlock,
} from "./model";
import {
  canAddColumn,
  canSmartRecompute,
  columnRequiredHeight,
  computeColumnWidths,
  computeScene,
  computeSmartWeights,
  manualWeightsFromDrag,
  sceneBounds,
} from "./layout";

/** 确定性测量器：文本块按 8px/字符行宽模拟（固定每 20 字符一行）。 */
function fakeMeasure(block: { type: string; text?: string }, innerWidth: number): number {
  if (block.type !== "text") return MIN_TEXT_CONTENT_HEIGHT;
  const text = block.text ?? "";
  if (!text.trim()) return MIN_TEXT_CONTENT_HEIGHT;
  const charsPerLine = Math.max(1, Math.floor(innerWidth / 16));
  const lines = Math.ceil(text.length / charsPerLine);
  return lines * 24;
}

function counterIds(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

const board = () => createBoardShape({ x: 0, y: 0 }, counterIds());

describe("computeColumnWidths", () => {
  it("等分：列宽 + 间距 = 分区内容宽（A02）", () => {
    const b = board();
    const widths = computeColumnWidths(b, { columnWeights: [1, 1], columns: [{}, {}] as never });
    const contentWidth = BOARD_DEFAULT_WIDTH - BOARD_PADDING * 2;
    expect(widths.reduce((s, w) => s + w, 0) + BOARD_GAP).toBeCloseTo(contentWidth, 6);
    expect(widths[0]).toBeCloseTo(widths[1], 6);
  });

  it("manual 权重按比例分配，总和严格等于可分配宽（A08）", () => {
    const b = board();
    const widths = computeColumnWidths(b, { columnWeights: [3, 1], columns: [{}, {}] as never });
    const allocatable = BOARD_DEFAULT_WIDTH - BOARD_PADDING * 2 - BOARD_GAP;
    expect(widths.reduce((s, w) => s + w, 0)).toBeCloseTo(allocatable, 6);
    expect(widths[0] / widths[1]).toBeCloseTo(3, 5);
  });

  it("单列占满内容宽", () => {
    const b = board();
    const widths = computeColumnWidths(b, { columnWeights: [1], columns: [{}] as never });
    expect(widths[0]).toBe(BOARD_DEFAULT_WIDTH - BOARD_PADDING * 2);
  });
});

describe("canAddColumn", () => {
  it("默认 640 宽（内容 592）：4 列可加（4×120+3×16=528），5 列不行（664>592，A08）", () => {
    expect(canAddColumn(board(), 2)).toBe(true);
    expect(canAddColumn(board(), 3)).toBe(true);
    expect(canAddColumn(board(), 4)).toBe(false);
  });

  it("加宽版面后可以继续加列", () => {
    const wide = createBoardShape({ x: 0, y: 0 }, counterIds());
    wide.width = 800;
    expect(canAddColumn(wide, 3)).toBe(true);
    expect(COLUMN_MIN_WIDTH).toBe(120);
  });
});

describe("computeScene", () => {
  it("双击建版面：标题分区满宽，高度由内容驱动", () => {
    const doc = emptyDoc();
    const b = createBoardShape({ x: 40, y: 60 }, counterIds());
    doc.boards.push(b);
    const scene = computeScene(doc, fakeMeasure);
    const sb = scene.boards[0];
    expect(sb.x).toBe(40);
    expect(sb.y).toBe(60);
    expect(sb.width).toBe(BOARD_DEFAULT_WIDTH);
    // 标题分区通栏
    expect(sb.regions[0].sections[0].columnWidths).toEqual([BOARD_DEFAULT_WIDTH - BOARD_PADDING * 2]);
    // 版面高度 = (空文本内容高 + 模块 chrome) × 2 + 间距 + 上下 padding
    const CHROME = 26; // BLOCK_PADDING*2 + 上下边框
    const contentHeight = (MIN_TEXT_CONTENT_HEIGHT + CHROME) * 2 + BOARD_GAP;
    expect(sb.height).toBeCloseTo(contentHeight + BOARD_PADDING * 2, 6);
  });

  it("分区顺延：不同分区 y 递增不重叠（A03）", () => {
    const doc = emptyDoc();
    const b = createBoardShape({ x: 0, y: 0 }, counterIds());
    doc.boards.push(b);
    const scene = computeScene(doc, fakeMeasure);
    const [title, body] = scene.boards[0].regions[0].sections;
    expect(title.y).toBe(BOARD_PADDING);
    expect(body.y).toBe(title.y + title.height + BOARD_GAP);
    expect(body.y + body.height + BOARD_PADDING).toBeCloseTo(scene.boards[0].height, 6);
  });
});

describe("分区高度与等高规则（A04/A05）", () => {
  function twoColDoc() {
    const doc = emptyDoc();
    const b = createBoardShape({ x: 0, y: 0 }, counterIds());
    // 只留标题分区；构造一个两列正文分区
    const section = b.regions[0].sections[1];
    section.columns.push({
      id: "col-right",
      blocks: [{ id: "blk-right", type: "text", text: "B", role: "body" }],
    });
    section.columnWeights = [1, 1];
    section.columns[0].blocks[0] = { id: "blk-left", type: "text", text: "A", role: "body" };
    doc.boards.push(b);
    return { doc, board: b, section };
  }

  it("左右各一块：分区高 = 两者最大自然高，双方等高拉满（A02 前置）", () => {
    const { doc } = twoColDoc();
    const scene = computeScene(doc, fakeMeasure);
    const body = scene.boards[0].regions[0].sections[1];
    const [left, right] = body.columns;
    expect(left.blocks[0].height).toBeCloseTo(right.blocks[0].height, 6);
    expect(body.height).toBeCloseTo(left.height, 6);
  });

  it("左列底部加块：左列两块等高，右列单块跨两层（A04）", () => {
    const { doc } = twoColDoc();
    doc.boards[0].regions[0].sections[1].columns[0].blocks.push({
      id: "blk-left-2",
      type: "text",
      text: "C",
      role: "body",
    });
    const scene = computeScene(doc, fakeMeasure);
    const body = scene.boards[0].regions[0].sections[1];
    const [left, right] = body.columns;
    expect(left.blocks).toHaveLength(2);
    expect(left.blocks[0].height).toBeCloseTo(left.blocks[1].height, 6);
    expect(right.blocks[0].height).toBeCloseTo(body.height, 6);
    // 左列两块 + 间距 = 分区高（块盒高含模块 chrome）
    expect(left.blocks[0].height * 2 + BOARD_GAP).toBeCloseTo(body.height, 6);
  });

  it("右侧再加一块恢复两列两块；删除左下后左列单块拉高、无空列残留（A05）", () => {
    const { doc } = twoColDoc();
    doc.boards[0].regions[0].sections[1].columns[0].blocks.push({
      id: "blk-left-2",
      type: "text",
      text: "C",
      role: "body",
    });
    doc.boards[0].regions[0].sections[1].columns[1].blocks.push({
      id: "blk-right-2",
      type: "text",
      text: "D",
      role: "body",
    });
    let scene = computeScene(doc, fakeMeasure);
    const [l, r] = scene.boards[0].regions[0].sections[1].columns;
    expect(l.height).toBeCloseTo(r.height, 6); // 两列总高一致

    doc.boards[0].regions[0].sections[1].columns[0].blocks.pop(); // 删除左下 C
    scene = computeScene(doc, fakeMeasure);
    const body = scene.boards[0].regions[0].sections[1];
    const [left2, right2] = body.columns;
    expect(left2.blocks).toHaveLength(1);
    // 左列单块拉满整排高度；右列两块 + 间距等于同一总高
    expect(left2.blocks[0].height).toBeCloseTo(body.height, 6);
    expect(right2.blocks[0].height * 2 + BOARD_GAP).toBeCloseTo(body.height, 6);
  });

  it("columnRequiredHeight: n*(m+chrome) + (n-1)*g（规格 §4.1.4 公式 + 模块自身内外边距）", () => {
    expect(columnRequiredHeight([40, 40, 40], 16)).toBe((40 + 26) * 3 + 16 * 2);
    expect(columnRequiredHeight([100], 16)).toBe(100 + 26);
  });
});

describe("图片布局", () => {
  it("图片块自然高 = 内宽 / 比例，横竖图不同（A07 前置）", () => {
    const doc = emptyDoc();
    const b = createBoardShape({ x: 0, y: 0 }, counterIds());
    const img = b.regions[0].sections[1].columns[0];
    img.blocks = [
      {
        id: "img1",
        type: "image",
        asset: { url: "https://example.com/a.png", naturalWidth: 400, naturalHeight: 200 },
        fit: "contain",
      },
    ];
    doc.boards.push(b);
    const scene = computeScene(doc, fakeMeasure);
    const body = scene.boards[0].regions[0].sections[1];
    const inner = body.columnWidths[0] - BLOCK_PADDING * 2;
    expect(body.columns[0].blocks[0].height).toBeCloseTo(inner / 2 + 26, 6);
  });

  it("无资产/加载失败：占位高度，不折叠到 0", () => {
    const doc = emptyDoc();
    const b = createBoardShape({ x: 0, y: 0 }, counterIds());
    b.regions[0].sections[1].columns[0].blocks = [{ id: "img0", type: "image", asset: null, fit: "contain" }];
    doc.boards.push(b);
    const scene = computeScene(doc, fakeMeasure);
    const body = scene.boards[0].regions[0].sections[1];
    expect(body.height).toBeGreaterThan(0);
  });
});

describe("computeSmartWeights（规格 §4.2）", () => {
  it("正常文图：图片外宽落在 25%–60% 区间，两列权重和 = 可分配宽", () => {
    const contentWidth = BOARD_DEFAULT_WIDTH - BOARD_PADDING * 2;
    const [textW, imgW] = computeSmartWeights({
      contentWidth,
      gap: BOARD_GAP,
      textNaturalHeightAtRef: 120,
      imageRatio: 1.5,
    });
    const allocatable = contentWidth - BOARD_GAP;
    expect(imgW).toBeGreaterThanOrEqual(allocatable * 0.25 - 1e-6);
    expect(imgW).toBeLessThanOrEqual(allocatable * 0.6 + 1e-6);
    expect(textW + imgW).toBeCloseTo(allocatable, 6);
  });

  it("竖图不会越过 60% 上限；极端矮文字不破最小宽", () => {
    const contentWidth = BOARD_DEFAULT_WIDTH - BOARD_PADDING * 2;
    const [, imgW] = computeSmartWeights({
      contentWidth,
      gap: BOARD_GAP,
      textNaturalHeightAtRef: 24,
      imageRatio: 0.2,
    });
    const allocatable = contentWidth - BOARD_GAP;
    expect(imgW).toBeLessThanOrEqual(allocatable * 0.6 + 1e-6);
  });

  it("极横图想要超过 60% 上限 → 按 60% 封顶；极窄图低于 25% 下限 → 按 25% 兜底", () => {
    const contentWidth = BOARD_DEFAULT_WIDTH - BOARD_PADDING * 2;
    const allocatable = contentWidth - BOARD_GAP;
    const [, wideImg] = computeSmartWeights({
      contentWidth,
      gap: BOARD_GAP,
      textNaturalHeightAtRef: 200,
      imageRatio: 10,
    });
    expect(wideImg).toBeCloseTo(allocatable * 0.6, 6);
    const [, narrowImg] = computeSmartWeights({
      contentWidth,
      gap: BOARD_GAP,
      textNaturalHeightAtRef: 24,
      imageRatio: 0.1,
    });
    expect(narrowImg).toBeCloseTo(allocatable * 0.25, 6);
  });
});

describe("manualWeightsFromDrag", () => {
  it("拖分隔线只改相邻两列，边界 ≥ 最小列宽（A08）", () => {
    const widths = [300, 300];
    const next = manualWeightsFromDrag(widths, 0, 380);
    expect(next[0]).toBe(380);
    expect(next[1]).toBe(220); // pairTotal 600
    expect(manualWeightsFromDrag(widths, 0, 9999)[1]).toBeGreaterThanOrEqual(COLUMN_MIN_WIDTH);
  });
});

describe("sceneBounds", () => {
  it("空场景返回 null；含版面与自由容器时为包围盒", () => {
    expect(sceneBounds({ boards: [], freeItems: [] })).toBeNull();
    const doc = emptyDoc();
    doc.boards.push(createBoardShape({ x: 10, y: 20 }, counterIds()));
    doc.freeItems.push({ id: "f1", x: -50, y: -30, width: 100, zIndex: 1, block: { id: "fb", type: "text", text: "x", role: "body" } });
    const bounds = sceneBounds(computeScene(doc, fakeMeasure));
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBe(-50);
    expect(bounds!.y).toBe(-30);
  });
});

describe("自由图片容器比例（A5）", () => {
  function freeImageDoc(ratio?: "1:1" | "4:3" | "16:9") {
    const doc = emptyDoc();
    const block: CanvasImageBlock = {
      id: "fi1",
      type: "image",
      asset: { url: "https://example.com/a.png", naturalWidth: 100, naturalHeight: 50 },
      fit: "contain",
      ...(ratio ? { ratio } : {}),
    };
    doc.freeItems.push({ id: "f1", x: 0, y: 0, width: 320, zIndex: 1, block });
    return doc;
  }

  // BLOCK_CHROME = BLOCK_PADDING*2 + 2 = 26；inner = 320 - 24 = 296
  const CHROME = 26;
  const inner = 296;

  it("auto（缺省）：高度 = 内宽 / 图片自然比例（现状回归）", () => {
    const scene = computeScene(freeImageDoc(), fakeMeasure);
    expect(scene.freeItems[0].height).toBeCloseTo(inner / 2 + CHROME, 6);
  });

  it("1:1：容器锁为正方形，cover 才有裁切空间", () => {
    const scene = computeScene(freeImageDoc("1:1"), fakeMeasure);
    expect(scene.freeItems[0].height).toBeCloseTo(inner / 1 + CHROME, 6);
  });

  it("4:3 / 16:9：高度 = 内宽 / 宽高比", () => {
    expect(computeScene(freeImageDoc("4:3"), fakeMeasure).freeItems[0].height).toBeCloseTo(
      inner / (4 / 3) + CHROME,
      6,
    );
    expect(computeScene(freeImageDoc("16:9"), fakeMeasure).freeItems[0].height).toBeCloseTo(
      inner / (16 / 9) + CHROME,
      6,
    );
  });
});

describe("canSmartRecompute（A7 共享判定）", () => {
  const col = (blocks: { type: string }[]) => ({ blocks });
  const textBlock = { type: "text" };
  const imageBlock = { type: "image" };

  it("两列、每列恰一个块、至少一个图片块：true", () => {
    expect(canSmartRecompute({ columns: [col([textBlock]), col([imageBlock])] })).toBe(true);
    expect(canSmartRecompute({ columns: [col([imageBlock]), col([textBlock])] })).toBe(true);
  });

  it("非两列 / 某列多块 / 无图片块：false", () => {
    expect(canSmartRecompute({ columns: [col([textBlock])] })).toBe(false);
    expect(
      canSmartRecompute({ columns: [col([textBlock]), col([textBlock]), col([imageBlock])] }),
    ).toBe(false);
    expect(canSmartRecompute({ columns: [col([textBlock, textBlock]), col([imageBlock])] })).toBe(false);
    expect(canSmartRecompute({ columns: [col([textBlock]), col([textBlock])] })).toBe(false);
  });
});

describe("Region 层布局（B1）", () => {
  function regionDoc(opts?: {
    regionPadding?: number;
    rowGap?: number;
    longText?: boolean;
  }) {
    const doc = emptyDoc();
    const b = createBoardShape({ x: 0, y: 0 }, counterIds());
    const region = b.regions[0];
    if (opts?.regionPadding !== undefined) region.style = { ...(region.style ?? {}), padding: opts.regionPadding };
    if (opts?.rowGap !== undefined) region.style = { ...(region.style ?? {}), rowGap: opts.rowGap };
    if (opts?.longText) {
      (region.sections[0].columns[0].blocks[0] as { text: string }).text = "长".repeat(400);
    }
    doc.boards.push(b);
    return doc;
  }

  it("区块内边距缺省 0：迁移文档行内容宽 = 版面内容宽（几何不变）", () => {
    const scene = computeScene(regionDoc(), fakeMeasure);
    const region = scene.boards[0].regions[0];
    const section = region.sections[0];
    expect(section.columnWidths[0]).toBeCloseTo(BOARD_DEFAULT_WIDTH - BOARD_PADDING * 2, 6);
    // 区块外框高 = 行高之和 + 行距
    const [title, body] = region.sections;
    expect(region.height).toBeCloseTo(title.height + BOARD_GAP + body.height, 6);
  });

  it("region.style.padding 生效：行内容区收窄，区块高 = pad×2 + Σ行高 + 行距", () => {
    const doc = regionDoc({ regionPadding: 20 });
    const scene = computeScene(doc, fakeMeasure);
    const region = scene.boards[0].regions[0];
    const inner = BOARD_DEFAULT_WIDTH - BOARD_PADDING * 2 - 40;
    expect(region.sections[0].columnWidths[0]).toBeCloseTo(inner, 6);
    const [title, body] = region.sections;
    expect(region.height).toBeCloseTo(40 + title.height + BOARD_GAP + body.height, 6);
    // 行内容区左缘 = 版面 x + padding + regionPadding
    expect(region.sections[0].columns[0].x).toBeCloseTo(BOARD_PADDING + 20, 6);
  });

  it("region.style.rowGap 生效：行间距替换版面 gap", () => {
    const doc = regionDoc({ rowGap: 40 });
    const scene = computeScene(doc, fakeMeasure);
    const region = scene.boards[0].regions[0];
    const [title, body] = region.sections;
    expect(body.y).toBeCloseTo(title.y + title.height + 40, 6);
    expect(region.height).toBeCloseTo(title.height + 40 + body.height, 6);
  });

  it("长文字撑高行 → 区块增高 → 版面总高同步；sceneBounds 覆盖区块外框", () => {
    const doc = regionDoc({ longText: true });
    const scene = computeScene(doc, fakeMeasure);
    const sb = scene.boards[0];
    const region = sb.regions[0];
    const [title, body] = region.sections;
    expect(title.height).toBeGreaterThan(body.height);
    expect(sb.height).toBeCloseTo(BOARD_PADDING * 2 + region.height, 6);
    const bounds = sceneBounds(scene)!;
    expect(bounds.y).toBe(0);
    expect(bounds.height).toBeCloseTo(sb.height, 6);
  });

  it("多区块：长文字撑高前一区块，后续区块顺延不重叠", () => {
    const doc = emptyDoc();
    const b = createBoardShape({ x: 0, y: 0 }, counterIds());
    // 把正文行移到第二个区块，并给第一个区块塞一个长文本行
    const bodySection = b.regions[0].sections[1];
    b.regions[0].sections = [b.regions[0].sections[0]];
    b.regions.push({
      id: "region-2",
      name: "第二区块",
      sections: [bodySection],
    });
    b.regions[0].sections.push({
      id: "long-row",
      widthMode: "equal",
      columnWeights: [1],
      columns: [
        {
          id: "long-col",
          blocks: [{ id: "long-block", type: "text", text: "长".repeat(500), role: "body" }],
        },
      ],
    });
    doc.boards.push(b);
    const scene = computeScene(doc, fakeMeasure);
    const [r1, r2] = scene.boards[0].regions;
    // r2 顺延到 r1 之后（外框不重叠）
    expect(r2.y).toBeCloseTo(r1.y + r1.height + BOARD_GAP, 6);
    // 版面总高 = padding×2 + r1 + gap + r2
    expect(scene.boards[0].height).toBeCloseTo(
      BOARD_PADDING * 2 + r1.height + BOARD_GAP + r2.height,
      6,
    );
  });
});
