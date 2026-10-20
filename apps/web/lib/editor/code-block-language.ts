/**
 * 代码块工具栏的纯函数：语言预设与归一化、工具栏显隐判定、可复制文本、
 * 渲染属性里的 inline style 转对象。
 *
 * `language` 复用 TipTap CodeBlock 既有属性：写入一律小写 id，空值归 null（与旧文档
 * 缺省一致，getJSON 不变）；`wrap` 是本次新增的可选属性，缺省 false = 改前表现。
 * 不做语法高亮，这里不依赖任何高亮库。
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, type Selection } from "@tiptap/pm/state";

export interface CodeBlockLanguage {
  /** 写进 attrs.language 的小写 id（与 Markdown fence 标签一致） */
  id: string;
  /** 菜单显示名 */
  label: string;
}

/** 「纯文本」= 不写语言（attrs.language 为 null） */
export const PLAIN_LANGUAGE_LABEL = "纯文本";

export const CODE_BLOCK_LANGUAGES: readonly CodeBlockLanguage[] = [
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "tsx", label: "TSX" },
  { id: "python", label: "Python" },
  { id: "bash", label: "Bash" },
  { id: "json", label: "JSON" },
  { id: "css", label: "CSS" },
  { id: "html", label: "HTML" },
  { id: "markdown", label: "Markdown" },
  { id: "sql", label: "SQL" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "java", label: "Java" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "yaml", label: "YAML" },
  { id: "toml", label: "TOML" },
  { id: "plaintext", label: "Plain Text" },
];

const LANGUAGE_ID_PATTERN = /^[a-z0-9][a-z0-9+#._-]*$/;

/** 归一化语言 id：去空白、转小写；空值或含非法字符 → null（TipTap 默认值）。 */
export function normalizeCodeBlockLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return LANGUAGE_ID_PATTERN.test(normalized) ? normalized : null;
}

/** 文档里实际存的语言字符串（原样，用于 data-language）；空/非字符串 → null。 */
export function storedCodeBlockLanguage(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** 菜单显示名：预设命中用 label，预设外的既有值原样显示，空值显示「纯文本」。 */
export function codeBlockLanguageLabel(value: unknown): string {
  const id = normalizeCodeBlockLanguage(value);
  if (!id) return PLAIN_LANGUAGE_LABEL;
  return CODE_BLOCK_LANGUAGES.find((item) => item.id === id)?.label ?? id;
}

/** 菜单选项：预设列表；当前值不在预设内时置顶一条，保证能看到并保留它。 */
export function codeBlockLanguageOptions(current: unknown): CodeBlockLanguage[] {
  const id = normalizeCodeBlockLanguage(current);
  if (!id || CODE_BLOCK_LANGUAGES.some((item) => item.id === id)) return [...CODE_BLOCK_LANGUAGES];
  return [{ id, label: id }, ...CODE_BLOCK_LANGUAGES];
}

/** `wrap` 属性缺省 false；只有 true / "true"（data-wrap）算开启。 */
export function normalizeCodeBlockWrap(value: unknown): boolean {
  return value === true || value === "true";
}

export type CodeBlockSelectionState = "node" | "inside" | "none";

/**
 * 当前选区与某个代码块（pos / nodeSize）的关系：
 * - NodeSelection 恰好选中本块 → "node"（选中父容器、Cmd+A 都不算）；
 * - 选区两端都落在本块内容里 → "inside"（跨块拖选不算）；
 * - 其余 → "none"。
 */
export function codeBlockSelectionState(selection: Selection, pos: number, nodeSize: number): CodeBlockSelectionState {
  if (selection instanceof NodeSelection) return selection.from === pos ? "node" : "none";
  const start = pos + 1;
  const end = pos + nodeSize - 1;
  return selection.from >= start && selection.to <= end ? "inside" : "none";
}

/**
 * 工具栏显示规则：
 * - 整块被选中：显示（与图片块一致，不看编辑器焦点）；
 * - 光标在块内（空选区）：可编辑时要求编辑器有焦点或正在操作工具栏菜单；只读根元素
 *   不可聚焦，所以只读时只看选区；
 * - 块内非空文字选区：不显示，避免与文字气泡工具栏重叠。
 */
export function shouldShowCodeBlockToolbar(input: {
  state: CodeBlockSelectionState;
  selectionEmpty: boolean;
  editable: boolean;
  editorFocused: boolean;
  interacting: boolean;
}): boolean {
  const { state, selectionEmpty, editable, editorFocused, interacting } = input;
  if (state === "node") return true;
  if (state !== "inside" || !selectionEmpty) return false;
  return !editable || editorFocused || interacting;
}

/** 可复制文本：代码块内容是单个文本序列，换行就是文本里的 \n，原样保留。 */
export function codeBlockCopyText(node: ProseMirrorNode): string {
  return node.type.name === "codeBlock" ? node.textContent : "";
}

/**
 * 把 renderHTML 合并出的 inline style 字符串（如 `background-color:#fff;`）转成 React
 * style 对象；自定义属性（--x）保留原名，其余转 camelCase。
 */
export function inlineStyleToObject(style: unknown): Record<string, string> {
  if (typeof style !== "string") return {};
  const result: Record<string, string> = {};
  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;
    const property = declaration.slice(0, separator).trim();
    const value = declaration.slice(separator + 1).trim();
    if (!property || !value) continue;
    const key = property.startsWith("--")
      ? property
      : property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    result[key] = value;
  }
  return result;
}
