// 阅读状态
export type ReadingStatus = "unread" | "reading" | "read";

// 阅读条目
export interface ReadingItem {
  id: string;
  user_id: string;
  url: string;
  title: string | null;
  content: string | null;
  excerpt: string | null;
  cover_image: string | null;
  reading_status: ReadingStatus;
  reading_progress: number;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
}

// 笔记
export interface Note {
  id: string;
  user_id: string;
  title: string | null;
  content: Record<string, unknown> | null;
  reading_item_id: string | null;
  created_at: string;
  updated_at: string;
  reading_item?: ReadingItem;
}

// 笔记编辑器块上下文
export interface EditorBlockContext {
  noteId: string;
  blockId: string;
  nodeType: string;
  text: string;
  json: Record<string, unknown>;
  selection?: { from: number; to: number; text: string };
}

export interface BlockCommand {
  id: string;
  label: string;
  category: "suggested" | "basic" | "layout" | "media";
  keywords: string[];
  shortcut?: string;
}

export interface CommentThread {
  id: string;
  note_id: string;
  block_id: string;
  user_id: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  comments?: BlockComment[];
}

export interface BlockComment {
  id: string;
  thread_id: string;
  user_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface EditSuggestion {
  id: string;
  note_id: string;
  block_id: string;
  user_id: string;
  original_block: Record<string, unknown>;
  proposed_block: Record<string, unknown>;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  updated_at: string;
}

export interface AIBlockResult {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  transcript?: string;
}

// 标签
export interface Tag {
  id: string;
  user_id: string;
  name: string;
}

// 插件记录
export interface PluginRecord {
  id: string;
  user_id: string;
  name: string;
  package_name: string;
  version: string | null;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

// 抓取结果
export interface ScrapeResult {
  url: string;
  title: string;
  content: string;
  excerpt: string;
  cover_image: string | null;
  site_name: string | null;
  author: string | null;
  published_time: string | null;
}

// 阅读状态配置
export const READING_STATUS_CONFIG: Record<
  ReadingStatus,
  { label: string; color: string }
> = {
  unread: { label: "未读", color: "bg-gray-100 text-gray-800" },
  reading: { label: "在读", color: "bg-blue-100 text-blue-800" },
  read: { label: "已读", color: "bg-green-100 text-green-800" },
};
