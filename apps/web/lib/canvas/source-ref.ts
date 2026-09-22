/**
 * 资料来源引用的收集与可达性（阶段 E，lib/canvas 侧纯函数）。
 *
 * 画布文档里可能携带 sourceRef 的块：materialCard（必有）、
 * text/image（资料摘录/图片插入时带）。本模块负责：
 * - collectSourceRefs：收集文档内全部来源引用（按 kind+id 去重）
 * - sourceRefKey：统一的 「kind:id」 键
 * - validateSourceRef：校验引用字段形状（validation.ts 复用）
 *
 * 可达性探测在组件层（use-source-status）：按 kind 分表
 * reading_items / memos 做 id IN 查询，RLS 自动隐藏他人与已删除行
 * （查不到 = 无权限或已删除），快照本身不依赖来源存活。
 */

import type { CanvasBlock, CanvasDoc, CanvasSourceRef } from "./model";

export function sourceRefKey(kind: CanvasSourceRef["kind"], id: string): string {
  return `${kind}:${id}`;
}

export function blockSourceRef(block: CanvasBlock): CanvasSourceRef | undefined {
  if (block.type === "materialCard") return block.sourceRef;
  if (block.type === "text" || block.type === "image") return block.sourceRef;
  return undefined;
}

/** 文档内全部来源引用，按 kind+id 去重（顺序稳定，先扫页面后扫自由容器）。 */
export function collectSourceRefs(doc: CanvasDoc): CanvasSourceRef[] {
  const seen = new Set<string>();
  const refs: CanvasSourceRef[] = [];
  const push = (ref: CanvasSourceRef | undefined) => {
    if (!ref) return;
    const key = sourceRefKey(ref.kind, ref.id);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };
  for (const board of doc.boards) {
    for (const region of board.regions) {
      for (const section of region.sections) {
        for (const column of section.columns) {
          for (const block of column.blocks) push(blockSourceRef(block));
        }
      }
    }
  }
  for (const item of doc.freeItems) push(blockSourceRef(item.block));
  return refs;
}

/** 引用字段形状校验（错误文案进 path，validation.ts 用）。 */
export function validateSourceRefField(
  value: unknown,
  errors: string[],
  path: string,
): boolean {
  if (typeof value !== "object" || value === null) {
    errors.push(`${path}.sourceRef 必须是对象`);
    return false;
  }
  const r = value as Record<string, unknown>;
  if (r.kind !== "reading" && r.kind !== "memo") {
    errors.push(`${path}.sourceRef.kind 非法`);
  }
  if (typeof r.id !== "string" || r.id.length === 0 || r.id.length > 64) {
    errors.push(`${path}.sourceRef.id 非法`);
  }
  if (typeof r.title !== "string" || r.title.length > 200) {
    errors.push(`${path}.sourceRef.title 超长或非法`);
  }
  if (r.excerpt !== undefined && (typeof r.excerpt !== "string" || r.excerpt.length > 500)) {
    errors.push(`${path}.sourceRef.excerpt 超长或非法`);
  }
  if (r.url !== undefined && (typeof r.url !== "string" || r.url.length > 2000)) {
    errors.push(`${path}.sourceRef.url 超长或非法`);
  }
  if (r.updatedAt !== undefined && (typeof r.updatedAt !== "string" || r.updatedAt.length > 40)) {
    errors.push(`${path}.sourceRef.updatedAt 非法`);
  }
  return true;
}
