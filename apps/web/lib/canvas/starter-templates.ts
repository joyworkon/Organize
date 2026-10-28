/**
 * 空白画布「快速开始」起步模板（纯函数）。
 *
 * 每个模板只用现有文档能力搭结构：页面/区块/行/列/文本块、自由便签、自由文本、连接线。
 * 产出为一次命令结果 (doc) → { doc, focus }，由 store.apply 作为**一个事务**进入历史，
 * ⌘Z 一步回到空白。坐标为世界坐标，以调用方传入的锚点（通常是当前可用视口中心）为基准。
 * 不新增 schemaVersion、不改文档 schema；blockId 仍由注入的 id 生成器产生。
 */

import {
  BOARD_DEFAULT_WIDTH,
  BOARD_GAP,
  BOARD_PADDING,
  CANVAS_SCHEMA_VERSION,
  MIN_TEXT_CONTENT_HEIGHT,
  createColumn,
  createRegion,
  createSection,
  createTextBlock,
  defaultIdGenerator,
  type CanvasBoard,
  type CanvasBlockStyle,
  type CanvasCommandResult,
  type CanvasConnector,
  type CanvasDoc,
  type CanvasFocus,
  type CanvasFreeItem,
  type CanvasIdGenerator,
  type CanvasTextBlock,
  type CanvasTextRole,
} from "./model";
import { BLOCK_CHROME } from "./layout";

/** 起步模板 id（「空白画布」不是模板，是面板的关闭选项）。 */
export type CanvasStarterTemplateId = "brainstorm" | "flowchart" | "kanban" | "swot" | "project";

export const CANVAS_STARTER_TEMPLATE_IDS: readonly CanvasStarterTemplateId[] = [
  "brainstorm",
  "flowchart",
  "kanban",
  "swot",
  "project",
];

const TEMPLATE_NAMES: Record<CanvasStarterTemplateId, string> = {
  brainstorm: "头脑风暴",
  flowchart: "流程图",
  kanban: "看板",
  swot: "SWOT 分析",
  project: "项目计划",
};

export function canvasStarterTemplateName(id: CanvasStarterTemplateId): string {
  return TEMPLATE_NAMES[id];
}

/** 面板只在「完全空白」的画布上出现：没有页面，也没有任何自由元素。 */
export function isCanvasDocEmpty(doc: Pick<CanvasDoc, "boards" | "freeItems">): boolean {
  return doc.boards.length === 0 && doc.freeItems.length === 0;
}

// ---- 几何常量（世界坐标） ----

/** 便签默认宽（与 commands.createFreeSticky 一致）。 */
const STICKY_WIDTH = 220;
/** 流程图节点宽。 */
const FLOW_NODE_WIDTH = 200;
/** 空/单行文本自由元素的外高：最小内容高 + 模块内边距与边框。与 layout.freeItemHeight 同源。 */
const FREE_TEXT_MIN_OUTER_HEIGHT = MIN_TEXT_CONTENT_HEIGHT + BLOCK_CHROME;
/** 便签行距：留出一行输入增长空间后仍不相互覆盖。 */
const STICKY_ROW_PITCH = FREE_TEXT_MIN_OUTER_HEIGHT + 60;
/** 流程图节点行距：节点间要放得下带箭头的连接线。 */
const FLOW_ROW_PITCH = FREE_TEXT_MIN_OUTER_HEIGHT + 68;
/** 页面放置：页面左上角在锚点上方的偏移（插入后由调用方适合视口，精确值不重要）。 */
const BOARD_ANCHOR_OFFSET_Y = 180;

// ---- 小构造函数 ----

interface BuildContext {
  /** 锚点（整数世界坐标）。 */
  center: { x: number; y: number };
  /** 现有自由元素的最大 zIndex；新元素从其上递增。 */
  zBase: number;
  newId: CanvasIdGenerator;
}

interface TemplateFragment {
  boards: CanvasBoard[];
  freeItems: CanvasFreeItem[];
  connectors: CanvasConnector[];
  focus: CanvasFocus;
}

function text(
  role: CanvasTextRole,
  value: string,
  style: CanvasBlockStyle | undefined,
  newId: CanvasIdGenerator,
): CanvasTextBlock {
  const block = createTextBlock(role, value, newId);
  if (style) block.style = style;
  return block;
}

