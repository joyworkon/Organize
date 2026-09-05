import type { Editor, JSONContent } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";

export type BlockCommandCategory = "建议" | "基本区块" | "媒体" | "布局" | "插件";

/** 斜杠命令的插入上下文：top = 文档顶层块；nested = 列表/表格单元格/分栏等嵌套结构内 */
export type BlockCommandContext = "top" | "nested";

/** 命令执行结果：只有 handled 才消费触发字符（R06 能力一致性约定） */
export type BlockCommandRunResult = "handled" | "unsupported" | "failed";

export interface EditorBlockTarget {
  pos: number;
  id: string;
  type: string;
  text: string;
  json: JSONContent;
}

export interface EditorMenuPoint {
  left: number;
  top: number;
  /** 锚点块的顶边坐标（viewport）：菜单向上翻转展开时用于贴住块顶 */
  anchorTop?: number;
}

export interface BlockCommandDefinition {
  id: string;
  label: string;
  description?: string;
  category: BlockCommandCategory;
  icon: LucideIcon;
  keywords: string[];
  shortcut?: string;
  canTransform?: boolean;
  /** 「转换成」菜单悬停时的小预览 */
  preview?: { sample: string; caption: string };
  /** 支持的插入上下文；缺省 = top + nested 都支持（由 isCommandAvailableInContext 统一判定）。
   *  第一轮（R06）嵌套未实现的命令必须标 ["top"] 隐藏，禁止为凑全支持填 true */
  supportedContexts?: readonly BlockCommandContext[];
  run: (editor: Editor, pos: number) => void;
}

export type EditorDialog =
  | { type: "html"; pos: number }
  | { type: "ai-notes"; pos: number }
  | { type: "ask-ai"; target: EditorBlockTarget }
  | { type: "move"; target: EditorBlockTarget }
  | { type: "comment"; target: EditorBlockTarget }
  | { type: "suggestion"; target: EditorBlockTarget }
  | { type: "search" }
  | null;
