/**
 * 构思画布数据模型（docs/idea-canvas-plan.md §6.1，阶段 B1 升级为三层结构）。
 *
 * 布局按 Board(页面) → Region(区块) → Section(行) → Column → Block 建模，
 * 自由容器独立存放。Section 在 v1 中实际承担行布局，v2 起语义为
 * 「区块内的行」，字段结构不变，仅多一层 Region 父级。
 * 自动模块不持久化 x/y 或测得高度；只存语义结构、宽度策略与样式。
 * schemaVersion 负责结构升级，数据库行上的 revision 负责并发（见 lib/canvas/validation.ts）。
 */

export const CANVAS_SCHEMA_VERSION = 2;
/** v1 版本号（migrateCanvasDocV1toV2 的输入标识）。 */
export const CANVAS_SCHEMA_VERSION_V1 = 1;
/** 迁移与默认新区块的名称。 */
export const DEFAULT_REGION_NAME = "内容";

/** 版面默认外宽（画布单位 = 100% 缩放时的 CSS px）。 */
export const BOARD_DEFAULT_WIDTH = 640;
export const BOARD_MIN_WIDTH = 320;
export const BOARD_MAX_WIDTH = 2000;
export const BOARD_PADDING = 24;
/** 模块间距：列间距与块间纵距共用。 */
export const BOARD_GAP = 16;
/** 列最小外宽；加号放不下一列时禁用（规格 §3.3）。 */
export const COLUMN_MIN_WIDTH = 120;
/** 模块内边距（左右/上下一致），布局测高时计入。 */
export const BLOCK_PADDING = 12;
/** 空文本块的最小内容高度，保证占位可见。 */
export const MIN_TEXT_CONTENT_HEIGHT = 24;

/** 文本字号档位（渲染与测量的唯一依据，见 canvas-text-styles.ts）。 */
export type CanvasFontSizeTier = "sm" | "md" | "lg" | "xl";
export type CanvasTextAlign = "left" | "center" | "right";

export interface CanvasBlockStyle {
  fontSize?: CanvasFontSizeTier;
  bold?: boolean;
  /** 预设色板键或 CSS 颜色；空串 = 默认前景色。 */
  color?: string;
  align?: CanvasTextAlign;
  /** 背景色（色板键）；null/undefined = 透明。 */
  background?: string | null;
  /** 圆角 px。 */
  radius?: number | null;
}

export type CanvasTextRole = "title" | "body";

export interface CanvasTextBlock {
  id: string;
  type: "text";
  text: string;
  role: CanvasTextRole;
  style?: CanvasBlockStyle;
}

/** 图片必须保存原始尺寸；ratio = naturalWidth / naturalHeight（规格 §4.2）。 */
export interface CanvasImageAsset {
  /**
   * 持久资源地址（真实：/storage/... 或 https；mock：mock-image:<key>）。
   * pending/failed 资产允许为空串（占位），但绝不保存 blob: 短期地址。
   */
  url: string;
  naturalWidth: number;
  naturalHeight: number;
  name?: string;
  /** pending/failed = 仅本机预览或上传失败，未持久化（规格 §6.4）。 */
  uploadStatus?: "saved" | "pending" | "failed";
  /** pending 资产的本机 Blob 键（IndexedDB，按账号隔离），供刷新后恢复/重试。 */
  localKey?: string;
}

export type CanvasImageFit = "contain" | "cover";

/** 自由图片容器比例：auto = 按图片自然比例（默认，等同现状）；其余为容器宽高比。 */
export type CanvasImageRatio = "auto" | "1:1" | "4:3" | "16:9";

/** 容器比例 → 宽/高倍数（1:1 = 宽 1 份高 1 份）。 */
export const IMAGE_RATIO_WIDTH_PER_HEIGHT: Record<Exclude<CanvasImageRatio, "auto">, number> = {
  "1:1": 1,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
};

export interface CanvasImageBlock {
  id: string;
  type: "image";
  asset: CanvasImageAsset | null;
  fit: CanvasImageFit;
  /** 容器比例（仅自由图片容器布局使用）；缺省 = auto。 */
  ratio?: CanvasImageRatio;
  style?: CanvasBlockStyle;
}

export type CanvasBlock = CanvasTextBlock | CanvasImageBlock;

export interface CanvasColumn {
  id: string;
  blocks: CanvasBlock[];
}

/**
 * widthMode：
 * - equal：等分（columnWeights 全 1）
 * - smart：一文一图智能比例；权重由测量触发点写入，编辑期间不重算（规格 §4.2）
 * - manual：用户拖过列分隔线，自动计算不再覆盖
 * columnWeights 恒与 columns 等长且为正数。
 */
export type CanvasSectionWidthMode = "equal" | "manual" | "smart";

