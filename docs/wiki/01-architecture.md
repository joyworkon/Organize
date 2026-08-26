# 01 · 整体架构

## 1. 分层视图

```
┌──────────────────────────── 浏览器 ────────────────────────────┐
│  React 18 组件（App Router 页面）                                │
│    ├─ TipTap 编辑器（notes/[id]）                                │
│    ├─ Service Worker（public/sw.js：页面缓存 + Web Push）         │
│    └─ 离线队列（lib/offline：localStorage 持久化 + 回放）          │
├──────────────────────────────────────────────────────────────┤
│  Next.js 14（apps/web）                                          │
│    ├─ middleware.ts        鉴权（未登录 → /login）               │
│    ├─ app/(main)/*         受保护页面                             │
│    ├─ app/(auth)/login     登录页                                │
│    ├─ app/s/[token]        公开分享页（免登录）                    │
│    └─ app/api/*            Route Handlers（服务端逻辑）            │
├──────────────────────────────────────────────────────────────┤
│  Supabase（本地 Docker / 云端）                                   │
│    ├─ Postgres + RLS      全部业务表（44 个迁移）                  │
│    ├─ Auth（邮箱）         会话经 @supabase/ssr cookie 同步        │
│    ├─ Storage             images / attachments 两个 bucket       │
│    └─ Realtime            tasks 表 publication（032）            │
└──────────────────────────────────────────────────────────────┘
```

前端有两种数据访问方式，按场景混用：

1. **Supabase 客户端直读**（浏览器 → Postgres，RLS 按 `auth.uid() = user_id` 行级隔离）——列表页、看板等高频读取；
2. **API Route**（浏览器 → Next.js 服务端 → Supabase/外部网络）——抓取、上传、AI、分享、备份恢复、数据库块等需要服务端能力或密钥的操作。

## 2. Monorepo 依赖关系

```
apps/web (@organize/web)
   ├── @organize/shared         类型包（ReadingItem/Note/Task/Database 等，无运行时逻辑）
   ├── @organize/plugin-sdk     插件 SDK（definePlugin / PluginContext / 扩展点类型）
   ├── @organize/plugin-ai-summary   内置插件：AI 摘要
   └── @organize/plugin-tag-suggest  内置插件：标签推荐
        （两者均依赖 plugin-sdk 与 shared 的类型）
```

- `pnpm-workspace.yaml`：`apps/*`、`packages/*`、`packages/plugins/*`。
- `apps/web/next.config.mjs` 的 `transpilePackages` 直接编译 workspace 包源码，**packages 不需要预构建**。
- 根 `turbo.json` 编排 `dev / build / lint / test / typecheck / clean`。

## 3. 核心业务链路

### 3.1 阅读链路（稍后读）

```
library 页顶部 quick-add-bar 粘贴 URL
  → POST /api/scrape（lib/scraper：safeFetchHtml → parseHtml/parseWechat
     → Readability/cheerio 提取正文 → sanitizeContent 清洗）
  → 插件 content-processor 链（如 ai-summary 生成摘要）
  → upsert reading_items
  → library 列表（unread/reading/read 过滤 + 统计）
  → library/[id] 阅读页：滚动进度 → reading_progress / reading_status 流转
  → 高亮（highlights 表）/ 转笔记 / 收藏 / 标签
```

- `/api/scrape` 带内存缓存（ISR 风格），支持 `force` 参数强制刷新。
- 旧入口 `/inbox` 已 301 重定向到 `/library`（PR #118 合并收集箱与阅读库）。
- SSRF 防护：`lib/scraper/url-safety.ts` 校验协议、host、DNS 解析结果与 IP 黑名单。

### 3.2 笔记链路

```
notes 列表 → notes/[id] 编辑器（components/editor/tiptap-editor.tsx）
  → 内容 jsonb 存 notes.content（原子保存：038 迁移，含任务变更的走 031 RPC save_note_with_tasks）
  → 版本快照 note_versions（010，036 节流）
  → 评论 note_comment_threads/note_comments、建议 note_suggestions（004）
  → 页面层级 parent_note_id（023）、页面设置 full_width/font_family/small_font（025）
  → 内部链接状态（043）、反链（backlinks）、块级评论/搜索
```

### 3.3 任务链路

