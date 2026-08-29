# Organize

跨平台的「稍后读 + 笔记」工具（Notion + Cubox 混合形态）：保存网页链接后自动抓取正文进入阅读库（未读 / 在读 / 已读），并可在 Notion 风格的富文本编辑器中做笔记、复盘与知识管理。

## 核心功能

- **稍后读**：粘贴 / 批量导入链接，自动抓取正文与封面；阅读进度、三态流转、智能排序、置顶
- **笔记**：Notion 风格编辑器——斜杠菜单、BubbleMenu、标注 / 公式 / 列布局 / 表格样式 / 可调图片 / 附件块；页面层级、图标封面、评论、建议、历史版本、块级跨笔记移动；Chrome 式标签页
- **任务与复盘**：待办工作台（任务 / 日历 / 倒数日 / 经验）、清单与依赖、到期提醒（Web Push）、任务完成自动进入复盘
- **知识组织**：标签（笔记 / 文章 / 任务 / 经验四处打通）、反向链接、图谱、收藏夹、全文搜索
- **多端与生态**：移动端（Capacitor，系统分享直达保存）、桌面端（Tauri 骨架）、插件系统（AI 摘要 / 标签推荐）
- **离线**：Service Worker 页面缓存 + 笔记 / 任务离线队列，联网自动回放

## 技术栈

pnpm@9.10.0 + Turborepo monorepo；`apps/web` 为 Next.js 14（App Router）+ React 18 + TypeScript + TipTap；后端 Supabase（Postgres + Auth + Storage，全表 RLS）。

```
apps/web            # 主应用（当前唯一已实现的 app）
packages/shared     # 跨包共享 TS 类型
packages/plugin-sdk # 插件 SDK（definePlugin / 扩展点）
packages/plugins/*  # 内置插件（ai-summary、tag-suggest）
desktop/            # Tauri 桌面端骨架
mobile/             # Capacitor 移动端
supabase/           # 迁移（001–054）与本地配置
```

## 快速开始

要求 Node >= 18.17.0，包管理统一用 pnpm（勿用 npm / yarn）。

```bash
pnpm install
pnpm dev        # 根目录启动（经 turbo 编排）
```

开发有两种后端模式：

- **mock 后端模式（推荐起步，无需 Docker）**：`apps/web/.env.local` 设 `NEXT_PUBLIC_MOCK_BACKEND=true` 即可用内存假数据驱动完整 UI——保存文章（样例正文）、笔记历史版本、块评论 / 建议、标签等链路均可离线开发。详见 `AGENTS.md` 的「mock 后端模式」一节。
- **真实 Supabase 本地后端**：

  ```bash
  supabase start           # 需 Docker；拉起 Postgres / Auth / Storage / Studio
  supabase migration up    # 应用 supabase/migrations
  supabase status -o json  # 取 API URL 与 JWT 格式 anon key 填入 .env.local
  ```

  `@supabase/ssr@0.5.2` 只认 JWT 格式 anon key（`eyJ...`），不支持 `sb_publishable_` 新格式。

## 常用命令

```bash
pnpm dev                          # 开发
pnpm build                        # 构建
pnpm --filter @organize/web dev   # 只启动 web 子包
cd apps/web && npx tsc --noEmit   # 类型检查（改动后验证）
cd apps/web && npx vitest run     # 单元测试
```

CI（`.github/workflows/ci.yml`）在每个 PR 上自动跑 `tsc --noEmit` + `vitest run`。`master` 为受保护分支，改动一律走特性分支 + PR（squash 合并），详见 `AGENTS.md` 的协作规范。

## 文档

面向协作 / Agent 的架构说明、约定与陷阱集中在 [AGENTS.md](./AGENTS.md)（架构分层、mock 模式覆盖范围、关键约定与常见坑）。
