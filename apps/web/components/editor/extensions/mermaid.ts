/** Mermaid 块的纯逻辑：默认代码与简单语法预检。 */

export const DEFAULT_MERMAID_CODE = `graph TD
    A[开始] --> B{是否就绪?}
    B -->|是| C[执行]
    B -->|否| D[等待]
    D --> B`;

/**
 * 轻量预检：判断代码是否看起来像可渲染的 mermaid 图。
 * 不做完整语法解析（那是 mermaid 运行时的职责），只挡明显的空内容。
 * 用于 NodeView 在渲染失败时给出友好提示。
 */
export function looksLikeMermaid(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed) return false;
  // mermaid 图通常以图表类型关键字开头
  const firstWord = trimmed.split(/\s/)[0].toLowerCase();
  const knownTypes = [
    "graph", "flowchart", "sequence", "class", "state", "er",
    "gantt", "pie", "journey", "git", "mindmap", "timeline",
    "quadrant", "xychart", "requirement", "c4", "sankey",
  ];
  return knownTypes.some((t) => firstWord.startsWith(t));
}
