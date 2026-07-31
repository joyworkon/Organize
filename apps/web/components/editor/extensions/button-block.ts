import type { JSONContent } from "@tiptap/core";

export type ButtonAction = "open-url" | "insert-blocks";

export interface ButtonAttrs {
  label: string;
  action: ButtonAction;
  /** open-url: 目标 URL；insert-blocks: 待插入的块 JSON 数组 */
  payload: string;
}

export const DEFAULT_BUTTON_ATTRS: ButtonAttrs = {
  label: "按钮",
  action: "open-url",
  payload: "",
};

/**
 * 校验 URL 安全性：只允许 http/https 与站内 / 开头路径。
 * 阻止 javascript:、data: 等可执行协议，防点击劫持/注入。
 */
export function isSafeButtonUrl(value: string): boolean {
  const url = value.trim();
  if (!url) return false;
  // 站内路径
  if (url.startsWith("/")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** 解析 insert-blocks 的 payload；非法/空返回 null。 */
export function parseButtonBlocksPayload(payload: string): JSONContent[] | null {
  if (!payload.trim()) return null;
  try {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed as JSONContent[];
  } catch {
    return null;
  }
}

/** 归一化 action 属性，非法值回退默认。 */
export function normalizeButtonAction(value: unknown): ButtonAction {
  return value === "insert-blocks" ? "insert-blocks" : "open-url";
}
