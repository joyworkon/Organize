/**
 * B04（R09 续）：块交互纯函数层——从 tiptap-editor.tsx 原样拆出（纯移动，无逻辑改动），
 * 另将 editorProps.handleKeyDown 提为可单测的工厂（行为逐行保持：IME 守卫 /
 * 标题行尾回车 / ⌘/ 块命令菜单 / ⌘F 页内搜索）。
 *
 * 范围边界：块拖拽与框选的**状态机**（pointer 事件序列、React state）仍留在
 * tiptap-editor 组件内——它与 setState 紧耦合，拆出只增加透传不降低审查成本；
 * 这里只收留无状态的可测部分（几何/命中测试/菜单定位/键盘分派）。
 */
import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { CellSelection } from "@tiptap/pm/tables";
import { getActiveTable } from "./extensions/table-style";
import type { EditorBlockTarget, EditorMenuPoint } from "./types";

/* --------------------------- 交互状态类型 --------------------------- */

export interface OpenMenuState {
  pos: number;
  point: EditorMenuPoint;
  /** 由 "/" 触发时为 true：菜单执行/关闭时需清掉块里的触发字符 */
  slash?: boolean;
  /** 嵌套场景（表格/列表内等）：在当前位置插入而非替换顶层块 */
  nested?: boolean;
  /** 斜杠命令触发时的文本范围，用于删除 "/" 字符 */
  range?: { from: number; to: number };
}

export interface OpenActionState extends OpenMenuState {
  target: EditorBlockTarget;
}

export type OpenTablePickerState = OpenMenuState;

export interface HoveredBlock {
  editor: Editor;
  node: ProseMirrorNode;
  pos: number;
  top: number;
  left: number;
  element: HTMLElement;
}

export interface BlockDropTarget {
  insertPos: number;
  top: number;
}

export interface BlockPointerDrag {
  pointerId: number;
  startX: number;
  startY: number;
  source: HoveredBlock;
  active: boolean;
}

/* ------------------------- 块几何与命中测试 ------------------------- */

export function nodePosForElement(editor: Editor, element: HTMLElement) {
  const domPos = editor.view.posAtDOM(element, 0);
  const $pos = editor.state.doc.resolve(domPos);
  return $pos.depth > 0 ? $pos.before($pos.depth) : domPos;
}

export function blockElementAtTarget(editorDom: HTMLElement, target: HTMLElement, clientY: number) {
  const listItem = target.closest("li");
  if (listItem instanceof HTMLElement && editorDom.contains(listItem)) return listItem;

  // 指针落在列表的标记区 / 项目间隙（事件目标是 ul/ol 而不是 li）时，
  // 按垂直方向找最近的列表项。否则手柄会对准整个列表（列表节点没有块 id），
  // 表现为手柄上下乱跳、点击 6 点菜单毫无反应。
  const list = target.closest("ul, ol");
  if (list instanceof HTMLElement && editorDom.contains(list)) {
    const items = Array.from(list.querySelectorAll(":scope > li"));
    let best: HTMLElement | null = null;
    let bestDistance = Infinity;
    for (const item of items) {
      if (!(item instanceof HTMLElement)) continue;
      const rect = item.getBoundingClientRect();
      const distance = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = item;
      }
    }
    if (best) return best;
  }

  // 折叠列表 / 折叠标题的内容区：里面的直接子块是独立块（hover 出手柄、
  // 可拖拽排序、6 点菜单作用在单个块上），而不是整体算到外层折叠块上。
  // 嵌套折叠时 closest 取到最内层内容区，符合"最贴近指针的块"直觉。
  const detailsContent = target.closest('div[data-type="detailsContent"]');
  if (detailsContent instanceof HTMLElement && editorDom.contains(detailsContent)) {
    let inner: HTMLElement | null = target;
    while (inner?.parentElement && inner.parentElement !== detailsContent) inner = inner.parentElement;
    if (inner?.parentElement === detailsContent) return inner;
  }

  let block: HTMLElement | null = target;
  while (block?.parentElement && block.parentElement !== editorDom) block = block.parentElement;
  return block?.parentElement === editorDom ? block : null;
}

/** 计算块手柄的垂直位置：与块内第一个文本块的首行居中对齐。 */
const HANDLE_HEIGHT = 22;
/** 手柄与块标记区（选中背景左缘）之间的间距，Notion 约 4px */
const HANDLE_GAP = 4;

const TEXTBLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, summary, pre";

export function firstTextblockElement(block: HTMLElement): HTMLElement {
  return (block.matches(TEXTBLOCK_SELECTOR)
    ? block
    : block.querySelector(TEXTBLOCK_SELECTOR)) ?? block;
}

export function handleTopForBlock(block: HTMLElement, shellRect: DOMRect): number {
  // 标注块（callout）：手柄与块上边对齐（锚定顶部 emoji 图标），
  // 不随多行内容垂直居中。
  const callout = block.matches("[data-callout]")
    ? block
    : block.querySelector("[data-callout]");
  if (callout instanceof HTMLElement) {
    const emoji = callout.querySelector(".callout-emoji");
    const iconRect = (emoji instanceof HTMLElement ? emoji : callout).getBoundingClientRect();
    return iconRect.top - shellRect.top + Math.max(0, (iconRect.height - HANDLE_HEIGHT) / 2);
  }
  // 选项卡：ReactNodeViewRenderer 会在 [data-tabs] 外再包一层 .react-renderer，
  // 悬停解析出的块是外层包装，故用 :scope 直接子选择器向下找一层。
  // 顶部是 contentEditable=false 的标签栏，块内第一个文本块在标签栏之下，
  // 按通用规则手柄会偏到内容区第一行；改为锚定标签栏，与块顶部对齐。
  const tabs = block.matches("[data-tabs]")
    ? block
    : block.querySelector(":scope > [data-tabs]");
  if (tabs instanceof HTMLElement) {
    const bar = tabs.querySelector(".organize-tabs-bar");
    const barRect = (bar instanceof HTMLElement ? bar : tabs).getBoundingClientRect();
    return barRect.top - shellRect.top + Math.max(0, (barRect.height - HANDLE_HEIGHT) / 2);
  }
  // 锚定到块内第一个文本块：列表项 / 待办项 / 折叠列表的外框会因外边距折叠、
  // 内边距而偏离首行文字，直接用外框会让手柄偏上几像素。
  const anchor = firstTextblockElement(block);
  const anchorRect = anchor.getBoundingClientRect();
  const anchorStyle = window.getComputedStyle(anchor);
  const parsedLineHeight = Number.parseFloat(anchorStyle.lineHeight);
  const paddingTop = Number.parseFloat(anchorStyle.paddingTop) || 0;
  const firstLineHeight = Number.isFinite(parsedLineHeight)
    ? Math.min(parsedLineHeight, anchorRect.height)
    : Math.min(HANDLE_HEIGHT + 6, anchorRect.height);
  return anchorRect.top + paddingTop - shellRect.top + Math.max(0, (firstLineHeight - HANDLE_HEIGHT) / 2);
}

/** 计算块手柄的水平位置：贴着块的视觉左缘，待办列表则贴着 checkbox 槽。 */
export function handleLeftForBlock(block: HTMLElement, shellRect: DOMRect, handleWidth: number): number {
  let blockLeft = block.getBoundingClientRect().left;

  // 普通项目符号 / 编号列表的 li 左缘是正文轴，原生 marker 位于父列表的 gutter。
  // 手柄贴父列表左缘，避免与圆点或序号重叠。TaskItem 的 li 已包含 checkbox 槽。
  if (block.matches("li") && !block.parentElement?.matches('ul[data-type="taskList"]')) {
    blockLeft = block.parentElement?.getBoundingClientRect().left ?? blockLeft;
  }

  // TaskList 的顶层 ul 不占 checkbox 槽，真正的行从 li 的负 margin 开始。
  if (block.matches('ul[data-type="taskList"]')) {
    const anchor = firstTextblockElement(block);
    const textLeft = anchor.getBoundingClientRect().left;
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--organize-gutter");
    const gutter = Number.parseFloat(raw) || 24;
    blockLeft = textLeft - gutter;
  }

  return blockLeft - shellRect.left - HANDLE_GAP - handleWidth;
}

export function pointIsOverRenderedText(block: HTMLElement, clientX: number, clientY: number): boolean {
  const anchor = firstTextblockElement(block);
  if (!anchor.textContent) return false;
  const range = document.createRange();
  range.selectNodeContents(anchor);
  return Array.from(range.getClientRects()).some((rect) => (
    clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY <= rect.bottom
  ));
}

/* ----------------------------- 菜单定位 ----------------------------- */