/** 列标题：标题角色但用正文字号（16px 加粗），避免 28px 大标题撑爆分栏。 */
function columnTitle(value: string, newId: CanvasIdGenerator, background?: string): CanvasTextBlock {
  return text(
    "title",
    value,
    background ? { fontSize: "md", background, radius: 8 } : { fontSize: "md" },
    newId,
  );
}

function board(
  args: { name: string; x: number; y: number; width?: number; regions: CanvasBoard["regions"] },
  newId: CanvasIdGenerator,
): CanvasBoard {
  return {
    id: newId(),
    name: args.name,
    x: args.x,
    y: args.y,
    width: args.width ?? BOARD_DEFAULT_WIDTH,
    padding: BOARD_PADDING,
    gap: BOARD_GAP,
    regions: args.regions,
  };
}

function freeText(
  args: { x: number; y: number; width: number; text: string; style: CanvasBlockStyle; zIndex: number },
  newId: CanvasIdGenerator,
): CanvasFreeItem {
  return {
    id: newId(),
    x: args.x,
    y: args.y,
    width: args.width,
    zIndex: args.zIndex,
    block: text("body", args.text, args.style, newId),
  };
}

function connector(from: CanvasFreeItem, to: CanvasFreeItem, newId: CanvasIdGenerator): CanvasConnector {
  return {
    id: newId(),
    from: from.id,
    to: to.id,
    fromSide: "bottom",
    toSide: "top",
    arrow: "end",
    line: "solid",
    color: "",
    label: "",
  };
}

/** 页面模板共用：页面居中于锚点、略偏上，插入后选中整页。 */
function pageFragment(
  ctx: BuildContext,
  args: { name: string; width: number; regions: CanvasBoard["regions"] },
): TemplateFragment {
  const page = board(
    {
      name: args.name,
      x: ctx.center.x - args.width / 2,
      y: ctx.center.y - BOARD_ANCHOR_OFFSET_Y,
      width: args.width,
      regions: args.regions,
    },
    ctx.newId,
  );
  return { boards: [page], freeItems: [], connectors: [], focus: { kind: "board", boardId: page.id } };
}

// ---- 模板 ----

/** 头脑风暴：中心主题便签（蓝）+ 左右各三张空白黄色便签。 */
function brainstorm({ center, zBase, newId }: BuildContext): TemplateFragment {
  const topicWidth = 240;
  const topicY = center.y - FREE_TEXT_MIN_OUTER_HEIGHT / 2;
  let z = zBase;
  const topic = freeText(
    {
      x: center.x - topicWidth / 2,
      y: topicY,
      width: topicWidth,
      text: "中心主题",
      style: { background: "blue", radius: 8, align: "center", bold: true },
      zIndex: ++z,
    },
    newId,
  );
  const columnGap = 60;
  const leftX = center.x - topicWidth / 2 - columnGap - STICKY_WIDTH;
  const rightX = center.x + topicWidth / 2 + columnGap;
  const ideas: CanvasFreeItem[] = [];
  for (const x of [leftX, rightX]) {
    for (let row = -1; row <= 1; row += 1) {
      ideas.push(
        freeText(
          { x, y: topicY + row * STICKY_ROW_PITCH, width: STICKY_WIDTH, text: "", style: { background: "yellow", radius: 8 }, zIndex: ++z },
          newId,
        ),
      );
    }
  }
  return {
    boards: [],
    freeItems: [topic, ...ideas],
    connectors: [],
    focus: { kind: "free", itemId: topic.id, edit: false },
  };
}

/** 流程图：开始 → 第一步 → 第二步 → 结束，纵向排列，自由文本节点 + 三条带箭头的连接线。 */
function flowchart({ center, zBase, newId }: BuildContext): TemplateFragment {
  const labels: Array<{ text: string; background: string }> = [
    { text: "开始", background: "green" },
    { text: "第一步", background: "blue" },
    { text: "第二步", background: "blue" },
    { text: "结束", background: "gray" },
  ];
  const top = center.y - (FLOW_ROW_PITCH * (labels.length - 1) + FREE_TEXT_MIN_OUTER_HEIGHT) / 2;
  let z = zBase;
  const nodes = labels.map((label, index) =>
    freeText(
      {
        x: center.x - FLOW_NODE_WIDTH / 2,
        y: top + index * FLOW_ROW_PITCH,
        width: FLOW_NODE_WIDTH,
        text: label.text,
        style: { background: label.background, radius: 8, align: "center" },
        zIndex: ++z,
      },
      newId,
    ),
  );
  const connectors = nodes.slice(1).map((node, index) => connector(nodes[index], node, newId));
  return {
    boards: [],
    freeItems: nodes,
    connectors,
    focus: { kind: "free", itemId: nodes[0].id, edit: false },
  };
}

