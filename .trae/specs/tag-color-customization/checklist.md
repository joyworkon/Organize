# T25: 标签颜色自定义 - Verification Checklist

- [x] 数据库迁移文件 `supabase/migrations/017_tag_colors.sql` 存在，SQL 正确（添加 color 字段，默认 'blue'，CHECK 约束）
- [x] `packages/shared/src/index.ts` 中 TagColor 类型和 Tag.color 字段已添加
- [x] `components/tags/tag-color-picker.tsx` 已创建，显示 16 个颜色圆点，选中态有 ring 标识
- [x] `components/tags/tag-badge.tsx` 已创建，COLOR_STYLES 使用静态类名映射全部 16 种颜色，支持 sm/md 尺寸
- [x] 标签管理页 `app/(main)/tags/page.tsx` 已集成颜色选择器，新建/编辑可选择颜色
- [x] 所有查询 tags 的地方 select 包含 color 字段（tag-filter, tag-selector, task-dialog, lessons/[id], 首页, lessons, tasks, task/[id] 等）
- [x] 卡片组件（ReadingCard, NoteCard, TaskCard, LessonCard）中 TagBadge 统一使用 size="sm"
- [x] 任务详情页 `app/(main)/tasks/[id]/page.tsx` 更新为使用 TagBadge
- [x] mock-data 中标签添加不同颜色（技术=blue, 产品=orange, 阅读=green, 灵感=purple）
- [x] TagBadge 的 onRemove 回调无参数（兼容现有代码）
- [x] `cd apps/web && npx tsc --noEmit` 零错误（EXIT_CODE: 0）
- [x] 深色模式下标签颜色适配（COLOR_STYLES 包含 dark:bg-*-900/50 dark:text-*-300）
- [x] 不引入新 npm 包
- [x] 无动态拼接 Tailwind 类名（COLOR_STYLES 和 COLOR_DOT_CLASSES 全部使用静态类名）
