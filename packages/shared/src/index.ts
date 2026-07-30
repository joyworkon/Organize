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
  started_reading_at: string | null;
  completed_reading_at: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
  is_pinned?: boolean;
}

// 笔记字体选项
export type NoteFont = "default" | "serif" | "mono";

// 笔记
export interface Note {
  id: string;
  user_id: string;
  title: string | null;
  content: Record<string, unknown> | null;
  reading_item_id: string | null;
  icon?: string | null;
  cover_url?: string | null;
  cover_position?: number;
  parent_note_id?: string | null;
  full_width?: boolean;
  font_family?: NoteFont;
  small_font?: boolean;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  reading_item?: ReadingItem;
  is_pinned?: boolean;
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

// 标签颜色类型
export type TagColor = 'gray' | 'red' | 'orange' | 'amber' | 'yellow' | 'green' | 'emerald' | 'teal' | 'cyan' | 'blue' | 'indigo' | 'violet' | 'purple' | 'fuchsia' | 'pink' | 'rose';

// 标签
export interface Tag {
  id: string;
  user_id: string;
  name: string;
  color?: TagColor;
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
  unread: { label: "未读", color: "bg-muted text-muted-foreground" },
  reading: { label: "在读", color: "bg-accent text-accent-foreground" },
  read: { label: "已读", color: "bg-primary/10 text-primary" },
};

// ---- 标签系统扩展（005 迁移后新增，012迁移扩展task/lesson）----
// 可被打标签的资源类型
export type TaggableResource = "note" | "reading_item" | "task" | "lesson";

// 带标签的笔记（扩展 Note，不修改原接口避免和其它分支冲突）
export interface NoteWithTags extends Note {
  tags?: Tag[];
}

// 带使用计数的标签（用于标签管理/筛选 UI）
export interface TagWithCount extends Tag {
  note_count?: number;
  reading_item_count?: number;
  task_count?: number;
  lesson_count?: number;
}

// 笔记-标签关联记录
export interface NoteTag {
  note_id: string;
  tag_id: string;
}

// ---- 待办任务（012 迁移新增）----
export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";
export type TaskPriority = "high" | "medium" | "low";
export type TaskCategory = "work" | "study" | "life";

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory;
  due_date: string | null;
  estimated_minutes: number | null;
  actual_minutes: number | null;
  reading_item_id: string | null;
  note_id: string | null;
  is_pinned: boolean;
  sort_order: number;
  completed_at: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
  reading_item?: ReadingItem;
  note?: Note;
  checklists?: TaskChecklist[];
}

export interface TaskChecklist {
  id: string;
  task_id: string;
  content: string;
  is_completed: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaskWithTags extends Task {
  tags?: Tag[];
}

export const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: "待办", color: "bg-muted text-muted-foreground" },
  in_progress: { label: "进行中", color: "bg-primary/10 text-primary" },
  done: { label: "已完成", color: "bg-green-500/10 text-green-600 dark:text-green-400" },
  cancelled: { label: "已取消", color: "bg-muted text-muted-foreground line-through" },
};

export const TASK_PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; dot: string }> = {
  high: { label: "高", color: "text-red-600 dark:text-red-400", dot: "bg-red-500" },
  medium: { label: "中", color: "text-orange-500 dark:text-orange-400", dot: "bg-orange-500" },
  low: { label: "低", color: "text-muted-foreground", dot: "bg-muted-foreground/40" },
};

export const TASK_CATEGORY_CONFIG: Record<TaskCategory, { label: string; color: string; bg: string; icon: string }> = {
  work: { label: "工作", color: "text-primary", bg: "bg-primary/10", icon: "💼" },
  study: { label: "学习", color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/10", icon: "📚" },
  life: { label: "生活", color: "text-accent-foreground", bg: "bg-accent", icon: "🏠" },
};

// ---- 经验总结（012 迁移新增）----
export type LessonType = "reflection" | "lesson" | "insight";

export interface Lesson {
  id: string;
  user_id: string;
  title: string | null;
  content: Record<string, unknown> | null;
  lesson_type: LessonType;
  task_id: string | null;
  reading_item_id: string | null;
  note_id: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
}

export interface LessonWithTags extends Lesson {
  tags?: Tag[];
}

export const LESSON_TYPE_CONFIG: Record<LessonType, { label: string; icon: string; color: string; description: string }> = {
  reflection: { label: "复盘", icon: "📝", color: "text-blue-500", description: "任务完成后的总结反思" },
  lesson: { label: "经验", icon: "💡", color: "text-amber-500", description: "学到的知识和技巧" },
  insight: { label: "灵感", icon: "✨", color: "text-purple-500", description: "突发的灵感和想法" },
};

// ---- 分享功能（006 迁移后新增）----
export type ShareResourceType = "note" | "reading_item";

export interface Share {
  id: string;
  owner_id: string;
  resource_type: ShareResourceType;
  resource_id: string;
  token: string;
  is_public: boolean;
  expires_at: string | null;
  created_at: string;
}

// ---- 文章高亮（划线）（014 迁移新增）----
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

export interface Highlight {
  id: string;
  user_id: string;
  reading_item_id: string;
  content: string;
  note?: string | null;
  color: HighlightColor;
  anchor_path?: string | null;
  anchor_offset?: number | null;
  created_at: string;
  updated_at: string;
}

// ---- 收藏夹（016 迁移新增）----
export type FavoriteTargetType = 'reading' | 'note' | 'task';

export interface Favorite {
  id: string;
  user_id: string;
  target_type: FavoriteTargetType;
  target_id: string;
  note?: string | null;
  created_at: string;
}
