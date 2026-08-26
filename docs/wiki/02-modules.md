# 02 · 主要模块职责

## 1. 页面路由（apps/web/app）

### 路由组与公共页

| 路由 | 文件 | 职责 |
| --- | --- | --- |
| `/login` | `(auth)/login/page.tsx` | 邮箱登录（Supabase Auth） |
| `/auth/callback` | `auth/callback/route.ts` | Auth 回调 code 交换 |
| `/s/[token]` | `s/[token]/page.tsx` | 公开分享页（免登录，middleware 白名单） |
| `(main)/layout.tsx` | — | 受保护区布局：Sidebar、MobileTabBar、GlobalHotkeys、CommandPalette、QuickAdd、PluginBootstrap、Toaster、Onboarding |

### (main) 受保护页面

| 路由 | 职责 |
| --- | --- |
| `/` | Dashboard 聚合首页（`dashboard/dashboard-hub.tsx`） |
| `/library` | 阅读库：顶部 quick-add 快速收藏 + unread/reading/read 过滤（已合并原收集箱；`/inbox` 301 → `/library`） |
| `/library/[id]` | 阅读详情：正文排版（.reader-content）、滚动进度回写、高亮划线、目录 |
| `/notes` | 笔记列表（日期分组、搜索、标签筛选、批量操作） |
| `/notes/[id]` | 笔记编辑器页（TipTap；页面层级/图标/封面/设置/评论/历史） |
| `/tasks` | 任务工作台（清单/看板式列表、范围过滤、快速新增；`tasks/layout.tsx` 提供工作台上下文） |
| `/tasks/[id]` | 任务详情（子任务、清单、附件、提醒、依赖、动态、关联内容） |
| `/tasks/calendar` | 任务日历（月视图 `task-month-view.tsx`、拖拽改期） |
| `/tasks/countdown` | 倒数日（countdown_days） |
| `/tasks/search` | 任务搜索 |
| `/lessons`、`/lessons/[id]` | 经验总结（复盘/经验/灵感三型） |
| `/favorites` | 收藏夹（reading/note/task 三类目标） |
| `/graph` | 知识图谱（笔记双链图 + 任务依赖图，自研 force layout） |
| `/review` | 回顾视图（`dashboard/review-view.tsx`） |
| `/stats` | 统计视图（`dashboard/stats-view.tsx`，数据来自 `/api/stats`） |
| `/tags` | 标签管理（颜色、使用计数） |
| `/share` | 我的分享管理 |
| `/trash` | 回收站（软删除恢复/彻底删除） |
| `/plugins` | 插件管理（启用/配置） |
| `/settings` | 设置（主题色、备份导出/恢复、推送订阅等） |

## 2. 组件分组（apps/web/components）

