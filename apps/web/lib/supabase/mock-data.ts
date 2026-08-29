// 开发用「假后端」：无 Supabase 时用内存数据驱动 UI，方便调样式。
// 仅当 NEXT_PUBLIC_MOCK_BACKEND=true 时启用（见 client.ts）。接真实后端后删掉即可。

const MOCK_USER = {
  id: "mock-user-0001",
  email: "dev@organize.local",
  user_metadata: { name: "开发者" },
  app_metadata: {},
  aud: "authenticated",
  created_at: new Date().toISOString(),
};

const now = Date.now();
const iso = (offsetDays: number) =>
  new Date(now - offsetDays * 86400000).toISOString();

// ---- 标签 ----
const tags = [
  { id: "tag-1", user_id: MOCK_USER.id, name: "技术", color: "blue" },
  { id: "tag-2", user_id: MOCK_USER.id, name: "产品", color: "orange" },
  { id: "tag-3", user_id: MOCK_USER.id, name: "阅读", color: "green" },
  { id: "tag-4", user_id: MOCK_USER.id, name: "灵感", color: "purple" },
];

// ---- 阅读条目 ----
const readingItems = [
  {
    id: "item-1",
    user_id: MOCK_USER.id,
    url: "https://overreacted.io/a-complete-guide-to-useeffect/",
    title: "useEffect 完全指南",
    excerpt:
      "深入理解 React useEffect 的心智模型：它不是生命周期，而是与渲染同步的副作用。",
    content:
      "<h2>不要把 useEffect 当生命周期</h2><p>每一次渲染都有它自己的 props 和 state……</p><p>这篇文章会带你重建对 effect 的心智模型。</p>",
    cover_image: "https://picsum.photos/seed/useeffect/640/360",
    reading_status: "reading",
    reading_progress: 0.42,
    is_pinned: true,
    created_at: iso(2),
    updated_at: iso(1),
    tags: [tags[0]],
  },
  {
    id: "item-2",
    user_id: MOCK_USER.id,
    url: "https://www.paulgraham.com/greatwork.html",
    title: "How to Do Great Work",
    excerpt:
      "Paul Graham 谈如何做出伟大的工作：好奇心、专注、以及对某件事近乎痴迷的兴趣。",
    content:
      "<p>If you collected lists of techniques for doing great work in a lot of different fields...</p>",
    cover_image: "https://picsum.photos/seed/greatwork/640/360",
    reading_status: "unread",
    reading_progress: 0,
    is_pinned: false,
    created_at: iso(4),
    updated_at: iso(4),
    tags: [tags[2], tags[3]],
  },
  {
    id: "item-3",
    user_id: MOCK_USER.id,
    url: "https://linear.app/blog/how-we-built-linear",
    title: "我们是如何打造 Linear 的",
    excerpt: "从第一性原理出发做一款「快到令人上瘾」的项目管理工具。",
    content: "<p>Speed is a feature. 我们把性能当作产品的第一功能……</p>",
    cover_image: "https://picsum.photos/seed/linear/640/360",
    reading_status: "read",
    reading_progress: 1,
    is_pinned: false,
    created_at: iso(7),
    updated_at: iso(3),
    tags: [tags[1]],
  },
  {
    id: "item-4",
    user_id: MOCK_USER.id,
    url: "https://mp.weixin.qq.com/s/example",
    title: "微信公众号：一篇没有封面的长文",
    excerpt: "测试无封面卡片的排版效果，标题较长时如何优雅省略。",
    content: "<p>正文内容……</p>",
    cover_image: null,
    reading_status: "unread",
    reading_progress: 0,
    is_pinned: false,
    created_at: iso(9),
    updated_at: iso(9),
    tags: [],
  },
  {
    id: "item-5",
    user_id: MOCK_USER.id,
    url: "https://www.nngroup.com/articles/ten-usability-heuristics/",
    title: "十大可用性启发式原则",
    excerpt: "Nielsen 的经典可用性原则，做界面设计时的常备清单。",
    content: "<ol><li>系统状态可见</li><li>贴近真实世界</li></ol>",
    cover_image: "https://picsum.photos/seed/heuristics/640/360",
    reading_status: "reading",
    reading_progress: 0.68,
    is_pinned: false,
    created_at: iso(12),
    updated_at: iso(2),
    tags: [tags[1], tags[0]],
  },
];

