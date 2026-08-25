// @vitest-environment jsdom
/**
 * 编辑器组合回归矩阵（E5）：
 * 「列表 × 列布局 × 表格 × 块拖动 × 块多选」组合场景的持久化结构测试。
 *
 * - 拖动通过 moveBlockTransaction（块拖拽引擎）驱动；多选删除走 BlockMultiSelect 的
 *   Backspace/Delete 快捷键（与真实交互同一代码路径）。
 * - 所有断言针对持久化后的 TipTap JSON（getJSON），并做「重新解析」往返：
 *   可见 DOM 正确不等于持久化正确（空表格单元格/断裂列表等只会在重新加载时暴露）。
 * - 块 id（UniqueID 补号）非结构信息，比较统一用 stripBlockIds 摘除。
 */
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Details from "@tiptap/extension-details";
import DetailsContent from "@tiptap/extension-details-content";
import DetailsSummary from "@tiptap/extension-details-summary";
import UniqueID from "@tiptap/extension-unique-id";
import { describe, expect, it } from "vitest";
import { moveBlockTransaction, stripBlockIds } from "./block-utils";
import { Callout } from "./extensions/callout";
import { Columns, Column } from "./extensions/columns";
import {
  BlockMultiSelect,
  getMultiSelectedBlocks,
  setMultiSelectedBlocks,
} from "./extensions/block-multi-select";

const EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Table,
  TableRow,
  TableCell,
  TableHeader,
  Details,
  DetailsContent,
  DetailsSummary,
  Callout,
  Columns,
  Column,
  // 与真实编辑器一致：块带 id（拖拽手柄按 id 重新定位依赖它）
  UniqueID.configure({
    types: ["paragraph", "heading", "codeBlock", "table", "details", "callout"],
  }),
  BlockMultiSelect,
];

function createEditor(content: JSONContent) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({ element, extensions: EXTENSIONS, content });
}

function paragraph(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function bulletList(items: JSONContent[]): JSONContent {
  return { type: "bulletList", content: items };
}

function listItem(texts: string[], nested?: JSONContent): JSONContent {
  return {
    type: "listItem",
    content: [...texts.map(paragraph), ...(nested ? [nested] : [])],
  };
}

function table(rows: string[][]): JSONContent {
  return {
    type: "table",
    content: rows.map((cells) => ({
      type: "tableRow",
      content: cells.map((text) => ({
        type: "tableCell",
        content: [paragraph(text)],
      })),
    })),
  };
}

/** JSONContent 的纯文本（持久化 JSON 没有便捷 textContent） */
function jsonText(node: JSONContent | undefined): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  return (node.content || []).map(jsonText).join("");
}

/** 段落/标题等文本块的首段文本 */
function blockText(node: JSONContent | undefined): string {
  return jsonText(node?.content?.[0]);
}

/** 顶层块位置（多选 / 拖动落点的稳定标识） */
function topLevelPositions(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.forEach((_node, offset) => positions.push(offset));
  return positions;
}

/** 按类型找顶层块位置 */
function topLevelPosOf(editor: Editor, type: string): number {
  let found = -1;
  editor.state.doc.forEach((node, offset) => {
    if (found < 0 && node.type.name === type) found = offset;
  });
  if (found < 0) throw new Error(`顶层块不存在: ${type}`);
  return found;
}

/** 嵌套查找（如列内列表）第一个匹配类型的块位置 */
function nestedPosOf(editor: Editor, type: string, containsText?: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name !== type) return true;
    if (containsText && !node.textContent.includes(containsText)) return true;
    found = pos;
    return false;
  });
  if (found < 0) {
    throw new Error(`嵌套块不存在: ${type}${containsText ? ` 含 "${containsText}"` : ""}`);
  }
  return found;
}

/** 拖动并应用（与 finishBlockPointerDrag 相同的 dispatch 路径） */
function applyMove(editor: Editor, sourcePos: number, insertPos: number) {
  const transaction = moveBlockTransaction(editor.state, sourcePos, insertPos);
  expect(transaction).not.toBeNull();
  editor.view.dispatch(transaction!);
}

/** 持久化 JSON 必须能重新解析（schema 校验）且结构稳定（忽略块 id） */
function expectRoundTrip(editor: Editor): JSONContent {
  const json = editor.getJSON();
  const reopened = createEditor(json);
  const reopenedJson = reopened.getJSON();
  reopened.destroy();
  expect(stripBlockIds(reopenedJson)).toEqual(stripBlockIds(json));
  return json;
}

function pressKey(editor: Editor, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  return editor.view.someProp("handleKeyDown", (fn) => fn(editor.view, event));
}

