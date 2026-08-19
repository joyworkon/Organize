/**
 * 斜杠命令触发文本删除范围的纯函数。
 *
 * 背景：suggestion 在 "/" 输入时给出的 range 只覆盖触发符本身
 * （查询词输入在菜单自己的输入框里，不会进入文档）。
 * 之前的实现把"pos+1 到块尾"整段删除，导致在已有文字的段落开头
 * 输入 "/" 选命令时整段原文被清掉。这里改为只删触发符。
 */
export interface SlashTriggerRange {
  from: number;
  to: number;
}

export function resolveTriggerDeleteRange(opts: {
  /** suggestion 提供的触发符范围（优先使用） */
  range?: SlashTriggerRange | null;
  /** 块起始位置 */
  blockPos: number;
  /** 块 nodeSize */
  blockNodeSize: number;
  /** 块当前纯文本 */
  blockText: string;
}): SlashTriggerRange | null {
  const { range, blockPos, blockNodeSize, blockText } = opts;
  if (range && Number.isFinite(range.from) && Number.isFinite(range.to) && range.to >= range.from) {
    return { from: range.from, to: range.to };
  }
  // 无 range 的兜底：只有整块内容仅为 "/" 时才删除，避免误删用户文字
  if (blockText === "/") {
    return { from: blockPos + 1, to: blockPos + blockNodeSize - 1 };
  }
  return null;
}