// ---- item_tags 关联 ----
const itemTags = readingItems.flatMap((it) =>
  (it.tags || []).map((t) => ({ item_id: it.id, tag_id: t.id }))
);

// ---- 笔记 ----
const doc = (text: string) => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] },
    {
      type: "paragraph",
      content: [{ type: "text", text: "这是一段示例正文，用于预览编辑器排版。" }],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "要点一" }] },
          ],
        },
        {
          type: "listItem",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "要点二" }] },
          ],
        },
      ],
    },
  ],
});

const notes = [
  {
    id: "note-1",
    user_id: MOCK_USER.id,
    title: "读《useEffect 完全指南》的笔记",
    content: doc("核心心智模型"),
    reading_item_id: "item-1",
    icon: "📘",
    cover_url: "https://picsum.photos/seed/organize-note-cover/1600/480",
    cover_position: 50,
    parent_note_id: null,
    full_width: true,
    font_family: "default" as const,
    small_font: false,
    content_revision: 0,
    is_pinned: true,
    created_at: iso(1),
    updated_at: iso(0),
    reading_item: { id: "item-1", title: "useEffect 完全指南", url: readingItems[0].url },
    tags: [tags[0]],
  },
  {
    id: "note-2",
    user_id: MOCK_USER.id,
    title: "产品灵感碎片",
    content: doc("一些零散的想法"),
    reading_item_id: null,
    icon: "💡",
    cover_url: null,
    cover_position: 50,
    parent_note_id: "note-1",
    full_width: true,
    font_family: "default" as const,
    small_font: false,
    content_revision: 0,
    is_pinned: false,
    created_at: iso(3),
    updated_at: iso(1),
    reading_item: null,
    tags: [tags[1], tags[3]],
  },
  {
    id: "note-3",
    user_id: MOCK_USER.id,
    title: "无标题笔记",
    content: doc("随手记"),
    reading_item_id: null,
    icon: null,
    cover_url: null,
    cover_position: 50,
    parent_note_id: null,
    full_width: true,
    font_family: "default" as const,
    small_font: false,
    content_revision: 0,
    is_pinned: false,
    created_at: iso(5),
    updated_at: iso(5),
    reading_item: null,
    tags: [],
  },
];

const noteTags = notes.flatMap((n) =>
  (n.tags || []).map((t) => ({ note_id: n.id, tag_id: t.id }))
);

// ---- 任务 ----
const tasks = [
  {
    id: "task-1",
    user_id: MOCK_USER.id,
    title: "完成 Organize 任务功能开发",
    description: "实现任务列表、创建、编辑、完成状态切换，以及经验总结关联",
    status: "in_progress",
    priority: "high",
    category: "work",
    due_date: iso(-2),
    estimated_minutes: 240,
    actual_minutes: 120,
    reading_item_id: null,
    note_id: null,
    is_pinned: true,
    completed_at: null,
    created_at: iso(1),
    updated_at: iso(0),
    tags: [tags[0], tags[1]],
  },
  {
    id: "task-2",
    user_id: MOCK_USER.id,
    title: "阅读 useEffect 完全指南并做笔记",
    description: "读完 Dan 的博客文章，整理关键知识点",
    status: "todo",
    priority: "medium",
    category: "study",
    due_date: iso(-1),
    estimated_minutes: 60,
    actual_minutes: null,
    reading_item_id: "item-1",
    note_id: "note-1",
    is_pinned: false,
    completed_at: null,
    created_at: iso(2),
    updated_at: iso(2),
    tags: [tags[0], tags[2]],
  },
  {
    id: "task-3",
    user_id: MOCK_USER.id,
    title: "总结这季度的工作收获",
    description: "写一份季度复盘，记录做的好的和需要改进的地方",
    status: "todo",
    priority: "medium",
    category: "work",
    due_date: iso(-5),
    estimated_minutes: 90,
    actual_minutes: null,
    reading_item_id: null,
    note_id: null,
    is_pinned: false,
    completed_at: null,
    created_at: iso(3),
    updated_at: iso(3),
    tags: [tags[1]],
  },
  {
    id: "task-4",
    user_id: MOCK_USER.id,
    title: "健身 - 跑步5公里",
    description: "",
    status: "done",
    priority: "low",
    category: "life",
    due_date: iso(0),
    estimated_minutes: 30,
    actual_minutes: 32,
    reading_item_id: null,
    note_id: null,
    is_pinned: false,
    completed_at: iso(0),
    created_at: iso(1),
    updated_at: iso(0),
    tags: [],
  },
  {
    id: "task-5",
    user_id: MOCK_USER.id,
    title: "研究 Linear 的设计理念",
    description: "阅读 Linear 的博客文章，总结他们的产品设计思路",
    status: "done",
    priority: "medium",
    category: "study",
    due_date: iso(3),
    estimated_minutes: 45,
    actual_minutes: 50,
    reading_item_id: "item-3",
    note_id: null,
    is_pinned: false,
    completed_at: iso(3),
    created_at: iso(7),
    updated_at: iso(3),
    tags: [tags[1], tags[2]],
  },
];

