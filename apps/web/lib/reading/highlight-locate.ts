import type { HighlightColor } from "@organize/shared";

// E02-2 跨页高亮锚点回跳的定位实现。014 的 anchor_path/anchor_offset 在创建高亮时
// 从未写入（insert 只有 user_id/reading_item_id/content/color），存量高亮没有可用锚点，
// 因此按高亮正文在渲染后的文章 DOM 里做空白归一化的文本匹配，命中后包裹为 mark。
// 匹配跨块级元素（如选中横跨两个段落）时无法无损包裹，降级为不标记、只滚动到起始块。

const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "TD", "TH", "PRE", "SECTION", "ARTICLE", "FIGURE", "TR", "TABLE",
]);

export interface HighlightTarget {
  el: HTMLElement;
  /** true = 已在正文里包裹出 mark 节点；false = 跨块降级，el 是可滚动的块级元素 */
  marked: boolean;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ");
}

function closestBlockWithin(node: Node, root: HTMLElement): HTMLElement {
  let cur: Node | null = node;
  while (cur && cur !== root) {
    if (cur.nodeType === 1 && BLOCK_TAGS.has((cur as Element).tagName)) {
      return cur as HTMLElement;
    }
    cur = cur.parentNode;
  }
  return root;
}

interface TextPiece {
  node: Text;
  start: number;
  end: number;
}

export function findAndWrapHighlightText(
  root: HTMLElement,
  content: string,
  color: HighlightColor
): HighlightTarget | null {
  const needle = normalize(content).trim();
  if (!needle) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const pieces: TextPiece[] = [];
  let raw = "";
  let current = walker.nextNode() as Text | null;
  while (current) {
    const value = current.nodeValue ?? "";
    pieces.push({ node: current, start: raw.length, end: raw.length + value.length });
    raw += value;
    current = walker.nextNode() as Text | null;
  }

  // 空白归一化投影：连续空白折叠成单个空格，记录每个归一化字符的原始下标
  let norm = "";
  const normToRaw: number[] = [];
  let inSpace = false;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) {
      if (inSpace) continue;
      inSpace = true;
    } else {
      inSpace = false;
    }
    norm += inSpace ? " " : raw[i];
    normToRaw.push(i);
  }

  const at = norm.indexOf(needle);
  if (at === -1) return null;
  const endExcl = at + needle.length;
  const rawStart = normToRaw[at];
  const rawEnd = normToRaw[endExcl - 1] + 1;

  // 边界落在节点交界时按方向取所属节点：起点偏向下一个节点的开头，终点偏向
  // 前一个节点的末尾——保证两个边界都落在真正包含命中字符的节点里（块级判断才准确）
  const locate = (rawIndex: number, preferNext: boolean): { node: Text; offset: number } | null => {
    for (const piece of pieces) {
      if (rawIndex > piece.start && rawIndex < piece.end) {
        return { node: piece.node, offset: rawIndex - piece.start };
      }
      if (preferNext && rawIndex === piece.start) {
        return { node: piece.node, offset: 0 };
      }
      if (!preferNext && rawIndex === piece.end) {
        return { node: piece.node, offset: rawIndex - piece.start };
      }
    }
    return null;
  };
  const startPos = locate(rawStart, true);
  const endPos = locate(rawEnd, false);
  if (!startPos || !endPos) return null;

  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);

  const startBlock = closestBlockWithin(startPos.node, root);
  const endBlock = closestBlockWithin(endPos.node, root);
  if (startBlock !== endBlock) {
    return { el: startBlock, marked: false };
  }

  const mark = document.createElement("mark");
  mark.className = `hl-${color}`;
  mark.dataset.highlightColor = color;
  try {
    const fragment = range.extractContents();
    mark.appendChild(fragment);
    range.insertNode(mark);
  } catch {
    // 包裹失败（如范围部分覆盖非文本节点）：滚动到文本所在元素兜底
    const parent = startPos.node.parentElement;
    if (parent) return { el: parent, marked: false };
    return null;
  }
  return { el: mark, marked: true };
}

export function focusHighlight(el: HTMLElement): void {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-primary", "ring-offset-1");
  // 图片懒加载等因素会撑动布局使位置漂移，延迟补一次定位
  window.setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 600);
  window.setTimeout(() => el.classList.remove("ring-2", "ring-primary", "ring-offset-1"), 1500);
}
