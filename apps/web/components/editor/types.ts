import type { Editor, JSONContent } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";

export type BlockCommandCategory = "建议" | "基本区块" | "媒体" | "布局";

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
  run: (editor: Editor, pos: number) => void;
}

export type EditorDialog =
  | { type: "html"; pos: number }
  | { type: "ai-notes"; pos: number }
  | { type: "ask-ai"; target: EditorBlockTarget }
  | { type: "move"; target: EditorBlockTarget }
  | { type: "comment"; target: EditorBlockTarget }
  | { type: "suggestion"; target: EditorBlockTarget }
  | null;