| 目录/文件 | 职责 |
| --- | --- |
| `editor/` | 笔记编辑器全家桶：`tiptap-editor.tsx` 主组件、`block-action-menu.tsx` 块操作菜单、`block-command-menu.tsx` + `block-commands.ts` 斜杠/块命令、`block-utils.ts` 块查找/移动/快照、`note-search-dialog.tsx` 文内搜索（⌘F）、`presentation-mode.tsx` 演示模式、`table-controls.tsx` / `table-direct-controls.tsx` 表格操控、`note-attachments-panel.tsx` 附件面板、`editor-dialogs.tsx` / `editor-popover.tsx` 各类弹窗宿主 |
| `editor/extensions/` | 20+ 自定义 TipTap 扩展，见下表 |
| `layout/` | `sidebar.tsx` 侧边栏（含笔记树 SidebarNoteTree、待办）、`mobile-tab-bar.tsx`、`global-hotkeys.tsx` 全局快捷键、`theme-toggle.tsx`、`sw-registrar.tsx` SW 注册、`pointer-events-guard.tsx` 弹层残留修复 |
| `dashboard/` | `dashboard-hub.tsx` 首页聚合、`today-view.tsx`、`review-view.tsx`、`stats-view.tsx` |
| `reading/` | `reading-card.tsx`（+`reading-card-utils.ts`）、`quick-add-bar.tsx` 顶部快速收藏、`highlight-menu.tsx` / `highlights-panel.tsx` 高亮、`toc.tsx` 目录、`status-badge.tsx` |
| `notes/` | `note-card.tsx`、`note-child-pages.tsx`、`note-hierarchy-bar.tsx`、`note-page-menu.tsx` 页面菜单、`note-page-visuals.tsx` 图标/封面、`note-history-dialog.tsx` 版本历史、`note-page-comments.tsx`、`note-move-dialog.tsx`、`backlinks.tsx` 反链、`markdown-import-dialog.tsx` / `joyspace-import-dialog.tsx` 导入 |
| `tasks/` | `task-card.tsx`、`task-dialog.tsx` 编辑弹窗、`task-sidebar.tsx`（工作台侧栏）、`task-workspace-tabs.tsx`、`task-hierarchy.tsx` 子任务、`task-dependencies.tsx`、`task-reminders-editor.tsx`、`task-date-picker.tsx` / `task-date-popover.tsx`、`task-month-view.tsx` 月历、`task-templates-dialog.tsx`、`task-attachment-list.tsx` / `task-attachments-dialog.tsx`、`complete-task-dialog.tsx`（完成时复盘）、`task-linked-content.tsx`、`task-inline-detail.tsx`、`task-navigation-menu.tsx` |
| `database/` | 数据库块视图：`dynamic-view.tsx` 分发 + table/board/list/gallery/calendar/timeline/chart/admin 各视图；`view-shared/` 提供 filters/sorts/grouping/aggregation 纯函数（均有单测） |
| `tags/` | `tag-badge.tsx`、`tag-selector.tsx`、`tag-filter.tsx`、`tag-color-picker.tsx`、`auto-tag-dialog.tsx`、`use-tags.ts` |
| `share/` | `share-dialog.tsx`、`export-button.tsx`（Markdown/HTML/剪贴板导出） |
| `editor/`外的通用 | `command-palette.tsx` ⌘K 命令面板、`quick-add.tsx` 全局快速新增、`batch-actions-bar.tsx`、`favorite-button.tsx`、`onboarding.tsx`、`theme-color-picker.tsx` |
| `plugin/` | `plugin-bootstrap.tsx`（启动引导）、`plugin-container.tsx`（sidebar-panel 渲染宿主） |
| `ui/` | shadcn 风格基础组件（button/dialog/dropdown-menu/popover/select/toast/command/virtual-list 等） |
| `context-menu/` | 通用右键菜单列表 |
| `inbox/` | `batch-import-panel.tsx` 批量导入（历史遗留，随 inbox 合并保留复用） |

### TipTap 自定义扩展（components/editor/extensions）

| 扩展 | 职责 |
| --- | --- |
| `callout.tsx` | 标注块（emoji + 配色） |
| `math.tsx` | KaTeX 行内/区块公式 |
| `columns.tsx` | CSS Grid 多列布局 |
| `table-style.ts` / `table-view.tsx` | 表格宽度/边框/配色/单元格背景持久化（`OrganizeTable*` 系列节点） |
| `resizable-image.tsx` | 图片宽度拖拽手柄 |
| `file-attachment.tsx` | 附件块（视频/音频内联播放，其余文件卡片） |
| `html-embed.tsx` / `embed.tsx` | HTML 嵌入与 oEmbed 链接卡片/嵌入 |
| `mermaid-node.tsx` / `mermaid.ts` | Mermaid 图表块 |
| `tabs-node.tsx` / `tabs.ts` | 选项卡块 |
| `button-node.tsx` / `button-block.ts` | 按钮块 |
| `table-of-contents.tsx` / `toc.ts` | 目录块 |
| `breadcrumb.tsx` | 面包屑块 |
| `synced-block.tsx` / `synced-block-client.ts` | 同步块（跨页面内容同步，027 迁移） |
| `database-block.tsx` / `database-block-client.ts` | 数据库块（行内/页面/关联三种插入方式） |
| `task-item-linked.ts` | 与 tasks 表双链的待办项（勾选互相同步） |
| `slash-command.ts` / `slash-trigger.ts` | 斜杠命令 |
| `block-multi-select.ts` / `block-selection.ts` | 块多选与变换选区 |
| `block-style.ts` / `list-style.ts` | 块级样式、列表样式 |
| `list-backspace.ts` | 列表退格行为修复 |
| `deep-link.ts` | 块级深链（复制块链接） |
| `internal-link-state.ts` | 内部链接 active/deleted/missing 状态装饰 |
| 官方 details 三件套 | 折叠列表 |

## 3. 领域逻辑（apps/web/lib）

