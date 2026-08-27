/**
 * 笔记目录（TOC）条目：从笔记 content JSON 提取标题块，
 * 供目录侧栏渲染、滚动定位与折叠/展开。
 */

export interface TocItem {
  /** 标题文本 */
  text: string;
  /** 标题层级 1-3（折叠标题为 1-4） */
  level: number;
  /** 顶层块在文档中的索引（用于 DOM 定位与同步块内展开） */
  blockIndex: number;
  /** 是否位于折叠/同步块等需要展开才能可见的容器内 */
  inCollapsed: boolean;
}

export interface TocNode extends TocItem {
  children: TocNode[];
}

interface WalkState {
  /** 当前节点是否需要展开容器才能显示 */
  collapsed: boolean;
  items: TocItem[];
}

/** 折叠标题（detailsSummary level 属性）支持的层级：折叠标题菜单提供 1-4 级。 */
const SUMMARY_MAX_LEVEL = 4;
const HEADING_MAX_LEVEL = 3;

/** 折叠标题的 level>0 才算标题（level 0 是普通折叠块的 summary）。 */
function isTocTitle(type: string, level: number): boolean {
  if (type === "heading") return level >= 1 && level <= HEADING_MAX_LEVEL;
  if (type === "detailsSummary") return level >= 1 && level <= SUMMARY_MAX_LEVEL;
  return false;
}

/** 递归遍历节点：收集 heading 与折叠标题（detailsSummary 1-4 级），跟踪折叠容器。 */
function walkNode(node: unknown, state: WalkState): void {
  if (!node || typeof node !== "object") return;
  const record = node as {
    type?: string;
    attrs?: Record<string, unknown>;
    content?: unknown[];
  };
  const type = record.type || "";
  const childCollapsed =
    state.collapsed || type === "details" || type === "syncedBlock" || type === "synced_block";

  if (type === "heading" || type === "detailsSummary") {
    const level = Number(record.attrs?.level ?? (type === "detailsSummary" ? 0 : 1));
    if (isTocTitle(type, level)) {
      const text = (record.content || [])
        .map((child) =>
          child && typeof child === "object"
            ? String((child as { text?: unknown }).text ?? "")
            : ""
        )
        .join("")
        .trim();
      if (text) {
        state.items.push({
          text,
          level,
          blockIndex: -1, // 顶层索引由外层循环回填
          inCollapsed: state.collapsed,
        });
      }
    }
    return; // 标题内容即文本，不递归
  }

  if (type === "details") {
    // summary 是折叠块的头，收起时依然可见；detailsContent 内的块才随折叠隐藏
    for (const child of record.content || []) {
      const childType =
        child && typeof child === "object" ? String((child as { type?: unknown }).type ?? "") : "";
      walkNode(child, {
        ...state,
        collapsed: childType === "detailsSummary" ? state.collapsed : childCollapsed,
      });
    }
    return;
  }

  for (const child of record.content || []) {
    walkNode(child, { ...state, collapsed: childCollapsed });
  }
}

/** 从笔记 content JSON 提取目录条目（扁平列表，含顶层块索引）。 */
export function extractTocItems(content: unknown): TocItem[] {
  if (!content || typeof content !== "object") return [];
  const doc = content as { type?: string; content?: unknown[] };
  if (doc.type !== "doc" || !Array.isArray(doc.content)) return [];

  const items: TocItem[] = [];
  doc.content.forEach((node, index) => {
    const before = items.length;
    walkNode(node, { collapsed: false, items });
    for (let i = before; i < items.length; i++) {
      items[i] = { ...items[i], blockIndex: index };
    }
  });
  return items;
}

/** 把扁平条目按层级组装成树（H1 > H2 > H3，越级时归到最近父级）。 */
export function buildTocTree(items: TocItem[]): TocNode[] {
  const root: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const item of items) {
    const node: TocNode = { ...item, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return root;
}

/** 展平树为渲染列表（含深度），供缩进渲染。 */
export function flattenTocTree(
  nodes: TocNode[],
  depth = 0
): { item: TocItem; depth: number; hasChildren: boolean }[] {
  const out: { item: TocItem; depth: number; hasChildren: boolean }[] = [];
  for (const node of nodes) {
    out.push({ item: node, depth, hasChildren: node.children.length > 0 });
    out.push(...flattenTocTree(node.children, depth + 1));
  }
  return out;
}

/** 收集树中所有「有子级的节点」的折叠 key（用 blockIndex+text 作 key）。 */
export function collapsibleKeys(nodes: TocNode[]): string[] {
  const keys: string[] = [];
  const visit = (list: TocNode[]) => {
    for (const node of list) {
      if (node.children.length > 0) keys.push(tocKey(node));
      visit(node.children);
    }
  };
  visit(nodes);
  return keys;
}

export function tocKey(item: TocItem): string {
  return `${item.blockIndex}:${item.text}`;
}
