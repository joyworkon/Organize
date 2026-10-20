/**
 * 斜杠命令触发文本删除范围的纯函数。
 *
 * 背景：suggestion 在 "/" 输入时给出的 range 覆盖触发符本身；用户在正文里继续输入
 * 查询词时（行内筛选），range 随之扩展为 "/查询词" 全段。
 * 之前的实现把"pos+1 到块尾"整段删除，导致在已有文字的段落开头
 * 输入 "/" 选命令时整段原文被清掉。这里改为只删 suggestion 给出的范围，
 * 且范围必须完整落在块的内容区内，越界一律不删——绝不能删到块里原有文字。
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
    const contentStart = blockPos + 1;
    const contentEnd = blockPos + blockNodeSize - 1;
    if (range.from >= contentStart && range.to <= contentEnd) {
      return { from: range.from, to: range.to };
    }
    return null;
  }
  // 无 range 的兜底：只有整块内容仅为 "/" 时才删除，避免误删用户文字
  if (blockText === "/") {
    return { from: blockPos + 1, to: blockPos + blockNodeSize - 1 };
  }
  return null;
}

/** 范围内文本必须以 "/" 开头才算触发文本（删除前的最后一道保险） */
export function isSlashTriggerText(text: string): boolean {
  return text.startsWith("/") && !/\s/.test(text);
}
