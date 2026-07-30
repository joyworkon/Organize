# AGENTS.md

This file provides guidance to Lingma (lingma.aliyun.com) when working with code in this repository.

## 项目概览

Organize 是一个跨平台的"稍后读 + 笔记"工具（Notion + Cubox 混合形态）：用户保存网页链接，系统抓取正文进入阅读库（未读 / 在读 / 已读三态），并可在 Notion 风格的富文本编辑器中做笔记。

- 技术底座：pnpm@9.10.0 + Turborepo 的 monorepo，Node >= 18.17.0
- 主产品是 `apps/web`（Next.js 14 App Router + React 18 + TypeScript）
- 后端为 Supabase（Postgres + Auth + Storage），本地通过 Docker 运行

## 常用命令

包管理器统一用 pnpm（不要用 npm / yarn 安装依赖）。

```bash
# 根目录（经 turbo 编排所有子包）
pnpm dev        # 启动开发
pnpm build      # 构建
pnpm lint       # 代码检查
pnpm clean      # 清理

# 只操作 web 子包
pnpm --filter @organize/web dev
pnpm --filter @organize/web build

# 类型检查（改动后用这个验证）
cd apps/web && npx tsc --noEmit

# 单元测试（Vitest；现有用例在 apps/web/components/editor/）
cd apps/web && pnpm test          # 等价: npx vitest run
```

Supabase 本地后端（需要 Docker）：

```bash
supabase start              # 拉起本地后端（Postgres / Auth / Storage / Studio）
supabase migration up       # 应用 supabase/migrations 下的新迁移
supabase status -o json     # 查看本地服务地址与 JWT 格式的 anon key
```

- 本地服务端口：API `http://127.0.0.1:54321`，Studio `http://127.0.0.1:54323`
- Web 环境变量在 `apps/web/.env.local`：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 协作与分支

`master` 是受保护分支（2026-07-27 起启用）。**禁止直接 push 到 master**，也禁止 force push 和删除该分支；连仓库 owner 也受此规则约束。

所有改动必须走特性分支 + Pull Request：

```bash
git checkout -b feat/<短描述>     # 建特性分支（命名: feat/ fix/ docs/ chore/ 前缀）
# 改代码, 提交
git push -u origin feat/<短描述>  # 推特性分支
gh pr create                      # 开 PR
gh pr merge --squash              # 合并（单人项目可自开自合, 无需他人审批）
```

- **单人项目友好**：审批人数设为 0，可以自己开 PR 自己合，不阻塞。
- **CI 门禁**：`.github/workflows/ci.yml` 会在每个 PR 上自动跑 `tsc --noEmit` + `vitest run`（与本地验证命令一致），检查不过不要合并；本地提前跑一遍可少一轮往返。
- **Squash merge**：一个特性分支合并后会压成 master 上的一个提交，保持历史线性；合并完成后删除本地与远程特性分支，不留残枝。
- **历史例外**：早期历史（截至 PR #3）存在批量普通合并（merge/agent-batch，内部嵌套二级 merge），这些不是单提交结构——回滚该区间的改动要用 `git revert -m 1 <merge-commit>`，不能按"一分支一提交"预期直接 revert。PR #4 起全部为 squash 合并。

### 开始新工作前：必须先同步

master 会随时被其他 Agent / 协作者通过 PR 更新。**本地 master 经常是旧的**，直接基于旧 master 建分支会导致：缺最新改动、或合并时冲突。每次开始新任务前，固定执行：

```bash
git checkout master
git pull origin master          # 拉远程最新到本地
git checkout -b feat/<短描述>   # 基于最新 master 建新分支
```

- 手上有未提交的改动时，先 `git stash` 或先提交到当前特性分支，再切回 master 同步。
- **一次只在一条特性分支上工作**，不要同时开多条分支，避免改了半天发现基线错了。
- 改完 → push → 开 PR → 合并 → 删特性分支 → 切回 master 拉最新，再开始下一个任务。

## 架构

### Monorepo 布局
- `apps/web` — Next.js 14 主应用（目前唯一已实现的 app）
- `packages/shared` — 跨包共享的 TS 类型（ReadingItem / Note / Tag / ScrapeResult / ReadingStatus 等）
- `packages/plugin-sdk` — 插件 SDK：`definePlugin()`、`PluginContext`、扩展点类型定义
- `packages/plugins/*` — 内置插件（`ai-summary` AI 摘要、`tag-suggest` 标签推荐）
- `desktop/` — Tauri 桌面端骨架；`mobile/` — Capacitor 移动端骨架（均未完整实现）
- `supabase/` — 后端 `config.toml` 与 `migrations/`（当前 001–024；除基础表外已覆盖评论/建议、标签、分享、版本、任务/课程、收藏、阅读生命周期、备份恢复、软删除和笔记页面层级）