/** 行（v1 的 Section 结构原样保留，v2 起挂到 Region 下）。 */
export interface CanvasSection {
  id: string;
  widthMode: CanvasSectionWidthMode;
  columnWeights: number[];
  columns: CanvasColumn[];
}

/** 区块装饰样式；padding/rowGap 缺省语义见 regionPadding/regionRowGap。 */
export interface CanvasRegionStyle {
  /** 背景色（色板键）；null/undefined = 透明。 */
  background?: string | null;
  /** 区块内边距；缺省 = 0（不额外吃版面宽度，保证 v1 迁移后几何不变）。 */
  padding?: number;
  /** 行间距；缺省 = 版面 gap（继承 v1 行距语义）。 */
  rowGap?: number;
  /** 用户显式开启的装饰边框（预览/只读也保留）。 */
  border?: boolean;
}

/** 区块：页面的子分区，内含若干行（sections）。 */
export interface CanvasRegion {
  id: string;
  name: string;
  style?: CanvasRegionStyle;
  sections: CanvasSection[];
}

export interface CanvasBoardStyle {
  background?: string | null;
  radius?: number | null;
}

export interface CanvasBoard {
  id: string;
  /** 页面名（可选；对外 UI 文案「页面」）。 */
  name?: string;
  /** 世界坐标（左上角）。 */
  x: number;
  y: number;
  width: number;
  padding: number;
  gap: number;
  style?: CanvasBoardStyle;
  regions: CanvasRegion[];
}

export type CanvasFreeItemBlock = CanvasTextBlock | CanvasImageBlock;

/** 自由容器：绝对定位，独立于自动版面（规格 §3.5）。高度由内容计算，不持久化。 */
export interface CanvasFreeItem {
  id: string;
  x: number;
  y: number;
  width: number;
  zIndex: number;
  block: CanvasFreeItemBlock;
}

export interface CanvasDoc {
  schemaVersion: typeof CANVAS_SCHEMA_VERSION;
  boards: CanvasBoard[];
  freeItems: CanvasFreeItem[];
}

/** v1 文档（Board → Section 直挂）；仅迁移函数消费。 */
interface CanvasDocV1Board {
  id: string;
  x: number;
  y: number;
  width: number;
  padding: number;
  gap: number;
  style?: CanvasBoardStyle;
  sections: CanvasSection[];
  name?: string;
}

interface CanvasDocV1 {
  schemaVersion: number;
  boards: CanvasDocV1Board[];
  freeItems: CanvasFreeItem[];
}

/** 结构操作后的焦点目标；命令纯函数不触碰 DOM。 */
export type CanvasFocus =
  | {
      kind: "block";
      boardId: string;
      regionId: string;
      sectionId: string;
      columnId: string;
      blockId: string;
      caret?: "start" | "end" | "select-all";
      edit?: boolean;
    }
  | { kind: "region"; boardId: string; regionId: string }
  | { kind: "board"; boardId: string }
  | { kind: "free"; itemId: string }
  | null;

export interface CanvasCommandResult {
  doc: CanvasDoc;
  focus?: CanvasFocus;
}

export type CanvasIdGenerator = () => string;

/** 默认 ID 生成：Web Crypto（浏览器与 Node 22 均可用）。测试注入确定性生成器。 */
export const defaultIdGenerator: CanvasIdGenerator = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

