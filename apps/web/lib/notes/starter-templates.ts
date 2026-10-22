import type { JSONContent } from "@tiptap/core";

/** 起步模板 id（空白页不是模板，是面板的关闭选项） */
export type StarterTemplateId = "meeting" | "weekly" | "reading" | "project" | "todo";

export const STARTER_TEMPLATE_IDS: readonly StarterTemplateId[] = [
  "meeting",
  "weekly",
  "reading",
  "project",
  "todo",
];

const TEMPLATE_NAMES: Record<StarterTemplateId, string> = {
  meeting: "会议纪要",
  weekly: "周报",
  reading: "读书笔记",
  project: "项目计划",
  todo: "待办清单",
};

export function starterTemplateName(id: StarterTemplateId): string {
  return TEMPLATE_NAMES[id];
}

/** 本地时区 `M月D日`（TASK：会议纪要/周报的日期用今天） */
export function formatStarterDate(today: Date): string {
  return `${today.getMonth() + 1}月${today.getDate()}日`;
}

/** 标题为空时顺带填入的默认标题：会议纪要/周报带当天日期，其余用模板名 */
export function starterTemplateDefaultTitle(id: StarterTemplateId, today: Date): string {
  if (id === "meeting" || id === "weekly") {
    return `${TEMPLATE_NAMES[id]} ${formatStarterDate(today)}`;
  }
  return TEMPLATE_NAMES[id];
}

// ---- 小构造函数（只产出 editor-extensions 已注册的节点类型；blockId 由 UniqueID 扩展自动补） ----

const text = (value: string): JSONContent => ({ type: "text", text: value });

const para = (value?: string): JSONContent => ({
  type: "paragraph",
  content: value ? [text(value)] : [],
});

const h2 = (value: string): JSONContent => ({
  type: "heading",
  attrs: { level: 2 },
  content: [text(value)],
});

const bullets = (items: string[]): JSONContent => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem", content: [para(item)] })),
});

const tasks = (items: string[]): JSONContent => ({
  type: "taskList",
  content: items.map((item) => ({
    type: "taskItem",
    attrs: { checked: false },
    content: [para(item)],
  })),
});

const quote = (value?: string): JSONContent => ({
  type: "blockquote",
  content: [para(value)],
});

const th = (value: string): JSONContent => ({ type: "tableHeader", content: [para(value)] });
const td = (): JSONContent => ({ type: "tableCell", content: [para()] });

const table = (headers: string[], bodyRows: number): JSONContent => ({
  type: "table",
  content: [
    { type: "tableRow", content: headers.map(th) },
    ...Array.from({ length: bodyRows }, () => ({
      type: "tableRow",
      content: headers.map(() => td()),
    })),
  ],
});

/**
 * 按模板 id 生成起步文档（JSONContent）。未知 id 返回 null。
 * 所有模板都含真实结构节点，`isEmptyDoc` 一律为 false——插入即视为有内容，
 * 不触发「空笔记离开自动丢弃」；整体作为一次 setContent 用户事务进入撤销栈。
 */
export function buildStarterTemplateContent(
  id: StarterTemplateId,
  today: Date
): JSONContent | null {
  switch (id) {
    case "meeting": {
      const date = formatStarterDate(today);
      return {
        type: "doc",
        content: [
          h2("会议信息"),
          bullets([`时间：${date}`, "地点：", "参会人：", "主持人："]),
          h2("议题讨论"),
          para(),
          h2("结论与行动项"),
          tasks([""]),
        ],
      };
    }
    case "weekly": {
      const date = formatStarterDate(today);
      return {
        type: "doc",
        content: [
          h2("本周工作"),
          bullets(["", "", ""]),
          h2("下周计划"),
          tasks(["", "", ""]),
          h2("问题与风险"),
          para(),
          para(`（周报日期：${date}）`),
        ],
      };
    }
    case "reading":
      return {
        type: "doc",
        content: [
          h2("书籍信息"),
          bullets(["书名：", "作者：", "阅读日期："]),
          h2("摘录"),
          quote(),
          h2("我的想法"),
          para(),
        ],
      };
    case "project":
      return {
        type: "doc",
        content: [
          h2("项目目标"),
          para(),
          h2("里程碑"),
          table(["阶段", "时间", "负责人"], 2),
          h2("风险与依赖"),
          para(),
          h2("下一步行动"),
          tasks([""]),
        ],
      };
    case "todo":
      return {
        type: "doc",
        content: [tasks(["", "", "", "", ""])],
      };
    default:
      return null;
  }
}