describe("列布局 × 列表 × 块拖动", () => {
  const DOC: JSONContent = {
    type: "doc",
    content: [
      paragraph("导语"),
      {
        type: "columns",
        attrs: { cols: 2 },
        content: [
          {
            type: "column",
            content: [
              bulletList([listItem(["甲"]), listItem(["乙"])]),
              paragraph("左栏尾段"),
            ],
          },
          { type: "column", content: [paragraph("右栏")] },
        ],
      },
      paragraph("结尾"),
    ],
  };

  it("列内列表拖出到顶层：列表结构完整、列内剩余内容不丢", () => {
    const editor = createEditor(DOC);
    const listPos = nestedPosOf(editor, "bulletList", "甲");
    const columnsPos = topLevelPosOf(editor, "columns");
    applyMove(editor, listPos, columnsPos);

    const json = expectRoundTrip(editor);
    expect(json.content!.map((node) => node.type))
      .toEqual(["paragraph", "bulletList", "columns", "paragraph"]);
    // 列表两个条目都在
    const movedList = json.content![1];
    expect(movedList.content).toHaveLength(2);
    expect(movedList.content!.map((item) => blockText(item.content![0])))
      .toEqual(["甲", "乙"]);
    // 左栏还剩尾段，右栏原样
    const columns = json.content!.find((node) => node.type === "columns")!;
    expect(columns.content![0].content!.map((node) => node.type)).toEqual(["paragraph"]);
    expect(blockText(columns.content![0].content![0])).toBe("左栏尾段");
    expect(blockText(columns.content![1].content![0])).toBe("右栏");
    editor.destroy();
  });

  it("列内普通段落拖出到顶层末尾：列与后续块顺序不变", () => {
    const editor = createEditor(DOC);
    const paraPos = nestedPosOf(editor, "paragraph", "左栏尾段");
    applyMove(editor, paraPos, editor.state.doc.content.size);

    const json = expectRoundTrip(editor);
    expect(json.content!.map((node) => node.type))
      .toEqual(["paragraph", "columns", "paragraph", "paragraph"]);
    expect(blockText(json.content!.at(-1))).toBe("左栏尾段");
    editor.destroy();
  });

  it("多选含整个列布局批量删除：一次事务删净，撤销整体恢复", () => {
    const editor = createEditor(DOC);
    const before = editor.getJSON();
    setMultiSelectedBlocks(editor, topLevelPositions(editor));
    expect(pressKey(editor, "Backspace")).toBe(true);

    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
    expect(getMultiSelectedBlocks(editor)).toEqual([]);

    editor.commands.undo();
    expect(stripBlockIds(editor.getJSON())).toEqual(stripBlockIds(before));
    editor.destroy();
  });
});

describe("表格 × 块拖动", () => {
  const DOC: JSONContent = {
    type: "doc",
    content: [
      paragraph("前段"),
      table([["单元格1", "单元格2"]]),
      paragraph("后段"),
    ],
  };

  it("整表拖过相邻段落到文档末尾：表结构与单元格内容不丢", () => {
    const editor = createEditor(DOC);
    const tablePos = topLevelPosOf(editor, "table");
    applyMove(editor, tablePos, editor.state.doc.content.size);

    const json = expectRoundTrip(editor);
    expect(json.content!.map((node) => node.type))
      .toEqual(["paragraph", "paragraph", "table"]);
    const moved = json.content![2];
    const row = moved.content![0];
    expect(row.content).toHaveLength(2);
    expect(row.content!.map((cell) => blockText(cell.content![0])))
      .toEqual(["单元格1", "单元格2"]);
    editor.destroy();
  });

  it("表格前后段落互调位置：表格保持在中间", () => {
    const editor = createEditor(DOC);
    const frontPos = topLevelPosOf(editor, "paragraph");
    applyMove(editor, frontPos, editor.state.doc.content.size);

    const json = expectRoundTrip(editor);
    expect(json.content!.map((node) => node.type)).toEqual(["table", "paragraph", "paragraph"]);
    expect(blockText(json.content![0].content![0].content![0])).toBe("单元格1");
    expect(blockText(json.content!.at(-1))).toBe("前段");
    editor.destroy();
  });
});

