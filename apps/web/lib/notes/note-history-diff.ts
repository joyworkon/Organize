/**
 * 版本预览与当前正文的顶层块差异。
 * 计数与 `.nv-changed` 用同一套 key：只比较版本里出现的顶层块
 * （当前多出来的块不会画在版本 HTML 上，所以不计入 N）。
 */

export interface HistoryBlockNode {
  attrs?: { id?: unknown } | null;
  [key: string]: unknown;
}

export interface HistoryDocNode {
  content?: HistoryBlockNode[] | null;
}

function asDoc(value: unknown): HistoryDocNode | null {
  if (value == null || typeof value !== "object") return null;
  return value as HistoryDocNode;
}

function blockKey(block: HistoryBlockNode, index: number): string {
  const id = block.attrs?.id;
  return typeof id === "string" && id ? id : `#idx:${index}`;
}

/** 顶层块指纹：key = 块 id（无 id 时退回序号），值 = 去掉 id 后的内容 JSON */
function fingerprintBlocks(doc: HistoryDocNode | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  (doc?.content ?? []).forEach((block, index) => {
    const key = blockKey(block, index);
    const attrs = { ...(block.attrs ?? {}), id: undefined };
    map.set(key, JSON.stringify({ ...block, attrs }));
  });
  return map;
}

/** 版本里与当前内容不同的顶层块 key 集合（用于高亮「这一版改了什么」） */
export function diffChangedKeys(versionDoc: unknown, currentDoc: unknown): Set<string> {
  const current = fingerprintBlocks(asDoc(currentDoc));
  const changed = new Set<string>();
  const version = asDoc(versionDoc);
  (version?.content ?? []).forEach((block, index) => {
    const key = blockKey(block, index);
    const attrs = { ...(block.attrs ?? {}), id: undefined };
    if (current.get(key) !== JSON.stringify({ ...block, attrs })) {
      changed.add(key);
    }
  });
  return changed;
}

/** `.nv-changed` 顶层块数量 */
export function countVersionChanges(versionDoc: unknown, currentDoc: unknown): number {
  return diffChangedKeys(versionDoc, currentDoc).size;
}

export function versionChangeLabel(count: number): string {
  if (count <= 0) return "与当前内容相同";
  return `与当前相比 ${count} 处不同`;
}

/**
 * 改动导航下标。current < 0 时，下一处从第一处开始，上一处从最后一处开始。
 * 已在范围内则循环，方便在长文里来回跳。
 */
export function nextChangedCursor(current: number, delta: -1 | 1, count: number): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** 给第 index 个 `.nv-changed` 加上短暂强调，并清掉其它块上的强调 */
export function emphasizeChangedBlock(root: ParentNode, index: number): HTMLElement | null {
  const blocks = Array.from(root.querySelectorAll(".nv-changed")).filter(
    (node): node is HTMLElement => node instanceof HTMLElement
  );
  for (const block of blocks) block.classList.remove("nv-changed-focus");
  const target = blocks[index] ?? null;
  target?.classList.add("nv-changed-focus");
  return target;
}
