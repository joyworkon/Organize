import { describe, expect, it } from "vitest";
import {
  CANVAS_STARTER_TEMPLATE_IDS,
  applyCanvasStarterTemplate,
  canvasStarterTemplateName,
  isCanvasDocEmpty,
  type CanvasStarterTemplateId,
} from "./starter-templates";
import { collectAllIds, emptyDoc, type CanvasDoc, type CanvasTextBlock } from "./model";
import { computeScene, freeItemHeight, sceneBounds } from "./layout";
import { validateCanvasContent } from "./validation";
import { createFreeSticky } from "./commands";

/** 确定性 id：同输入同输出，便于断言文档形状。 */
const idGen = () => {
  let n = 0;
  return () => `id-${++n}`;
};
/** 单行文本测高：正文 16px × 1.6 ≈ 26。 */
const measure = () => 26;
const CENTER = { x: 400, y: 300 };

function apply(template: CanvasStarterTemplateId, doc: CanvasDoc = emptyDoc()) {
  return applyCanvasStarterTemplate(doc, { template, center: CENTER }, idGen());
}

function blocksOf(doc: CanvasDoc) {
  return doc.boards.flatMap((b) => b.regions).flatMap((r) => r.sections).flatMap((s) => s.columns).flatMap((c) => c.blocks);
}

function rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe("起步模板元数据", () => {
  it("五个内容模板都有名称；空白判定只看页面与自由元素", () => {
    expect(CANVAS_STARTER_TEMPLATE_IDS).toHaveLength(5);
    for (const id of CANVAS_STARTER_TEMPLATE_IDS) expect(canvasStarterTemplateName(id)).not.toBe("");
    expect(isCanvasDocEmpty(emptyDoc())).toBe(true);
    expect(isCanvasDocEmpty({ boards: [], freeItems: [] })).toBe(true);
    expect(isCanvasDocEmpty(createFreeSticky(emptyDoc(), { x: 0, y: 0 }).doc)).toBe(false);
    expect(isCanvasDocEmpty(apply("kanban").doc)).toBe(false);
  });
});

