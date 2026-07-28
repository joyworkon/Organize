# T25: 标签颜色自定义 - Product Requirement Document

## Overview
- **Summary**: 为 Organize 的标签系统添加颜色自定义功能，允许用户为每个标签选择 16 种预设颜色之一，标签在所有 UI 中以彩色徽章形式展示，提升视觉识别度和分类体验。
- **Purpose**: 解决标签仅有文字、视觉区分度低的问题，通过颜色快速识别不同类别的标签。
- **Target Users**: 所有 Organize 用户，特别是标签使用频繁、需要快速视觉分类的用户。

## Goals
- 用户可为标签选择 16 种预设颜色
- 标签在所有卡片和页面中显示为对应的彩色徽章
- 新建/编辑标签时可选择颜色
- 深色模式下颜色显示正常
- 不引入新依赖包
- 所有 Tailwind 颜色类名静态化（JIT 编译需要）

## Non-Goals (Out of Scope)
- 自定义颜色（仅支持 16 种预设色）
- 标签颜色自动推荐
- 标签按颜色筛选/排序
- 标签拖拽排序（T35 任务）

## Background & Context
- 项目已有 Tag 类型定义和 tags 表
- 标签管理页已支持 CRUD
- 阅读/笔记/任务/经验卡片均显示标签
- Tailwind CSS 使用 JIT 模式，动态类名不会被编译

## Functional Requirements
- **FR-1**: 数据库 tags 表增加 color 字段，默认 'blue'，支持 16 种颜色
- **FR-2**: 新建标签时可选择颜色，默认蓝色
- **FR-3**: 编辑标签时可修改颜色
- **FR-4**: TagColorPicker 组件显示 16 个颜色圆点，选中态有明显标识
- **FR-5**: TagBadge 组件根据 tag.color 渲染对应颜色背景和文字
- **FR-6**: 所有卡片（ReadingCard, NoteCard, TaskCard, LessonCard）中的标签使用 TagBadge 组件，size="sm"
- **FR-7**: mock-data 中标签有不同颜色，便于开发预览
- **FR-8**: 深色模式下标签颜色适配

## Non-Functional Requirements
- **NFR-1**: 不引入新 npm 包
- **NFR-2**: TypeScript 类型检查零错误 (`npx tsc --noEmit`)
- **NFR-3**: 所有颜色类名必须为静态字符串（禁止模板字符串拼接），确保 Tailwind JIT 正确生成 CSS

## Constraints
- **Technical**: Next.js 14, React 18, Tailwind CSS, Supabase, pnpm monorepo
- **Dependencies**: 依赖现有 Tag 类型和 tags 表
- **No new packages**: 不安装额外依赖

## Assumptions
- 现有标签 color 为空时默认使用蓝色（前端 fallback）
- 数据库迁移执行后所有现有标签 color 为 'blue'
- 16 种预设颜色满足绝大多数使用场景

## Acceptance Criteria

### AC-1: 数据库迁移
- **Given**: 项目使用 Supabase 本地数据库
- **When**: 执行迁移 017_tag_colors.sql
- **Then**: tags 表有 color 字段，默认 'blue'，CHECK 约束限制为 16 种颜色值
- **Verification**: `programmatic`

### AC-2: 共享类型更新
- **Given**: packages/shared 包
- **When**: 代码引用 Tag 类型
- **Then**: Tag 接口包含 color?: TagColor，TagColor 为 16 种颜色的联合类型
- **Verification**: `programmatic`

### AC-3: 颜色选择器组件
- **Given**: 用户在新建/编辑标签对话框
- **When**: 查看颜色选择区域
- **Then**: 显示 16 个颜色圆点，点击选择，选中的圆点有 ring-2 ring-offset-2 ring-primary 标识
- **Verification**: `human-judgment`

### AC-4: 标签徽章组件颜色
- **Given**: TagBadge 组件接收带有 color 的 tag 对象
- **When**: 渲染徽章
- **Then**: 徽章背景色和文字色与 tag.color 对应，深色模式下使用 900/300 色系
- **Verification**: `human-judgment`

### AC-5: 标签管理页颜色选择
- **Given**: 用户打开标签管理页
- **When**: 点击"新建标签"或编辑现有标签
- **Then**: 对话框中有颜色选择器，选择后保存更新数据库
- **Verification**: `human-judgment`

### AC-6: 卡片标签显示
- **Given**: 阅读库、笔记、任务、经验列表页
- **When**: 卡片带有标签
- **Then**: 标签以彩色 TagBadge (size="sm") 显示
- **Verification**: `human-judgment`

### AC-7: Mock 数据颜色
- **Given**: NEXT_PUBLIC_MOCK_BACKEND=true
- **When**: 查看 mock 模式下的标签
- **Then**: 不同标签有不同颜色（技术=blue, 产品=orange, 阅读=green, 灵感=purple 等）
- **Verification**: `human-judgment`

### AC-8: TypeScript 零错误
- **Given**: 所有代码改动完成
- **When**: 运行 `cd apps/web && npx tsc --noEmit`
- **Then**: 退出码为 0，无类型错误
- **Verification**: `programmatic`

### AC-9: 深色模式适配
- **Given**: 系统切换到深色模式
- **When**: 查看各页面标签
- **Then**: 标签颜色在深色背景下清晰可辨
- **Verification**: `human-judgment`

## Open Questions
- 无（需求明确）