export function menuPointBelowBlock(editor: Editor, pos: number, selectionPos: number): EditorMenuPoint {
  const blockDom = editor.view.nodeDOM(pos);
  if (blockDom instanceof HTMLElement) {
    const rect = blockDom.getBoundingClientRect();
    return { left: rect.left, top: rect.bottom + 6, anchorTop: rect.top };
  }
  const coords = editor.view.coordsAtPos(selectionPos);
  return { left: coords.left, top: coords.bottom + 6, anchorTop: coords.top };
}

export function activeTableReferenceRect(editor: Editor) {
  const table = getActiveTable(editor);
  if (!table) return editor.view.dom.getBoundingClientRect();
  const dom = editor.view.nodeDOM(table.pos);
  const tableElement = dom instanceof HTMLTableElement
    ? dom
    : dom instanceof HTMLElement
      ? dom.querySelector("table")
      : null;
  return tableElement?.getBoundingClientRect()
    ?? editor.view.dom.getBoundingClientRect();
}

export function shouldShowTextToolbar({
  editor,
  element,
  view,
  state,
  from,
  to,
}: {
  editor: Editor;
  element: HTMLElement;
  view: EditorView;
  state: EditorState;
  from: number;
  to: number;
}) {
  const { doc, selection } = state;
  if (selection instanceof CellSelection) return false;

  const isEmptyTextBlock = !doc.textBetween(from, to).length
    && selection instanceof TextSelection;
  const isChildOfMenu = element.contains(document.activeElement);
  const hasEditorFocus = view.hasFocus() || isChildOfMenu;

  return hasEditorFocus
    && !selection.empty
    && !isEmptyTextBlock
    && editor.isEditable;
}

/* --------------------------- 键盘分派工厂 --------------------------- */

/**
 * editorProps.handleKeyDown 的工厂（B04 从组件内联提出，行为逐行保持）。
 * - IME 组合态（中文输入法选词等）的按键不交给编辑器处理；
 * - 标题行尾回车：插入后续段落（TipTap 默认会续建同级标题）；
 * - ⌘/ 或 Ctrl+/：仅顶层块打开块命令菜单（嵌套块直接忽略——replaceBlock
 *   会把整个顶层容器替换掉、吞掉其余内容）；
 * - ⌘F / Ctrl+F：编辑器聚焦时打开页面内块搜索（覆盖浏览器查找）。
 * 其余按键一律放行（返回 false）。
 */
export function createBlockKeydownHandlers(options: {
  onOpenCommandMenu: (pos: number, point: EditorMenuPoint) => void;
  onOpenSearchDialog: () => void;
}) {
  return (view: EditorView, event: KeyboardEvent): boolean => {
    // IME 组合态（如中文输入法选词）期间的按键不交给编辑器处理
    if (event.isComposing || event.keyCode === 229) return false;
    const { $from, empty } = view.state.selection;
    if (
      event.key === "Enter"
      && empty
      && $from.parent.type.name === "heading"
      && $from.parentOffset === $from.parent.content.size
    ) {
      event.preventDefault();
      const insertPos = $from.after($from.depth);
      const paragraph = view.state.schema.nodes.paragraph.create();
      const transaction = view.state.tr.insert(insertPos, paragraph);
      transaction.setSelection(
        TextSelection.near(transaction.doc.resolve(insertPos + 1), 1)
      );
      view.dispatch(transaction.scrollIntoView());
      return true;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "/") {
      event.preventDefault();
      // 仅顶层块打开块命令菜单；嵌套块（列表项/callout/引用内）直接忽略，
      // 否则 replaceBlock 会把整个顶层容器替换掉，吞掉其余内容
      if ($from.depth !== 1) return false;
      const pos = $from.before(1);
      const coords = view.coordsAtPos($from.pos);
      view.dispatch(view.state.tr.setSelection(view.state.selection));
      options.onOpenCommandMenu(pos, { left: Math.max(12, coords.left), top: coords.bottom + 8, anchorTop: coords.top });
      return true;
    }
    // ⌘F / Ctrl+F：编辑器聚焦时打开页面内块搜索（覆盖浏览器查找）
    if ((event.metaKey || event.ctrlKey) && (event.key === "f" || event.key === "F")) {
      event.preventDefault();
      options.onOpenSearchDialog();
      return true;
    }
    return false;
  };
}