export function createTextBlock(
  role: CanvasTextRole = "body",
  text = "",
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasTextBlock {
  return { id: newId(), type: "text", text, role };
}

export function createImageBlock(
  asset: CanvasImageAsset | null = null,
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasImageBlock {
  return { id: newId(), type: "image", asset, fit: "contain" };
}

export function createColumn(
  blocks: CanvasBlock[] = [],
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasColumn {
  return { id: newId(), blocks };
}

export function createSection(
  columns: CanvasColumn[] = [],
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasSection {
  return { id: newId(), widthMode: "equal", columnWeights: columns.map(() => 1), columns };
}

export function createRegion(
  sections: CanvasSection[] = [],
  newId: CanvasIdGenerator = defaultIdGenerator,
  name: string = DEFAULT_REGION_NAME,
): CanvasRegion {
  return { id: newId(), name, sections };
}

/** 全新空文档：无版面；双击画布才创建。 */
export function emptyDoc(): CanvasDoc {
  return { schemaVersion: CANVAS_SCHEMA_VERSION, boards: [], freeItems: [] };
}

/**
 * 新版面：标题分区（单列单标题块）+ 一个正文分区（规格 §3.1：首块默认标题），
 * 包在一个默认区块「内容」内（v2 三层结构）。
 */
export function createBoardShape(
  at: { x: number; y: number },
  newId: CanvasIdGenerator = defaultIdGenerator,
): CanvasBoard {
  const titleSection = createSection([createColumn([createTextBlock("title")], newId)], newId);
  const bodySection = createSection([createColumn([createTextBlock("body")], newId)], newId);
  return {
    id: newId(),
    x: at.x,
    y: at.y,
    width: BOARD_DEFAULT_WIDTH,
    padding: BOARD_PADDING,
    gap: BOARD_GAP,
    regions: [createRegion([titleSection, bodySection], newId)],
  };
}

// ---------------------------------------------------------------------------
// v1 → v2 迁移（阶段 B1）
// ---------------------------------------------------------------------------

/**
 * v1 → v2 纯迁移：每个 board 的原 sections 按原顺序包进一个默认 Region
 * （name「内容」）。Region id 基于 boardId 确定性派生（`r-<boardId>`），
 * 同输入同输出，且不依赖外部 id 生成器；其余所有 ID/样式/内容逐字段不变，
 * freeItems 原样不动；region.style 留空——布局时 padding 缺省 0、rowGap 缺省
 * 继承 board.gap（见 regionPadding/regionRowGap），保证 v1 文档迁移后
 * 渲染几何逐像素不变。v2 输入原样返回（幂等）。
 */
export function migrateCanvasDocV1toV2(raw: unknown): CanvasDoc {
  if (typeof raw !== "object" || raw === null) return raw as CanvasDoc;
  const doc = raw as CanvasDocV1;
  if (doc.schemaVersion === CANVAS_SCHEMA_VERSION) return raw as CanvasDoc;
  const clone: CanvasDocV1 = structuredClone(raw) as CanvasDocV1;
  const boards: CanvasBoard[] = (clone.boards ?? []).map((board) => {
    const { sections, ...rest } = board;
    const region: CanvasRegion = {
      id: `r-${board.id}`,
      name: DEFAULT_REGION_NAME,
      sections: sections ?? [],
    };
    return { ...rest, regions: [region] } as CanvasBoard;
  });
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    boards,
    freeItems: clone.freeItems ?? [],
  };
}

/**
 * 读取侧统一入口：v1 自动迁移、v2 直返、未知更高版本原样返回
 * （沿用未知数据保留语义，由 validation 报告 schemaVersion 错误并阻止保存）。
 * 非对象输入原样返回，交给校验层报错。
 */
export function ensureCanvasDocV2(raw: unknown): CanvasDoc {
  if (typeof raw !== "object" || raw === null) return raw as CanvasDoc;
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (version === CANVAS_SCHEMA_VERSION) return raw as CanvasDoc;
  if (version === CANVAS_SCHEMA_VERSION_V1 || version === undefined) {
    return migrateCanvasDocV1toV2(raw);
  }
  return raw as CanvasDoc;
}

// ---------------------------------------------------------------------------
// 遍历辅助
// ---------------------------------------------------------------------------

export interface BlockLocation {
  board: CanvasBoard;
  region: CanvasRegion;
  section: CanvasSection;
  column: CanvasColumn;
  block: CanvasBlock;
  regionIndex: number;
  sectionIndex: number;
  columnIndex: number;
  blockIndex: number;
}

export function findBoard(doc: CanvasDoc, boardId: string): CanvasBoard | null {
  return doc.boards.find((b) => b.id === boardId) ?? null;
}

export function findRegion(
  doc: CanvasDoc,
  regionId: string,
): { board: CanvasBoard; region: CanvasRegion; regionIndex: number } | null {
  for (const board of doc.boards) {
    const regionIndex = board.regions.findIndex((r) => r.id === regionId);
    if (regionIndex >= 0) {
      return { board, region: board.regions[regionIndex], regionIndex };
    }
  }
  return null;
}

export function findSection(
  doc: CanvasDoc,
  sectionId: string,
): {
  board: CanvasBoard;
  region: CanvasRegion;
  section: CanvasSection;
  regionIndex: number;
  sectionIndex: number;
} | null {
  for (const board of doc.boards) {
    for (let regionIndex = 0; regionIndex < board.regions.length; regionIndex += 1) {
      const region = board.regions[regionIndex];
      const sectionIndex = region.sections.findIndex((s) => s.id === sectionId);
      if (sectionIndex >= 0) {
        return { board, region, section: region.sections[sectionIndex], regionIndex, sectionIndex };
      }
    }
  }
  return null;
}

export function findColumn(
  doc: CanvasDoc,
  columnId: string,
): { board: CanvasBoard; region: CanvasRegion; section: CanvasSection; column: CanvasColumn } | null {
  for (const board of doc.boards) {
    for (const region of board.regions) {
      for (const section of region.sections) {
        const column = section.columns.find((c) => c.id === columnId);
        if (column) return { board, region, section, column };
      }
    }
  }
  return null;
}

export function findBlockLocation(doc: CanvasDoc, blockId: string): BlockLocation | null {
  for (const board of doc.boards) {
    for (let regionIndex = 0; regionIndex < board.regions.length; regionIndex += 1) {
      const region = board.regions[regionIndex];
      for (let sectionIndex = 0; sectionIndex < region.sections.length; sectionIndex += 1) {
        const section = region.sections[sectionIndex];
        for (let columnIndex = 0; columnIndex < section.columns.length; columnIndex += 1) {
          const column = section.columns[columnIndex];
          const blockIndex = column.blocks.findIndex((bl) => bl.id === blockId);
          if (blockIndex >= 0) {
            return {
              board,
              region,
              section,
              column,
              block: column.blocks[blockIndex],
              regionIndex,
              sectionIndex,
              columnIndex,
              blockIndex,
            };
          }
        }
      }
    }
  }
  return null;
}

export function findFreeItem(doc: CanvasDoc, itemId: string): CanvasFreeItem | null {
  return doc.freeItems.find((f) => f.id === itemId) ?? null;
}

// ---------------------------------------------------------------------------
// 结构整理（规格 §6.1：删空列/空行/空区块，版面永不为空，不改剩余 ID）
// ---------------------------------------------------------------------------

/** 删除列内所有空列；行没有列时删除行；区块没有行时删除区块；版面空了保留一个可输入的空正文块。 */
export function normalizeBoardAfterDeletion(board: CanvasBoard, newId: CanvasIdGenerator): void {
  board.regions = board.regions.filter((region) => {
    region.sections = region.sections.filter((section) => {
      section.columns = section.columns.filter((column) => column.blocks.length > 0);
      if (section.columns.length > 0 && section.columnWeights.length !== section.columns.length) {
        section.columnWeights = section.columns.map(() => 1);
        section.widthMode = "equal";
      }
      return section.columns.length > 0;
    });
    return region.sections.length > 0;
  });
  if (board.regions.length === 0) {
    board.regions = [
      createRegion([createSection([createColumn([createTextBlock("body")], newId)], newId)], newId),
    ];
  }
}

/** 文档内全部对象 ID（校验重复用）。 */
export function collectAllIds(doc: CanvasDoc): string[] {
  const ids: string[] = [];
  for (const board of doc.boards) {
    ids.push(board.id);
    for (const region of board.regions) {
      ids.push(region.id);
      for (const section of region.sections) {
        ids.push(section.id);
        for (const column of section.columns) {
          ids.push(column.id);
          for (const block of column.blocks) ids.push(block.id);
        }
      }
    }
  }
  for (const item of doc.freeItems) {
    ids.push(item.id);
    ids.push(item.block.id);
  }
  return ids;
}

/** 统计节点数（服务器/客户端共用上限校验）。 */
export function countNodes(doc: CanvasDoc): {
  boards: number;
  regions: number;
  sections: number;
  columns: number;
  blocks: number;
  freeItems: number;
} {
  let regions = 0;
  let sections = 0;
  let columns = 0;
  let blocks = 0;
  for (const board of doc.boards) {
    regions += board.regions.length;
    for (const region of board.regions) {
      sections += region.sections.length;
      for (const section of region.sections) {
        columns += section.columns.length;
        for (const column of section.columns) blocks += column.blocks.length;
      }
    }
  }
  return { boards: doc.boards.length, regions, sections, columns, blocks, freeItems: doc.freeItems.length };
}

/** 块的生效样式：显式样式优先，否则按角色给默认（标题大号加粗）。 */
export function effectiveTextStyle(block: CanvasTextBlock): Required<
  Pick<CanvasBlockStyle, "fontSize" | "bold" | "align">
> & { color: string } {
  const style = block.style ?? {};
  return {
    fontSize: style.fontSize ?? (block.role === "title" ? "lg" : "md"),
    bold: style.bold ?? block.role === "title",
    align: style.align ?? "left",
    color: style.color ?? "",
  };
}

/** 图片自然高度（含模块内边距）：宽度/比例，加载失败或无资产时给占位高。 */
export function imageNaturalHeight(
  block: CanvasImageBlock,
  innerWidth: number,
): number {
  const asset = block.asset;
  if (!asset || asset.naturalWidth <= 0 || asset.naturalHeight <= 0) {
    return IMAGE_PLACEHOLDER_HEIGHT;
  }
  return innerWidth / (asset.naturalWidth / asset.naturalHeight);
}

export const IMAGE_PLACEHOLDER_HEIGHT = 180;

/** 供备份/服务器校验的持久化资产守卫：blob:/data: 不允许进文档（规格 §6.4）。 */
export function isPersistableAssetUrl(url: string): boolean {
  return /^https?:\/\/|^\/storage\//.test(url) || url.startsWith("mock-image:");
}