// 让任务预览直接体现工作台的三栏/日历状态：真实数据库由033迁移回填这些字段。
const mockListByCategory: Record<string, string> = {
  work: "mock-list-work",
  study: "mock-list-study",
  life: "mock-list-life",
};
tasks.forEach((task, index) => {
  (task as any).parent_task_id = null;
  (task as any).list_id = mockListByCategory[task.category] || null;
  (task as any).schedule_start_at = task.due_date;
  (task as any).schedule_end_at = index === 0 && task.due_date
    ? new Date(new Date(task.due_date).getTime() + 2 * 86400000).toISOString()
    : null;
  (task as any).all_day = false;
  (task as any).timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  (task as any).recurrence_rule = null;
});

const taskTags = tasks.flatMap((t) =>
  (t.tags || []).map((tag) => ({ task_id: t.id, tag_id: tag.id }))
);

// ---- 任务子任务 ----
const taskChecklists = [
  {
    id: "checklist-1",
    task_id: "task-1",
    content: "实现任务列表页",
    is_completed: true,
    sort_order: 0,
    created_at: iso(1),
    updated_at: iso(0),
  },
  {
    id: "checklist-2",
    task_id: "task-1",
    content: "实现任务创建/编辑对话框",
    is_completed: true,
    sort_order: 1,
    created_at: iso(1),
    updated_at: iso(0),
  },
  {
    id: "checklist-3",
    task_id: "task-1",
    content: "实现任务详情页和子任务功能",
    is_completed: false,
    sort_order: 2,
    created_at: iso(1),
    updated_at: iso(0),
  },
  {
    id: "checklist-4",
    task_id: "task-2",
    content: "通读文章并标记重点",
    is_completed: false,
    sort_order: 0,
    created_at: iso(2),
    updated_at: iso(2),
  },
  {
    id: "checklist-5",
    task_id: "task-2",
    content: "整理关键知识点",
    is_completed: false,
    sort_order: 1,
    created_at: iso(2),
    updated_at: iso(2),
  },
];

// ---- 经验总结 ----
const lessonDoc = (text: string) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text }] },
  ],
});

const lessons = [
  {
    id: "lesson-1",
    user_id: MOCK_USER.id,
    title: "关于专注工作的一点体会",
    content: lessonDoc("今天跑步的时候想明白了一个道理：深度工作的关键不是时间管理，而是注意力管理。番茄钟本质上是在训练你保持专注的肌肉，而不是分割时间。"),
    lesson_type: "reflection",
    task_id: "task-4",
    reading_item_id: null,
    note_id: null,
    created_at: iso(0),
    updated_at: iso(0),
    tags: [tags[3]],
  },
  {
    id: "lesson-2",
    user_id: MOCK_USER.id,
    title: "产品设计的第一原则：速度",
    content: lessonDoc("读了 Linear 的博客，他们把速度当作产品的第一功能。这点很有启发——很多工具功能很多，但操作起来总是有延迟感，用久了就会累。快本身就是一种体验。"),
    lesson_type: "lesson",
    task_id: "task-5",
    reading_item_id: "item-3",
    note_id: null,
    created_at: iso(3),
    updated_at: iso(3),
    tags: [tags[1]],
  },
  {
    id: "lesson-3",
    user_id: MOCK_USER.id,
    title: "可以做一个任务+经验关联的功能",
    content: lessonDoc("突然想到：任务完成后写经验总结，然后经验可以被搜索和引用，这样就形成了「行动→复盘→知识」的闭环。"),
    lesson_type: "insight",
    task_id: null,
    reading_item_id: null,
    note_id: null,
    created_at: iso(2),
    updated_at: iso(2),
    tags: [tags[3], tags[1]],
  },
];

const lessonTags = lessons.flatMap((l) =>
  (l.tags || []).map((tag) => ({ lesson_id: l.id, tag_id: tag.id }))
);

