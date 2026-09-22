import { describe, expect, it } from "vitest";
import {
  CANVAS_SCHEMA_VERSION,
  collectAllIds,
  ensureCanvasDocV2,
  migrateCanvasDocV1toV2,
  type CanvasDoc,
} from "./model";
import { validateCanvasContent, isDocSavable } from "./validation";

/** v1 fixture：两个版面（多行/多列/样式/图片/自由容器），字段覆盖尽量全。 */
function v1Fixture() {
  return {
    schemaVersion: 1,
    boards: [
      {
        id: "b1",
        x: 10,
        y: 20,
        width: 640,
        padding: 24,
        gap: 16,
        style: { background: "gray", radius: 8 },
        sections: [
          {
            id: "s1",
            widthMode: "equal",
            columnWeights: [1],
            columns: [
              {
                id: "c1",
                blocks: [
                  { id: "k1", type: "text", text: "标题", role: "title", style: { bold: true, color: "red" } },
                ],
              },
            ],
          },
          {
            id: "s2",
            widthMode: "manual",
            columnWeights: [2, 1],
            columns: [
              {
                id: "c2",
                blocks: [
                  {
                    id: "k2",
                    type: "image",
                    asset: { url: "https://example.com/a.png", naturalWidth: 100, naturalHeight: 50, name: "图" },
                    fit: "cover",
                    style: { radius: 4 },
                  },
                ],
              },
              { id: "c3", blocks: [{ id: "k3", type: "text", text: "正文", role: "body" }] },
            ],
          },
        ],
      },
      {
        id: "b2",
        x: 0,
        y: 500,
        width: 800,
        padding: 32,
        gap: 20,
        sections: [
          {
            id: "s3",
            widthMode: "smart",
            columnWeights: [300, 272],
            columns: [
              { id: "c4", blocks: [{ id: "k4", type: "text", text: "左", role: "body" }] },
              { id: "c5", blocks: [{ id: "k5", type: "text", text: "右", role: "body" }] },
            ],
          },
        ],
      },
    ],
    freeItems: [
      { id: "f1", x: 1, y: 2, width: 240, zIndex: 3, block: { id: "fb1", type: "text", text: "自由", role: "body" } },
    ],
  };
}