describe("applyCanvasStarterTemplate 合同", () => {
  it.each(CANVAS_STARTER_TEMPLATE_IDS)("%s：不动输入文档、schemaVersion=2、ID 唯一、可通过校验、空白判定为假", (template) => {
    const before = emptyDoc();
    const result = apply(template, before);
    expect(before).toEqual(emptyDoc());
    expect(result.doc.schemaVersion).toBe(2);
    const ids = collectAllIds(result.doc);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateCanvasContent(result.doc)).toMatchObject({ ok: true, errors: [] });
    expect(isCanvasDocEmpty(result.doc)).toBe(false);
    expect(result.focus).not.toBeNull();
  });

  it.each(CANVAS_STARTER_TEMPLATE_IDS)("%s：自由元素互不重叠，且整体包围盒围绕锚点", (template) => {
    const { doc } = apply(template);
    const boxes = doc.freeItems.map((item) => ({ x: item.x, y: item.y, width: item.width, height: freeItemHeight(item, measure) }));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(rectsOverlap(boxes[i], boxes[j])).toBe(false);
      }
    }
    const bounds = sceneBounds(computeScene(doc, measure));
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeLessThan(CENTER.x);
    expect(bounds!.x + bounds!.width).toBeGreaterThan(CENTER.x);
    expect(bounds!.y).toBeLessThan(CENTER.y);
    expect(bounds!.y + bounds!.height).toBeGreaterThan(CENTER.y);
  });

  it("确定性：同锚点同 id 生成器两次产出逐字段相同；锚点取整", () => {
    expect(apply("flowchart").doc).toEqual(apply("flowchart").doc);
    const shifted = applyCanvasStarterTemplate(emptyDoc(), { template: "flowchart", center: { x: 400.4, y: 299.6 } }, idGen());
    expect(shifted.doc).toEqual(apply("flowchart").doc);
  });

  it("头脑风暴：中心主题便签 + 六张黄色空便签，选中主题（不进编辑），无页面", () => {
    const { doc, focus } = apply("brainstorm");
    expect(doc.boards).toEqual([]);
    expect(doc.connectors).toEqual([]);
    expect(doc.freeItems).toHaveLength(7);
    const [topic, ...ideas] = doc.freeItems;
    expect(topic.block).toMatchObject({ type: "text", text: "中心主题", style: { background: "blue", radius: 8 } });
    for (const idea of ideas) {
      expect(idea.width).toBe(220);
      expect(idea.block).toMatchObject({ type: "text", role: "body", text: "", style: { background: "yellow", radius: 8 } });
    }
    expect(ideas.filter((idea) => idea.x < topic.x)).toHaveLength(3);
    expect(ideas.filter((idea) => idea.x > topic.x)).toHaveLength(3);
    expect(new Set(doc.freeItems.map((item) => item.zIndex)).size).toBe(7);
    expect(focus).toEqual({ kind: "free", itemId: topic.id, edit: false });
  });

  it("流程图：四个纵向节点 + 三条首尾相连的箭头连接线，端点都存在", () => {
    const { doc, focus } = apply("flowchart");
    expect(doc.boards).toEqual([]);
    expect(doc.freeItems.map((item) => (item.block as CanvasTextBlock).text)).toEqual(["开始", "第一步", "第二步", "结束"]);
    const xs = new Set(doc.freeItems.map((item) => item.x));
    expect(xs.size).toBe(1);
    const ys = doc.freeItems.map((item) => item.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(doc.connectors).toHaveLength(3);
    const live = new Set(doc.freeItems.map((item) => item.id));
    doc.connectors!.forEach((edge, index) => {
      expect(live.has(edge.from) && live.has(edge.to)).toBe(true);
      expect(edge.from).toBe(doc.freeItems[index].id);
      expect(edge.to).toBe(doc.freeItems[index + 1].id);
      expect(edge).toMatchObject({ arrow: "end", line: "solid", fromSide: "bottom", toSide: "top", color: "", label: "" });
    });
    expect(focus).toEqual({ kind: "free", itemId: doc.freeItems[0].id, edit: false });
  });

  it("看板：一页三列（待办 / 进行中 / 完成），每列列标题 + 两张空卡片，选中整页", () => {
    const { doc, focus } = apply("kanban");
    expect(doc.freeItems).toEqual([]);
    expect(doc.boards).toHaveLength(1);
    const page = doc.boards[0];
    expect(page.name).toBe("看板");
    expect(page.x + page.width / 2).toBe(CENTER.x);
    expect(page.regions).toHaveLength(1);
    const section = page.regions[0].sections[0];
    expect(section.columns).toHaveLength(3);
    expect(section.columnWeights).toEqual([1, 1, 1]);
    const titles = section.columns.map((column) => (column.blocks[0] as CanvasTextBlock).text);
    expect(titles).toEqual(["待办", "进行中", "完成"]);
    for (const column of section.columns) {
      expect(column.blocks).toHaveLength(3);
      expect(column.blocks[0]).toMatchObject({ type: "text", role: "title", style: { fontSize: "md" } });
      expect(column.blocks.slice(1).every((block) => block.type === "text" && block.text === "")).toBe(true);
    }
    expect(focus).toEqual({ kind: "board", boardId: page.id });
  });

  it("SWOT：一页两行两列四象限，标题依次为优势/劣势/机会/威胁", () => {
    const { doc } = apply("swot");
    const page = doc.boards[0];
    expect(page.name).toBe("SWOT 分析");
    const region = page.regions[0];
    expect(region.sections).toHaveLength(2);
    const quadrants = region.sections.flatMap((section) => {
      expect(section.columns).toHaveLength(2);
      return section.columns.map((column) => (column.blocks[0] as CanvasTextBlock).text);
    });
    expect(quadrants).toEqual(["优势 S", "劣势 W", "机会 O", "威胁 T"]);
  });

  it("项目计划：目标 / 里程碑（三列）/ 下一步行动（列表）三个区块", () => {
    const { doc } = apply("project");
    const page = doc.boards[0];
    expect(page.name).toBe("项目计划");
    expect(page.regions.map((region) => region.name)).toEqual(["目标", "里程碑", "下一步行动"]);
    expect(page.regions[1].sections[0].columns).toHaveLength(3);
    expect(page.regions[2].sections[0].columns[0].blocks[0]).toMatchObject({ type: "text", role: "list", text: "" });
    expect(blocksOf(doc).some((block) => block.type === "text" && block.text === "项目目标")).toBe(true);
  });

  it("非空文档也只追加，不改已有对象，自由元素层级接在现有之上", () => {
    const base = createFreeSticky(emptyDoc(), { x: 2000, y: 2000 }).doc;
    base.freeItems[0].zIndex = 9;
    const { doc } = apply("brainstorm", base);
    expect(doc.freeItems[0]).toEqual(base.freeItems[0]);
    expect(doc.freeItems).toHaveLength(8);
    expect(doc.freeItems.slice(1).every((item) => item.zIndex > 9)).toBe(true);
  });
});