// ---- 编辑器协作种子（历史版本 / 块评论；由 mock API shim 消费）----
const noteVersions = [
  {
    id: "mock-version-1",
    note_id: "note-1",
    title: "读《useEffect 完全指南》的笔记",
    message: "初次保存",
    content: doc("历史版本快照：初次保存的标题"),
    created_at: iso(3),
  },
  {
    id: "mock-version-2",
    note_id: "note-1",
    title: "读《useEffect 完全指南》的笔记",
    message: "补充要点",
    content: doc("历史版本快照：补充要点后的标题"),
    created_at: iso(1),
  },
];

const noteCommentThreadSeeds = [
  {
    id: "mock-thread-1",
    note_id: "note-1",
    block_id: "mock-block-1",
    user_id: MOCK_USER.id,
    resolved_at: null,
    created_at: iso(1),
  },
];

const noteCommentSeeds = [
  {
    id: "mock-comment-1",
    thread_id: "mock-thread-1",
    user_id: MOCK_USER.id,
    body: "这一段读完可以对照原文的「和渲染同步」小节再核对一遍。",
    created_at: iso(1),
  },
  {
    id: "mock-comment-2",
    thread_id: "mock-thread-1",
    user_id: MOCK_USER.id,
    body: "已对照，要点二可以补充一个具体例子。",
    created_at: iso(0.5),
  },
];

// ---- 速记种子（055；由 mock API shim 消费）----
const memos = [
  {
    id: "mock-memo-1",
    user_id: MOCK_USER.id,
    content: "读长文前先看目录挑两节精读，别从头到尾硬啃 #阅读方法",
    tags: ["阅读方法"],
    deleted_at: null,
    created_at: iso(2),
    updated_at: iso(2),
  },
  {
    id: "mock-memo-2",
    user_id: MOCK_USER.id,
    content: "速记的入口要离手最近，否则坚持不了一周 #产品 #灵感",
    tags: ["产品", "灵感"],
    deleted_at: null,
    created_at: iso(0.5),
    updated_at: iso(0.5),
  },
];

// 内存表：用可变数组，让增删改在会话内「像真的」
export const mockDb: Record<string, any[]> = {
  tags,
  reading_items: readingItems,
  notes,
  item_tags: itemTags,
  note_tags: noteTags,
  tasks,
  task_tags: taskTags,
  task_dependencies: [],
  task_checklists: taskChecklists,
  lessons,
  lesson_tags: lessonTags,
  memos,
  // P0-03：AI 配置经 /api/ai/settings 受控读写（密钥只回掩码），mock 下空表起步
  user_ai_settings: [],
  plugins: [],
  shares: [],
  note_versions: noteVersions,
  note_comment_threads: noteCommentThreadSeeds,
  note_comments: noteCommentSeeds,
  note_suggestions: [],
  highlights: [],
  favorites: [],
  // 059 任务原子变更协议的幂等日志（同步管道内部数据，不入备份）
  task_mutations: [],
  // 033 任务工作台新表
  task_lists: [
    { id: "mock-list-work", user_id: MOCK_USER.id, name: "工作", icon: "💼", color: "#3b82f6", sort_order: 0, is_default: true, deleted_at: null, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" },
    { id: "mock-list-rls", user_id: MOCK_USER.id, name: "RLS测试", icon: "📋", color: "#8b7d73", sort_order: 1, is_default: false, deleted_at: null, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" },
    { id: "mock-list-study", user_id: MOCK_USER.id, name: "学习", icon: "📚", color: "#8b5cf6", sort_order: 2, is_default: true, deleted_at: null, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" },
    { id: "mock-list-life", user_id: MOCK_USER.id, name: "生活", icon: "🏠", color: "#10b981", sort_order: 3, is_default: true, deleted_at: null, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" },
  ],
  task_reminders: [],
  web_push_subscriptions: [],
  task_reminder_deliveries: [],
  task_attachments: [],
  task_activities: [],
  task_templates: [],
  countdown_days: [
    {
      id: "countdown-release",
      user_id: MOCK_USER.id,
      title: "Organize 发布日",
      target_date: "2026-12-31",
      repeat_annually: false,
      deleted_at: null,
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
    },
    {
      id: "countdown-birthday",
      user_id: MOCK_USER.id,
      title: "产品周年纪念日",
      target_date: "2026-10-18",
      repeat_annually: true,
      deleted_at: null,
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
    },
  ],
};

export { MOCK_USER };