| 目录/文件 | 职责 |
| --- | --- |
| `scraper/` | 网页抓取：`index.ts` 主编排（含微信 `parseWechat`）、`safe-fetch.ts` 安全抓取、`url-safety.ts` SSRF 防护 |
| `supabase/` | `client.ts` 浏览器单例、`server.ts` 服务端、`mock-client.ts` + `mock-data.ts` 假后端 |
| `plugin/` | `bootstrap.ts` 启动编排、`loader.tsx` 动态加载激活、`store.ts` zustand 注册表 |
| `offline/` | `task-queue.ts` / `note-queue.ts` 离线写队列、`note-sync.ts` 保存重试策略、`network.ts` 在线状态 |
| `tasks/` | 任务域纯函数与数据访问：`repository.ts`、`workspace.ts`、`recurring.ts` / `recurrence.ts`、`reminders.ts` / `notifications.ts`、`templates.ts`、`attachments.ts`、`reorder.ts`、`reschedule.ts`、`countdown.ts`、`dependencies.ts`、`note-prefill.ts` |
| `notes/` | `tree.ts` 页面层级树、`local-draft.ts` 本地草稿、`search-match.ts` 文内搜索匹配 |
| `graph/` | `build-graph.ts` 图谱数据构建、`force-layout.ts` 自研力导向布局（无第三方依赖） |
| `export/` | `tiptap-to-md.ts`、`tiptap-to-html.ts`、`clipboard.ts` 富文本复制 |
| `import/` | `markdown-to-tiptap.ts`（marked 解析 → PM 文档） |
| `backup/` | `schema.ts` 备份格式（V2/V3、限额、校验）、`restore.ts` 恢复载荷准备 |
| `share/` | `public-share.ts` 公开分享服务端读取 |
| `trash/` | `client.ts` 回收站 API 封装、`contracts.ts` 资源/动作契约 |
| `inbox/` | `batch-import.ts` 批量 URL 导入状态机 |
| `oembed/` | oEmbed 解析（`index.ts` + `providers.ts`） |
| `sanitize/` | `sanitize-html.ts` 抓取正文白名单清洗 |
| `ai/` | `server.ts` AI 网关（askAI/转写/总结）、`tag-generator.ts` 标签生成器（关键词/AI 双实现） |
| `reading/` | `highlight-references.ts` 高亮引用状态 |
| 根级工具 | `utils.ts`(cn)、`date-utils.ts`、`date-groups.ts`、`reading-time.ts`、`reading-images.ts`、`note-links.ts`、`task-link.ts`、`tiptap-utils.ts`、`api/error.ts`、`hooks/use-hotkey.ts` |

> 约定：`lib/**` 以纯函数为主，配套 `*.test.ts` 单测；React 副作用不放入 setState 更新器。

## 4. Hooks（apps/web/hooks）

`use-toast.ts`（toast）、`use-debounced-value.ts`、`use-selection.ts`（多选）、`use-theme-color.ts`、`use-notifications.ts`。

## 5. Packages

| 包 | 职责 |
| --- | --- |
| `@organize/shared` | 全部跨端 TS 类型与展示常量：`ReadingItem`/`Note`/`Task`/`Lesson`/`Tag`/`Highlight`/`Favorite`/`Share`/`Database`/`DatabaseRow` 等，及 `READING_STATUS_CONFIG`、`TASK_*_CONFIG`、`LESSON_TYPE_CONFIG` 等 label/color 映射 |
| `@organize/plugin-sdk` | `definePlugin()`、`OrganizePlugin`、`PluginContext`（userId/getCurrentItem/getConfig/setConfig/notify/getCurrentNote/getCurrentBlock）、四类扩展点类型、`PluginConfigField` |
| `@organize/plugin-ai-summary` | 内置插件：content-processor（抓取后生成摘要写入 excerpt）+ ai-action（总结选中文本），调 `/api/ai/ask` |
| `@organize/plugin-tag-suggest` | 内置插件：基于词频的关键词提取（含中英文停用词表），content-processor + toolbar-action |

## 6. 后端与脚本

- `supabase/config.toml`：本地 Supabase 项目配置；`supabase/migrations/`：001–044 增量迁移（见 [03-database.md](./03-database.md)）。
- `start.command`：macOS 双击一键启动（Docker → Supabase → .env.local → pnpm dev → 开浏览器）。
- `.github/workflows/ci.yml`：PR/master 上跑 typecheck + vitest + next build，独立 job 跑 pgTAP 数据库测试。
- `.tmp-e2e/`：未入库的 Playwright E2E 脚本（离线同步、图谱、块间距等验收用）。

## 7. 文档

`docs/`：`organize-roadmap-and-agent-tasks.md` 路线图、`notion-features-implementation-plan.md`、`note-page-next-agent-plan.md`、`g0-protocol.md`、`adr/0001-task-note-bidirectional-link.md`（任务-笔记双链 ADR）。根目录另有 `PROGRESS.md`、`BLOCKED.md` 进度记录。
