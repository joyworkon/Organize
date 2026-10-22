import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { isEmptyDoc } from "./empty-note";
import {
  buildStarterTemplateContent,
  formatStarterDate,
  starterTemplateDefaultTitle,
  starterTemplateName,
  STARTER_TEMPLATE_IDS,
  type StarterTemplateId,
} from "./starter-templates";

/** 编辑器已注册、模板允许使用的节点类型白名单（与 editor-extensions.ts 对齐） */
const ALLOWED_NODE_TYPES = new Set([
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);

function walk(node: JSONContent, visit: (node: JSONContent) => void) {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

describe("formatStarterDate", () => {
  it("本地时区 M月D日", () => {
    // 用本地时间构造（非 UTC 字符串），与生产调用的 new Date() 同一时区语义
    expect(formatStarterDate(new Date(2026, 9, 22, 12, 0, 0))).toBe("10月22日");
    expect(formatStarterDate(new Date(2026, 0, 1, 0, 30, 0))).toBe("1月1日");
  });
});

describe("starterTemplateDefaultTitle", () => {
  const today = new Date(2026, 9, 22, 12, 0, 0);

  it("会议纪要/周报带当天日期", () => {
    expect(starterTemplateDefaultTitle("meeting", today)).toBe("会议纪要 10月22日");
    expect(starterTemplateDefaultTitle("weekly", today)).toBe("周报 10月22日");
  });

  it("其余模板用模板名", () => {
    expect(starterTemplateDefaultTitle("reading", today)).toBe("读书笔记");
    expect(starterTemplateDefaultTitle("project", today)).toBe("项目计划");
    expect(starterTemplateDefaultTitle("todo", today)).toBe("待办清单");
  });
});

describe("buildStarterTemplateContent", () => {
  it.each(STARTER_TEMPLATE_IDS)("%s：结构合法且非空文档", (id: StarterTemplateId) => {
    const doc = buildStarterTemplateContent(id, new Date(2026, 9, 22, 12, 0, 0));
    expect(doc).not.toBeNull();
    expect(doc!.type).toBe("doc");
    expect(Array.isArray(doc!.content)).toBe(true);
    expect(doc!.content!.length).toBeGreaterThan(0);
    walk(doc!, (node) => {
      expect(ALLOWED_NODE_TYPES.has(node.type ?? "")).toBe(true);
    });
    // 不手写 blockId（UniqueID 扩展自动补）
    walk(doc!, (node) => {
      expect(node.attrs?.id).toBeUndefined();
    });
    // 插入后即视为有内容：不触发「空笔记离开自动丢弃」，面板随之隐藏
    expect(isEmptyDoc(doc)).toBe(false);
  });

  it("会议纪要/周报包含当天日期", () => {
    const today = new Date(2026, 9, 22, 12, 0, 0);
    for (const id of ["meeting", "weekly"] as const) {
      const doc = buildStarterTemplateContent(id, today)!;
      let found = false;
      walk(doc, (node) => {
        if (node.type === "text" && node.text?.includes("10月22日")) found = true;
      });
      expect(found).toBe(true);
    }
  });

  it("每个模板都有可编辑的空段落（光标落点）", () => {
    for (const id of STARTER_TEMPLATE_IDS) {
      const doc = buildStarterTemplateContent(id, new Date())!;
      let hasEmptyParagraph = false;
      walk(doc, (node) => {
        if (node.type === "paragraph" && (node.content ?? []).length === 0) {
          hasEmptyParagraph = true;
        }
      });
      expect(hasEmptyParagraph).toBe(true);
    }
  });

  it("未知 id 返回 null", () => {
    expect(buildStarterTemplateContent("unknown" as StarterTemplateId, new Date())).toBeNull();
  });
});

describe("starterTemplateName", () => {
  it("五个模板均有中文名", () => {
    for (const id of STARTER_TEMPLATE_IDS) {
      expect(starterTemplateName(id)).toBeTruthy();
    }
  });
});
