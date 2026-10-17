/**
 * 自动归组「应用」阶段的中文文案与刷新判定（纯函数，供 auto-group-dialog 的 apply 接线）。
 * 应用是逐组顺序写库、无事务，中途失败时前面已写入的部分要如实告知并触发列表刷新，
 * 不能一律装作「整次失败」。
 */

export interface AutoGroupApplyFailureToast {
  title: string;
  description?: string;
  /** 服务器上已有本次写入（建组或移动笔记）时为 true：调用方需要广播 note-groups-changed 刷新 UI */
  wroteAnything: boolean;
}

function errorDetail(error: unknown): string | undefined {
  if (error instanceof Error) return error.message || undefined;
  if (error === null || error === undefined) return undefined;
  const text = String(error);
  return text || undefined;
}

/**
 * 应用自动分组中途失败的提示：
 * - 什么都没写进服务器：维持「应用分组失败」；
 * - 只建了组还没放进笔记：说明建了几个组；
 * - 已移动部分笔记：如实报「已整理 N 篇到 M 个分组，后续失败」。
 * createdButUnapplied 指失败发生在 moveNotesToGroup 时该组已新建（服务器上是个空组）。
 */
export function describeAutoGroupApplyFailure(
  appliedGroups: number,
  movedNotes: number,
  error: unknown,
  createdButUnapplied = 0
): AutoGroupApplyFailureToast {
  const detail = errorDetail(error);
  if (movedNotes <= 0 && appliedGroups <= 0 && createdButUnapplied <= 0) {
    return { title: "应用分组失败", description: detail, wroteAnything: false };
  }
  const extras: string[] = [];
  if (createdButUnapplied > 0) extras.push(`另有 ${createdButUnapplied} 个新建分组还没放入笔记`);
  if (detail) extras.push(detail);
  const description = extras.length > 0 ? extras.join("；") : undefined;
  if (movedNotes <= 0) {
    return { title: `已创建 ${createdButUnapplied} 个分组，但整理笔记失败`, description, wroteAnything: true };
  }
  return { title: `已整理 ${movedNotes} 篇到 ${appliedGroups} 个分组，后续失败`, description, wroteAnything: true };
}

/** 全成功沿用原有文案（与失败模板分开，避免全成功误用失败话术） */
export function describeAutoGroupApplySuccess(appliedGroups: number, movedNotes: number): string {
  return `已应用 ${appliedGroups} 个分组，整理了 ${movedNotes} 篇笔记`;
}
