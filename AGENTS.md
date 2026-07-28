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

## 架构

### Monorepo 布局
- `apps/web` — Next.js 14 主应用（目前唯一已实现的 app）
- `packages/shared` — 跨包共享的 TS 类型（ReadingItem / Note / Tag / ScrapeResult / ReadingStatus 等）
- `packages/plugin-sdk` — 插件 SDK：`definePlugin()`、`PluginContext`、扩展点类型定义
- `packages/plugins/*` — 内置插件（`ai-summary` AI 摘要、`tag-suggest` 标签推荐）
- `desktop/` — Tauri 桌面端骨架；`mobile/` — Capacitor 移动端骨架（均未完整实现）
- `supabase/` — 后端 `config.toml` 与 `migrations/`（001 建表 + RLS、002 存储桶、003 GRANT 权限）

`apps/web` 通过 `next.config.mjs` 的 `transpilePackages` 直接编译 workspace 包源码（packages 不预构建）。

### 后端（Supabase）
- 表：`reading_items`（阅读条目）、`notes`（笔记，content 为 jsonb）、`tags`、`item_tags`（多对多）、`plugins`（插件配置）
- 所有表启用 RLS（按 `auth.uid() = user_id` 行级隔离）；此外还必须 GRANT 表级权限（见 003 迁移），否则写入报 `permission denied for table`
- `reading_items.reading_status` 为三态枚举：`unread` / `reading` / `read`

### 阅读链路
收集箱（`app/(main)/inbox`）粘贴 URL → `POST /api/scrape` 抓取正文（`lib/scraper/index.ts`，用 @mozilla/readability + cheerio + jsdom）→ 写入 `reading_items` → 阅读库（`app/(main)/library`）展示与状态流转 → 详情页 `library/[id]` 按滚动进度更新 reading_progress / status。
`/api/scrape` 带内存缓存（ISR 风格，支持 `force` 参数强制刷新）。

### 笔记编辑器
`components/editor/tiptap-editor.tsx` 是 Notion 风格编辑器：无边框、无顶部工具栏，选中文字弹出 BubbleMenu（文本格式 + 块类型二级菜单 + 插入菜单 + 表情选择器 + 更多菜单）。
自定义 TipTap 扩展在 `components/editor/extensions/`：`callout.ts`（标注）、`math.tsx`（KaTeX 行内 / 区块公式）、`columns.ts`（CSS Grid 列布局）；折叠列表用官方 details 三件套。编辑器排版样式集中在 `app/globals.css` 的 `.organize-editor` 作用域下。

### 插件系统
- 插件用 `definePlugin()` 声明，提供扩展点：`toolbar-action` / `sidebar-panel` / `content-processor`（抓取后处理）/ `ai-action`
- `lib/plugin/loader.tsx` 动态 import 内置插件并激活；`lib/plugin/store.ts`（zustand）管理注册 / 激活状态；配置持久化到 `plugins` 表
- 注意：loader 里的 `getConfig` / `setConfig` 目前是 stub（返回空对象 / 空操作），插件配置尚未真正接通存储

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
