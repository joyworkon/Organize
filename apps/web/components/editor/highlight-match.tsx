import type { ReactNode } from "react";

/**
 * 把 `text` 中第一处（大小写不敏感）命中 `query` 的片段包成 `<mark>`，供菜单项标签高亮。
 * 只在标签本身含查询子串时高亮；靠 keywords/description 命中的项原样返回。
 * 颜色由所在菜单的 `mark` 样式用现有 token 决定，这里不带内联样式。
 */
export function highlightMatch(text: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase();
  if (!needle || !text) return text;
  const index = text.toLowerCase().indexOf(needle);
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  );
}