describe("嵌套列表 × 折叠块 × 块拖动", () => {
  const DOC: JSONContent = {
    type: "doc",
    content: [
      bulletList([
        listItem(["一级A"], bulletList([listItem(["二级A1"]), listItem(["二级A2"])])),
        listItem(["一级B"]),
      ]),
      {
        type: "details",
        attrs: { open: true },
        content: [
          { type: "detailsSummary", content: [{ type: "text", text: "折叠标题" }] },
          { type: "detailsContent", content: [paragraph("折叠内段")] },
        ],
      },
      paragraph("尾段"),
    ],
  };

  it("拖动带子列表的列表项到同级末尾：嵌套层级跟随且不降级", () => {
    const editor = createEditor(DOC);
    const itemPos = nestedPosOf(editor, "listItem", "一级A");
    // 块拖拽在 li 上时落点取 li 兄弟位置：移动到末项之后
    const lastItemPos = nestedPosOf(editor, "listItem", "一级B");
    const lastItem = editor.state.doc.nodeAt(lastItemPos)!;
    applyMove(editor, itemPos, lastItemPos + lastItem.nodeSize);

    const json = expectRoundTrip(editor);
    const list = json.content![0];
    expect(list.type).toBe("bulletList");
    expect(list.content!.map((item) => blockText(item.content![0])))
      .toEqual(["一级B", "一级A"]);
    // 一级A 的子列表仍嵌套在其内部（两级结构保留）
    const movedItem = list.content![1];
    const nested = movedItem.content!.find((child) => child.type === "bulletList")!;
    expect(nested.content!.map((item) => blockText(item.content![0])))
      .toEqual(["二级A1", "二级A2"]);
    editor.destroy();
  });

  it("折叠块整体拖到文档末尾：内容结构保留（open 为会话态不持久化）", () => {
    const editor = createEditor(DOC);
    const detailsPos = topLevelPosOf(editor, "details");
    applyMove(editor, detailsPos, editor.state.doc.content.size);

    const json = expectRoundTrip(editor);
    expect(json.content!.map((node) => node.type))
      .toEqual(["bulletList", "paragraph", "details"]);
    const details = json.content![2];
    // Details 扩展默认 persist:false —— open 是会话态 UI 属性，设计上不进持久化 JSON
    expect(details.attrs).not.toHaveProperty("open");
    expect(details.content!.map((node) => node.type))
      .toEqual(["detailsSummary", "detailsContent"]);
    expect(jsonText(details)).toBe("折叠标题折叠内段");
    editor.destroy();
  });

  it("多选删除「嵌套列表 + 折叠块 + 段落」组合：清空为空段落且可撤销", () => {
    const editor = createEditor(DOC);
    const before = editor.getJSON();
    setMultiSelectedBlocks(editor, topLevelPositions(editor));
    expect(pressKey(editor, "Delete")).toBe(true);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");

    editor.commands.undo();
    expect(stripBlockIds(editor.getJSON())).toEqual(stripBlockIds(before));
    editor.destroy();
  });
});

describe("组合矩阵交叉：列表进列、表格邻折叠块", () => {
  it("列内列表项拖动（li 兄弟落点）：条目在列内换位，列外块不受影响", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        paragraph("顶部"),
        {
          type: "columns",
          attrs: { cols: 2 },
          content: [
            {
              type: "column",
              content: [
                bulletList([listItem(["项一"]), listItem(["项二"]), listItem(["项三"])]),
              ],
            },
            { type: "column", content: [paragraph("右")] },
          ],
        },
      ],
    });

    const firstPos = nestedPosOf(editor, "listItem", "项一");
    const thirdPos = nestedPosOf(editor, "listItem", "项三");
    const third = editor.state.doc.nodeAt(thirdPos)!;
    applyMove(editor, firstPos, thirdPos + third.nodeSize);

    const json = expectRoundTrip(editor);
    const list = json.content![1].content![0].content![0];
    expect(list.type).toBe("bulletList");
    expect(list.content!.map((item) => blockText(item.content![0])))
      .toEqual(["项二", "项三", "项一"]);
    // 顶部与右栏不受影响
    expect(blockText(json.content![0])).toBe("顶部");
    expect(blockText(json.content![1].content![1].content![0])).toBe("右");
    editor.destroy();
  });

  it("表格与折叠块相邻时拖动折叠块到表格前：互不嵌套、顺序正确", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        table([["数据A"]]),
        {
          type: "details",
          content: [
            { type: "detailsSummary", content: [{ type: "text", text: "说明" }] },
            { type: "detailsContent", content: [paragraph("详情")] },
          ],
        },
      ],
    });
    const detailsPos = topLevelPosOf(editor, "details");
    applyMove(editor, detailsPos, 0);

    const json = expectRoundTrip(editor);
    expect(json.content!.map((node) => node.type)).toEqual(["details", "table"]);
    expect(jsonText(json)).toBe("说明详情数据A");
    editor.destroy();
  });
});
