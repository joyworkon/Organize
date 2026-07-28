# T25: 标签颜色自定义 - Implementation Plan

大部分工作已在之前的会话中完成，剩余收尾工作。

---

## [x] Task 1: 创建数据库迁移文件
- **Priority**: high
- **Depends On**: None
- **Description**: 创建 `supabase/migrations/017_tag_colors.sql`，为 tags 表添加 color 字段
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `programmatic` TR-1.1: 迁移文件存在且 SQL 语法正确
- **Status**: ✅ 已完成

## [x] Task 2: 更新共享类型
- **Priority**: high
- **Depends On**: None
- **Description**: 在 `packages/shared/src/index.ts` 添加 TagColor 类型，Tag 接口添加 color 字段
- **Acceptance Criteria Addressed**: AC-2
- **Test Requirements**:
  - `programmatic` TR-2.1: TagColor 类型包含 16 种颜色
  - `programmatic` TR-2.2: Tag 接口包含 color?: TagColor
- **Status**: ✅ 已完成

## [x] Task 3: 创建 TagColorPicker 组件
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 创建 `components/tags/tag-color-picker.tsx`，16 个颜色圆点选择器
- **Acceptance Criteria Addressed**: AC-3
- **Test Requirements**:
  - `programmatic` TR-3.1: 组件导出，props 类型正确
  - `human-judgement` TR-3.2: 16 个颜色圆点可点击，选中态有 ring 标识
- **Status**: ✅ 已完成

## [x] Task 4: 创建 TagBadge 组件
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 创建 `components/tags/tag-badge.tsx`，统一标签徽章组件，使用静态 COLOR_STYLES 映射
- **Acceptance Criteria Addressed**: AC-4
- **Test Requirements**:
  - `programmatic` TR-4.1: COLOR_STYLES 包含全部 16 种颜色的静态类名
  - `programmatic` TR-4.2: 支持 sm/md 两种尺寸，onClick/onRemove 回调
  - `human-judgement` TR-4.3: 颜色显示正确，深色模式适配
- **Status**: ✅ 已完成

## [x] Task 5: 更新标签管理页
- **Priority**: high
- **Depends On**: Task 3, Task 4
- **Description**: 更新 `app/(main)/tags/page.tsx`，新建/编辑标签时可选择颜色
- **Acceptance Criteria Addressed**: AC-5
- **Test Requirements**:
  - `programmatic` TR-5.1: 查询 tags 时 select 包含 color 字段
  - `programmatic` TR-5.2: upsert/update 时保存 color 字段
  - `human-judgement` TR-5.3: 标签列表显示彩色徽章
- **Status**: ✅ 已完成

## [x] Task 6: 更新相关组件的标签查询和类型
- **Priority**: high
- **Depends On**: Task 4
- **Description**: 更新 tag-filter.tsx, tag-selector.tsx, task-dialog.tsx, lessons/[id]/page.tsx, page.tsx (首页), lessons/page.tsx, tasks/page.tsx 等，查询 tags 时带上 color 字段，修复 TagBadge 回调兼容性
- **Acceptance Criteria Addressed**: AC-6
- **Test Requirements**:
  - `programmatic` TR-6.1: 所有 `from("tags").select(...)` 包含 color 字段
  - `programmatic` TR-6.2: onRemove 回调签名与 TagBadge 一致（无参数）
- **Status**: ✅ 已完成

## [x] Task 7: 统一卡片组件使用 size="sm"
- **Priority**: medium
- **Depends On**: Task 4
- **Description**: 将 ReadingCard、NoteCard、TaskCard、LessonCard、TaskDetailPage 中 TagBadge 的自定义 className 替换为 `size="sm"`，统一尺寸
- **Acceptance Criteria Addressed**: AC-6
- **Test Requirements**:
  - `programmatic` TR-7.1: 所有卡片组件中 TagBadge 使用 size="sm" 而非自定义 className 覆盖尺寸
  - `human-judgement` TR-7.2: 卡片中标签大小统一、美观
- **Files modified**:
  - `apps/web/components/reading/reading-card.tsx`
  - `apps/web/components/notes/note-card.tsx`（2 处）
  - `apps/web/components/tasks/task-card.tsx`
  - `apps/web/components/lessons/lesson-card.tsx`
  - `apps/web/app/(main)/tasks/[id]/page.tsx`（新增 TagBadge 导入+替换旧样式）
- **Status**: ✅ 已完成

## [x] Task 8: 更新 mock-data 添加颜色
- **Priority**: medium
- **Depends On**: Task 2
- **Description**: 在 `lib/supabase/mock-data.ts` 的 tags 数组中为标签添加不同 color
- **Acceptance Criteria Addressed**: AC-7
- **Test Requirements**:
  - `programmatic` TR-8.1: mock tags 数据包含 color 字段
  - `human-judgement` TR-8.2: 不同标签有不同颜色（技术=blue, 产品=orange, 阅读=green, 灵感=purple）
- **Files modified**:
  - `apps/web/lib/supabase/mock-data.ts` tags 数组
- **Status**: ✅ 已完成

## [x] Task 9: TypeScript 验证
- **Priority**: high
- **Depends On**: Task 7, Task 8
- **Description**: 运行 `cd apps/web && npx tsc --noEmit` 确保零错误
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-9.1: tsc 退出码为 0，无错误输出
- **Status**: ✅ 已完成（EXIT_CODE: 0）

## [x] Task 10: 深色模式视觉检查
- **Priority**: medium
- **Depends On**: Task 7, Task 8
- **Description**: TagBadge 组件已使用 dark: 前缀类名（dark:bg-*-900/50 dark:text-*-300），深色模式通过静态类名映射保证
- **Acceptance Criteria Addressed**: AC-9
- **Test Requirements**:
  - `programmatic` TR-10.1: COLOR_STYLES 中每个颜色都包含 dark: 变体
- **Status**: ✅ 已完成（代码审查确认）
