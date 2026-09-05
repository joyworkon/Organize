import {
  downloadMarkdown,
  renderMarkdownExport,
  type MarkdownExportWarning,
} from "./tiptap-to-md";

/**
 * 笔记导出的快照模型：调用方负责在点击瞬间捕获 title/content，
 * 本模块只做渲染与下载，不依赖网络与 React。
 */
export interface NoteExportSnapshot {
  title: string;
  content: Record<string, unknown> | null;
}

export interface NoteExportRender {
  markdown: string;
  filename: string;
  warnings: MarkdownExportWarning[];
}

/** 文件名清洗：非法字符替换为下划线（与既有导出入口行为一致）。 */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

/**
 * 把快照渲染为 Markdown 与下载文件名（纯函数，便于测试与复用）。
 * markdown 里的标题回退“无标题”；文件名回退 "note"（与历史行为一致）。
 */
export function renderNoteExport(
  snapshot: NoteExportSnapshot,
  fallbackTitle?: string
): NoteExportRender {
  const title = snapshot.title || fallbackTitle || "";
  const { markdown, warnings } = renderMarkdownExport(snapshot.content, title || "无标题");
  const filename = sanitizeFilename(snapshot.title || fallbackTitle || "note");
  return { markdown, filename, warnings };
}

/**
 * 渲染并触发浏览器下载；同步执行，不发起网络请求。
 * 下载已触发即返回渲染结果（warnings 由调用侧决定提示文案）。
 */
export function downloadNoteExport(
  snapshot: NoteExportSnapshot,
  fallbackTitle?: string
): NoteExportRender {
  const rendered = renderNoteExport(snapshot, fallbackTitle);
  downloadMarkdown(rendered.filename, rendered.markdown);
  return rendered;
}