`apps/web` 通过 `next.config.mjs` 的 `transpilePackages` 直接编译 workspace 包源码（packages 不预构建）。

### 后端（Supabase）
- 核心表（001）：`reading_items`（阅读条目）、`notes`（笔记，content 为 jsonb）、`tags`、`item_tags`（多对多）、`plugins`（插件配置）
- 后续迁移新增的表：`note_comment_threads` / `note_comments` / `note_suggestions`（004 笔记评论与建议）、`note_tags`（005 笔记-标签）、`shares`（006 分享）、`note_versions`（010 笔记历史版本）、`tasks` / `lessons` / `task_tags` / `lesson_tags`（012 任务与课程）、`task_checklists`（013 任务清单）、`highlights`（014 高亮）、`favorites`（016 收藏）
- 018–024 继续加固公开分享、阅读生命周期、备份恢复、软删除及子资源可见性，并为笔记增加 `icon`、`cover_url`、`cover_position`、`parent_note_id` 和相关备份恢复逻辑
- 所有表启用 RLS（按 `auth.uid() = user_id` 行级隔离）；此外**每张新表都必须**额外 GRANT 表级权限（003 覆盖初始表，004+ 各自迁移内 GRANT），否则写入报 `permission denied for table`
- `reading_items.reading_status` 为三态枚举：`unread` / `reading` / `read`

### 阅读链路
收集箱（`app/(main)/inbox`）粘贴 URL → `POST /api/scrape` 抓取正文（`lib/scraper/index.ts`，用 @mozilla/readability + cheerio + jsdom）→ 写入 `reading_items` → 阅读库（`app/(main)/library`）展示与状态流转 → 详情页 `library/[id]` 按滚动进度更新 reading_progress / status。
`/api/scrape` 带内存缓存（ISR 风格，支持 `force` 参数强制刷新）。

### 笔记编辑器
`components/editor/tiptap-editor.tsx` 是 Notion 风格编辑器：无边框、无顶部工具栏，选中文字弹出 BubbleMenu（文本格式 + 块类型二级菜单 + 插入菜单 + 表情选择器 + 更多菜单）。
自定义 TipTap 扩展在 `components/editor/extensions/`：`callout.ts`（标注）、`math.tsx`（KaTeX 行内 / 区块公式）、`columns.ts`（CSS Grid 列布局）、`table-style.ts`（表格宽度/边框/配色持久化）；折叠列表用官方 details 三件套。编辑器排版样式集中在 `app/globals.css` 的 `.organize-editor` 作用域下。

### 插件系统
- 插件用 `definePlugin()` 声明，提供扩展点：`toolbar-action` / `sidebar-panel` / `content-processor`（抓取后处理）/ `ai-action`
- `lib/plugin/loader.tsx` 动态 import 内置插件并激活；`lib/plugin/store.ts`（zustand）管理注册 / 激活状态；配置持久化到 `plugins` 表
- `PluginLoader` 启动时读取 `/api/plugins`，`getConfig` 返回当前配置，`setConfig` 通过 `PATCH /api/plugins/[id]` 持久化；修改这里时要同时覆盖初始化失败、未启用插件和保存失败

### 认证与路由
Supabase Auth（邮箱）。`middleware.ts` 保护 `(main)` 路由组，未登录重定向到 `(auth)/login`；`app/auth/callback` 处理回调。Supabase 客户端封装在 `lib/supabase/client.ts`（浏览器）与 `lib/supabase/server.ts`（服务端，@supabase/ssr）。

### 离线
`public/sw.js` Service Worker（页面缓存 + 离线回退）+ `lib/offline/queue.ts`（离线操作队列）。

## 关键约定与陷阱

- **pnpm 严格模式**：`@tiptap/core` 必须是 `apps/web` 的直接依赖，否则 `tsc` 报 `Cannot find module '@tiptap/core'`，且自定义扩展的命令类型增强（如 `toggleCallout`）失效。
- **Supabase 权限**：RLS 只管行级，必须额外 GRANT 表级权限给 anon / authenticated，否则一切写入报 `permission denied`。
- **Supabase key 格式**：`@supabase/ssr@0.5.2` 只认 JWT 格式 anon key（`eyJ...`，从 `supabase status -o json` 取），不支持新版 `sb_publishable_` 格式。
- **微信文章抓取**：正文在带 `visibility:hidden` 的 `#js_content` 容器，Readability 会跳过；`lib/scraper/index.ts` 的 `parseWechat` 专用解析器处理它（并把图片 `data-src` 还原为 `src`）。
- **React 副作用分离**：数据库写入等副作用不得放在 `setState` 更新器（reducer）内部，必须置于 `useEffect` 或事件处理器中，避免状态与持久化不一致。