describe("migrateCanvasDocV1toV2", () => {
  it("v1 迁移：每个 board 的原 sections 按序包进一个默认 Region「内容」", () => {
    const out = migrateCanvasDocV1toV2(v1Fixture());
    expect(out.schemaVersion).toBe(CANVAS_SCHEMA_VERSION);
    expect(out.boards).toHaveLength(2);
    const [b1, b2] = out.boards;
    expect(b1.regions).toHaveLength(1);
    expect(b1.regions[0].name).toBe("内容");
    expect(b1.regions[0].id).toBe("r-b1");
    expect(b1.regions[0].sections.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(b2.regions[0].id).toBe("r-b2");
    expect(b2.regions[0].sections.map((s) => s.id)).toEqual(["s3"]);
    // 不再有 v1 直挂字段
    expect("sections" in b1).toBe(false);
  });

  it("迁移后 ID 集合 = v1 全部 ID + 每 board 一个派生 Region ID（无丢失无重复）", () => {
    const fixture = v1Fixture();
    const v1Ids = ["b1", "b2", "s1", "s2", "s3", "c1", "c2", "c3", "c4", "c5", "k1", "k2", "k3", "k4", "k5", "f1", "fb1"];
    const out = migrateCanvasDocV1toV2(fixture);
    const ids = collectAllIds(out);
    for (const id of v1Ids) expect(ids).toContain(id);
    expect(ids).toContain("r-b1");
    expect(ids).toContain("r-b2");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("文本内容/角色/样式/列宽策略逐字段不变；freeItems 原样", () => {
    const fixture = v1Fixture();
    const out = migrateCanvasDocV1toV2(fixture);
    const b1 = out.boards[0];
    const k1b = b1.regions[0].sections[0].columns[0].blocks[0];
    expect(k1b).toEqual({ id: "k1", type: "text", text: "标题", role: "title", style: { bold: true, color: "red" } });
    const s2 = b1.regions[0].sections[1];
    expect(s2.widthMode).toBe("manual");
    expect(s2.columnWeights).toEqual([2, 1]);
    const k2 = s2.columns[0].blocks[0];
    expect(k2.type).toBe("image");
    if (k2.type === "image") {
      expect(k2.asset).toEqual({
        url: "https://example.com/a.png",
        naturalWidth: 100,
        naturalHeight: 50,
        name: "图",
      });
      expect(k2.fit).toBe("cover");
      expect(k2.style).toEqual({ radius: 4 });
    }
    // 版面坐标/尺寸/样式不变
    expect(b1).toMatchObject({ id: "b1", x: 10, y: 20, width: 640, padding: 24, gap: 16, style: { background: "gray", radius: 8 } });
    // freeItems 引用相等（原样不动）
    expect(out.freeItems).toEqual(fixture.freeItems);
  });

  it("确定性：同输入两次迁移结果深相等；不修改原对象", () => {
    const fixture = v1Fixture();
    const snapshot = structuredClone(fixture);
    const a = migrateCanvasDocV1toV2(fixture);
    const b = migrateCanvasDocV1toV2(fixture);
    expect(a).toEqual(b);
    expect(fixture).toEqual(snapshot); // 纯函数：输入不被改动
  });

  it("幂等：v2 输入原样返回（同引用）", () => {
    const v2 = migrateCanvasDocV1toV2(v1Fixture());
    expect(migrateCanvasDocV1toV2(v2)).toBe(v2);
  });

  it("迁移结果直接通过 v2 校验（保存永远写 v2）", () => {
    const out = migrateCanvasDocV1toV2(v1Fixture());
    const res = validateCanvasContent(out);
    expect(res.errors).toEqual([]);
    expect(isDocSavable(res)).toBe(true);
    expect(res.doc!.schemaVersion).toBe(CANVAS_SCHEMA_VERSION);
  });
});

describe("ensureCanvasDocV2（读取侧统一入口）", () => {
  it("v1 自动迁移；v2 直返（同引用）；未知更高版本原样保留", () => {
    const v1 = v1Fixture();
    const out = ensureCanvasDocV2(v1);
    expect(out.schemaVersion).toBe(2);
    const v2 = migrateCanvasDocV1toV2(v1Fixture());
    expect(ensureCanvasDocV2(v2)).toBe(v2);
    const future = { schemaVersion: 99, boards: [], freeItems: [] };
    expect(ensureCanvasDocV2(future)).toBe(future);
  });

  it("v1 无 regions 字段的对象也视为 v1 处理", () => {
    const legacy = { schemaVersion: 1, boards: [{ id: "bx", x: 0, y: 0, width: 640, padding: 24, gap: 16, sections: [] }], freeItems: [] };
    const out = ensureCanvasDocV2(legacy);
    expect(out.schemaVersion).toBe(2);
    expect(out.boards[0].regions[0].id).toBe("r-bx");
  });

  it("备份 v6 恢复出的 v1 content：读取时迁移、保存时写 v2（恢复后读取断言）", () => {
    // 模拟备份恢复链：restore.ts 不重写 content，v1 原样进库
    const restoredRow = {
      id: "doc-1",
      title: "旧备份",
      content: v1Fixture(), // 备份里的 v1 content 原样恢复
      revision: 1,
    };
    // 读取路径（repository.getCanvas → workspace init）统一 ensure
    const doc: CanvasDoc = ensureCanvasDocV2(restoredRow.content);
    expect(doc.schemaVersion).toBe(2);
    const res = validateCanvasContent(doc);
    expect(res.ok).toBe(true);
    // 下一次保存（PATCH）会带 schemaVersion=2 → 服务端校验通过、落库 v2
    expect(validateCanvasContent(doc).doc!.schemaVersion).toBe(2);
  });
});
