export const TEXT_COLORS = [
  { label: "默认", value: null },
  { label: "灰色", value: "#787774" },
  { label: "棕色", value: "#9f6b53" },
  { label: "橙色", value: "#d9730d" },
  { label: "黄色", value: "#cb912f" },
  { label: "绿色", value: "#448361" },
  { label: "蓝色", value: "#337ea9" },
  { label: "紫色", value: "#9065b0" },
  { label: "红色", value: "#d44c47" },
];

export const BACKGROUNDS = [
  { label: "无背景", value: null },
  { label: "灰色背景", value: "rgba(120,119,116,.12)" },
  { label: "棕色背景", value: "rgba(159,107,83,.14)" },
  { label: "橙色背景", value: "rgba(217,115,13,.14)" },
  { label: "黄色背景", value: "rgba(203,145,47,.16)" },
  { label: "绿色背景", value: "rgba(68,131,97,.14)" },
  { label: "蓝色背景", value: "rgba(51,126,169,.14)" },
  { label: "紫色背景", value: "rgba(144,101,176,.14)" },
  { label: "红色背景", value: "rgba(212,76,71,.14)" },
];

// 可直接转换的块：普通文本块、列表项 / 待办项 / 折叠列表和分栏。
// 分栏转换为普通块时由 block-commands 按换行合并各栏文字；切换列数则保留栏内结构。
export const TEXT_TRANSFORMABLE_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "callout",
  "details",
  "listItem",
  "taskItem",
  "columns",
]);