```
tasks 工作台（lib/tasks/workspace.ts 聚合查询）
  → tasks 表（012）+ task_lists/task_reminders/task_attachments/
    task_activities/task_templates（033）+ 层级子任务（040）+ 依赖（041）
  → 重复任务 recurrence_rule → lib/tasks/recurring.ts 生成下一期
  → 提醒：本地通知（lib/tasks/notifications.ts）+ Web Push（039，
    /api/cron/task-reminders 由外部 cron 触发，CRON_SECRET 保护）
  → 任务 ↔ 笔记双链（030 task_item_refs，笔记内 TaskItemLinked 扩展）
```

### 3.4 离线链路

- **Service Worker**（`public/sw.js`，缓存名 `organize-v3`）：安装时预缓存 `/`、`/library`、`/notes`、`/plugins`；fetch 采用**网络优先、失败回退缓存**；`/api/*` 不缓存。同时处理 Web Push 与通知点击跳转。
- **离线写队列**（`lib/offline/`，localStorage 持久化）：
  - `task-queue.ts`：任务 create/update 排队，离线新建用客户端 UUID；
  - `note-queue.ts`：笔记离线创建排队与幂等回放（`replayNoteCreates`）；
  - `note-sync.ts`：保存失败重试策略（指数退避，上限 10 次）。
- 明确**未实现** Background Sync API（SW 限制与 Chromium 限定），恢复在线时由页面层主动回放。

### 3.5 分享与公开访问

- `shares` 表（006）+ 018 加固（token、过期、公开开关）。
- `/s/[token]` 页面与 `/api/share/[token]` 免登录（middleware 白名单）。
- 服务端读取走 `lib/share/public-share.ts` 的 `getPublicShare`。

## 4. 认证与路由保护

- Supabase Auth（邮箱）。`middleware.ts` 用 `@supabase/ssr` 的 `createServerClient` 读写 cookie 并刷新会话；未登录访问 `(main)` 组一律重定向 `/login`，放行 `/login`、`/auth/*`、`/s/*`。
- `app/auth/callback/route.ts` 处理 Auth 回调 code 交换。
- 客户端封装：`lib/supabase/client.ts`（浏览器**单例**，避免重复创建导致死循环）、`lib/supabase/server.ts`（服务端，@supabase/ssr）。
- **Mock 模式**：`NEXT_PUBLIC_MOCK_BACKEND=true` 时 middleware 直接放行，`createClient()` 返回 `mock-client.ts`（内存数据驱动 UI，用于无后端开发；生产环境禁止开启）。

## 5. 插件架构

```
PluginBootstrap（components/plugin/plugin-bootstrap.tsx，(main)/layout 挂载）
  → lib/plugin/bootstrap.ts: bootstrapPlugins()
       读取 /api/plugins（plugins 表）→ 缺失的内置插件自动建记录
  → lib/plugin/loader.tsx: PluginLoader 动态 import 内置插件并激活
  → lib/plugin/store.ts: zustand 注册表（register/activate/deactivate）
  → 扩展点消费方：
       toolbar-action   阅读页/笔记块工具栏
       sidebar-panel    侧边栏面板
       content-processor /api/scrape 抓取后处理链
       ai-action        选中文本 AI 操作
```

- 插件配置持久化在 `plugins` 表（`config` jsonb），`getConfig`/`setConfig` 经 `PATCH /api/plugins/[id]`。
- 插件 SDK 见 `packages/plugin-sdk`：插件用 `definePlugin()` 声明，生命周期 `onInstall/onActivate/onDeactivate`。

## 6. 编辑器架构（TipTap）

`components/editor/tiptap-editor.tsx` 是核心：无边框、无顶部工具栏，交互入口为：

- **BubbleMenu**：选中文本弹出（文本格式 + 块类型二级菜单 + 插入菜单 + 表情 + 更多）；
- **Slash 命令**（`extensions/slash-command.ts` + `slash-trigger.ts`）；
- **块操作菜单**（`block-action-menu.tsx`）与块命令面板（`block-command-menu.tsx`，命令定义在 `block-commands.ts`）；
- **块多选**（`block-multi-select.ts` / `block-selection.ts`）。

自定义扩展集中在 `components/editor/extensions/`（详见 [02-modules.md](./02-modules.md) 与 [05-key-functions.md](./05-key-functions.md)）。编辑器排版样式集中在 `app/globals.css` 的 `.organize-editor` 作用域；阅读页排版用 `.reader-content` 体系。

## 7. 跨端骨架

- `desktop/`：Tauri（Rust）骨架，`src-tauri` 仅最小 `main.rs` 与配置，未完整实现。
- `mobile/`：Capacitor 骨架，仅 `capacitor.config.ts` 与 `package.json`。
两端均预期复用 `apps/web` 的前端产物。