/** 看板：一个页面，一行三列（待办 / 进行中 / 完成），每列列标题 + 两张空卡片。 */
function kanban(ctx: BuildContext): TemplateFragment {
  const { newId } = ctx;
  const column = (title: string, background: string) =>
    createColumn(
      [columnTitle(title, newId, background), text("body", "", undefined, newId), text("body", "", undefined, newId)],
      newId,
    );
  const section = createSection(
    [column("待办", "gray"), column("进行中", "blue"), column("完成", "green")],
    newId,
  );
  return pageFragment(ctx, {
    name: TEMPLATE_NAMES.kanban,
    width: 840,
    regions: [createRegion([section], newId, "看板")],
  });
}

/** SWOT：一个页面，两行两列四象限（优势 / 劣势 / 机会 / 威胁），每格列标题 + 空正文。 */
function swot(ctx: BuildContext): TemplateFragment {
  const { newId } = ctx;
  const cell = (title: string, background: string) =>
    createColumn([columnTitle(title, newId, background), text("body", "", undefined, newId)], newId);
  const rows = [
    createSection([cell("优势 S", "green"), cell("劣势 W", "red")], newId),
    createSection([cell("机会 O", "blue"), cell("威胁 T", "yellow")], newId),
  ];
  return pageFragment(ctx, {
    name: TEMPLATE_NAMES.swot,
    width: 720,
    regions: [createRegion(rows, newId, "SWOT")],
  });
}

/** 项目计划：一个页面，三个区块——目标、里程碑（三列阶段）、下一步行动（列表）。 */
function project(ctx: BuildContext): TemplateFragment {
  const { newId } = ctx;
  const goal = createRegion(
    [
      createSection(
        [createColumn([text("title", "项目目标", undefined, newId), text("body", "", undefined, newId)], newId)],
        newId,
      ),
    ],
    newId,
    "目标",
  );
  const milestones = createRegion(
    [
      createSection(
        ["阶段一", "阶段二", "阶段三"].map((stage) =>
          createColumn([columnTitle(stage, newId), text("body", "", undefined, newId)], newId),
        ),
        newId,
      ),
    ],
    newId,
    "里程碑",
  );
  const next = createRegion(
    [createSection([createColumn([text("list", "", undefined, newId)], newId)], newId)],
    newId,
    "下一步行动",
  );
  return pageFragment(ctx, {
    name: TEMPLATE_NAMES.project,
    width: 720,
    regions: [goal, milestones, next],
  });
}

const BUILDERS: Record<CanvasStarterTemplateId, (ctx: BuildContext) => TemplateFragment> = {
  brainstorm,
  flowchart,
  kanban,
  swot,
  project,
};

/**
 * 把起步模板一次性写入文档：追加页面 / 自由元素 / 连接线，返回新文档与焦点。
 * 纯函数、不触碰输入 doc（历史快照同源）；一次 apply = 一条可撤销历史。
 */
export function applyCanvasStarterTemplate(
  doc: CanvasDoc,
  args: { template: CanvasStarterTemplateId; center: { x: number; y: number } },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasCommandResult {
  const draft: CanvasDoc = structuredClone(doc);
  draft.schemaVersion = CANVAS_SCHEMA_VERSION;
  const fragment = BUILDERS[args.template]({
    center: { x: Math.round(args.center.x), y: Math.round(args.center.y) },
    zBase: draft.freeItems.reduce((max, item) => Math.max(max, item.zIndex), 0),
    newId,
  });
  draft.boards.push(...fragment.boards);
  draft.freeItems.push(...fragment.freeItems);
  draft.connectors = [...(draft.connectors ?? []), ...fragment.connectors];
  return { doc: draft, focus: fragment.focus };
}
