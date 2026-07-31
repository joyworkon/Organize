# Notion 区块菜单功能实现规划（交接文档）

> 编写日期：2026-07-31
>
> 参考依据：用户提供的 Notion「/」区块菜单截图（数据库 / 高级区块 / 嵌入 三个分组）。
> 本文档是**规划文档，不是已完成的实现**：逐项列出截图中的功能，对照本仓库现状，
> 给出分阶段实施计划，供后续 Agent 按里程碑接续开发。

## 0. 给接手 Agent 的重要说明

- **开始任何任务前，先同步 master 再开特性分支**（流程见根目录 `AGENTS.md`「协作与分支」：
  `git checkout master && git pull origin master && git checkout -b feat/<短描述>`），禁止直接 push 到 master。
- 验证命令（与 CI 一致，提交前必跑）：
  - `cd apps/web && npx tsc --noEmit`
  - `cd apps/web && pnpm test`（即 `npx vitest run`）
- 包管理器只用 pnpm；不要引入未经确认的新依赖（先查 `apps/web/package.json` 与相邻代码是否已有同类能力）。
- 数据库改动：
  - 迁移文件放 `supabase/migrations/`，当前已用到 **026**（`026_attachments_bucket.sql`），新迁移从 **027** 起编号；
  - 每张新表必须同时做 RLS **和** GRANT 表级权限（参照 004+ 各迁移），否则写入报 `permission denied for table`；
  - 新表要同步纳入备份/恢复：`apps/web/lib/backup/schema.ts`、`apps/web/lib/backup/restore.ts`，并补迁移一致性测试（参照 `lib/notes/page-backup-migration.test.ts` 的写法）。
- 编辑器改动：
  - TipTap 自定义扩展放 `apps/web/components/editor/extensions/`（参照 `callout.tsx` / `math.tsx` / `html-embed.tsx` 的写法：Node + React NodeView）；
  - 新块类型注册点：`tiptap-editor.tsx` 的 `extensions` 列表、`block-utils.ts` 的 `BLOCK_ID_TYPES`（块 id，用于评论/菜单定位）、`block-commands.ts` 的 `BLOCK_COMMANDS`（⌘/ 与斜杠菜单）；
  - 编辑器样式集中在 `apps/web/app/globals.css` 的 `.organize-editor` 作用域；
  - 笔记内容以 TipTap JSON 存在 `notes.content`（jsonb），**新块类型只要 schema 稳定即可向后兼容**，不要改已有节点的 attrs 语义。
- 每个里程碑独立成 PR（或按功能点拆 PR），不要一次性 giant commit。

## 1. 功能总览与现状对照

### 1.1 数据库分组（截图上部）

| 功能 | Notion 行为 | 本仓库现状 | 阶段 |
| --- | --- | --- | --- |
| 数据库 - 行内 | 在笔记内联创建一个数据库 | ❌ 无数据库内核 | M3 |
| 数据库 - 整页 | 创建整页数据库（子页面形态） | ❌ | M3 |
| 表格视图 | 行列网格，属性可编辑 | ❌ | M3（首个视图） |
| 看板视图 | 按单选属性分栏拖拽 | ❌ | M4 |
| 列表视图 | 极简行列表 | ❌ | M4 |
| 画廊视图 | 卡片网格（封面图） | ❌ | M4 |
| 日历视图 | 按日期属性落格 | ❌ | M4 |
| 时间轴视图 | 甘特式日期区间条 | ❌ | M4 |
| 链接的视图 | 在别处嵌入同一数据库的另一个视图 | ❌ | M4 |
| 动态视图 | 按更新时间倒序的动态流 | ❌ | M5 |
| 管理面板视图 | 指标卡 + 图表聚合面板 | ❌ | M5 |
| 地图视图 | 按地点属性上图钉 | ❌ | M5 |
| 垂直/水平条形图、折线图、环状图、数据图表 | 对数据库做聚合可视化 | ❌ | M5 |

> 截图中「地图视图」「垂直条形图」「折叠标题」「AI 速记」各出现两次，按 Notion 菜单实际语义视为同一功能的重复展示，规划只列一份。

### 1.2 高级区块分组（截图中部）

| 功能 | Notion 行为 | 本仓库现状 | 阶段 |
| --- | --- | --- | --- |
| 公式区块 | LaTeX 独立公式块 | ✅ 已实现（`extensions/math.tsx` 的 MathBlock） | — |
| 折叠标题 1/2/3 | 可折叠的 H1/H2/H3 | 🟡 部分实现：details 三件套 + `DetailsSummary` 的 `data-level` 已有折叠标题样式，缺菜单里的独立入口与交互对齐 | M1 |
| 目录 | 自动列出当前页标题大纲，点击跳转 | ❌ | M1 |
| 路径栏 | 显示当前页的父级路径面包屑 | 🟡 页面级已有 `note-hierarchy-bar.tsx`（编辑器外），缺编辑器内区块 | M1 |
| 按钮 | 点击执行动作（插入模板/打开链接） | ❌ | M1 |
| 选项卡 | Tab 容器，多页签切换内容 | ❌ | M1 |
| 同步区块 | 一处编辑、多处同步的引用块 | ❌ | M2 |
| AI 速记 | 会议录音/速记转写块 | ❌（插件体系有 `ai-action` 扩展点可借力） | M5 |
| 代码 - Mermaid | Mermaid 代码实时渲染图表 | ❌ | M1 |

### 1.3 嵌入分组（截图底部）

| 功能 | Notion 行为 | 本仓库现状 | 阶段 |
| --- | --- | --- | --- |
| HTML | 自定义 HTML 片段嵌入 | ✅ 已实现（`extensions/html-embed.tsx`） | — |
| 嵌入 | 粘贴 URL 生成富预览（视频/地图/社媒 oEmbed） | ❌ | M1 |

---

## 2. 阶段一（M1）：编辑器高级区块（纯前端，最快见效）✅ 已完成（PR #29）

目标：不依赖新后端表，全部以 TipTap 节点实现，充实「/」菜单。

### 2.1 目录（TOC）

- 新扩展 `extensions/toc.tsx`：`toc` 块（atom 外观但非 atom——内容随文档计算）。
- NodeView 每次渲染时遍历 `editor.state.doc` 收集 `heading`（level 1–3，忽略 details 内 summary），生成带缩进的锚点列表；点击项 → `focusAndHighlightBlock(editor, blockId)`（`extensions/block-selection.ts` 已有此工具，复用）。
- 用 `editor.on("transaction")` 或 NodeView 的 `update()` 触发重算；空目录显示占位文案。
- 无自有 attrs（可存 `levels: [1,2,3]` 供后续配置）。

### 2.2 折叠标题 1/2/3（补完）

- 现状：`details` + `DetailsSummary` 已支持 `data-level`（>0 时按标题字号渲染）。
- 补齐：
  1. `block-commands.ts` 增加三个命令「折叠标题 1/2/3」：插入 details 并设置 summary 的 `level`（参考已有 columns/details 命令的写法）；
  2. 块转换菜单（`block-action-menu.tsx`）允许在普通标题 ↔ 折叠标题间转换（setDetails / unsetDetails 已有命令，补 level 传递）；
  3. 验收：折叠态下子内容隐藏，summary 字号与对应 heading 一致。

### 2.3 路径栏（Breadcrumb 区块）

- 新扩展 `extensions/breadcrumb.tsx`：atom 块，NodeView 根据当前 `noteId` 拉取/接收父级链渲染 `父页 / 子页 / 当前页`。
- 数据：编辑器已有 `noteId` prop；父级链查询逻辑参照 `note-hierarchy-bar.tsx`（从 notes 表沿 `parent_note_id` 上溯）。把上溯逻辑抽成 `lib/notes/breadcrumb.ts` 供两处复用。
- 每级渲染为站内链接（`/notes/<id>`），点击跳转——编辑器内链接点击跳转已实现（handleClickOn 内联 `router.push`），NodeView 内直接用 `<a>` + onClick 调 router 即可。

### 2.4 按钮（Button）

- 新扩展 `extensions/button.tsx`：`buttonBlock`，attrs：`label`、`action`（`"insert-template" | "open-url"`）、`payload`（模板 JSON / URL）。
- M1 先做两个动作：打开链接、插入预设块模板（点击时在按钮块后插入 payload 里的块数组）。Notion 的「编辑按钮」配置弹窗用 `editor-dialogs.tsx` 的模式新增一个 dialog。
- ⚠️ 安全：`open-url` 只允许 `https?://` 与站内 `/` 路径，渲染前校验，防 `javascript:` 注入。

### 2.5 选项卡（Tabs）

- 新扩展 `extensions/tabs.tsx`：`tabs`（容器，attrs: `activeIndex`）> `tab`（attrs: `title`，content: block+）。
- NodeView 渲染页签条 + 当前页签的内容洞；切换页签只是 UI 状态（写回 `activeIndex` attr 以便持久化）；`+` 按钮新增 tab，页签上可重命名/删除（最少实现：新增/切换/重命名）。
- 注意与块手柄/多选的交互：tab 内容仍在同一文档内，块 id 由 UniqueID 覆盖即可。

### 2.6 代码 - Mermaid

- 新扩展 `extensions/mermaid.tsx`：atom 块，attrs: `code`；NodeView 内 `mermaid.render()` 异步出 SVG。
- 依赖：需新增 `mermaid` 包（先在 `apps/web` 查依赖；安装必须 `pnpm --filter @organize/web add mermaid`，动态 `import()` 按需加载避免首屏体积）。
- 编辑体验：点击块弹出 textarea 编辑源码（参照 `math.tsx` 的点击编辑模式）；渲染失败显示源码 + 错误行。

### 2.7 通用嵌入（Embed / oEmbed 预览）

- 新扩展 `extensions/embed.tsx`：attrs: `url`、`provider`、`html`（缓存的 embed HTML）。
- 后端新增 `app/api/oembed/route.ts`：入参 url → 先尝试 noembed.com 或目标站 oEmbed 端点（服务端转发，避免 CORS），失败回退为「链接卡片」（抓 `<title>`/OG 标签，可复用 `lib/scraper` 的 cheerio 能力）；带内存缓存（参照 `/api/scrape`）。
- 白名单驱动：YouTube/Bilibili/腾讯视频/地图/推特等常见 provider 用官方 iframe 模板；其余回退链接卡片。⚠️ embed HTML 必须 sanitize（不允许 script），渲染用 sandboxed iframe。

**M1 验收**（已完成 PR #29）：⌘/ 菜单出现全部新块；tsc + vitest 通过；每种新块各补单测（逻辑 + 属性持久化）。实测：tsc 0 错误，vitest 37 文件 / 292 用例全绿（含 44 个新增）。

## 3. 阶段二（M2）：同步区块

- 数据模型：新表 `synced_blocks`（`id`、`user_id`、`content` jsonb、`updated_at`），迁移 027 起；RLS + GRANT；纳入备份。
- 编辑器：`syncedBlock` 容器块（attrs: `syncedId`）。同一 `syncedId` 的所有实例共享 `synced_blocks.content`。
- 同步策略（取简单可靠者）：编辑任一实例 → 防抖写 `synced_blocks.content`；打开页面时按 `syncedId` 拉最新内容覆盖本地实例；同页多实例用编辑器内广播即时同步。
- 原区块 vs 引用：Notion 区分「原始块」，M2 不做原始块标记，所有实例等价。
- 验收：两个页面各放一个同 id 同步块，A 页编辑 → B 页重新打开后内容一致。

## 4. 阶段三（M3）：数据库内核 + 表格视图

这是最大的一块，务必独立 PR 串推进，顺序：数据模型 → API → 只读表格 → 可编辑。

### 4.1 数据模型（迁移 028 起）

- `db_databases`：`id`、`user_id`、`parent_note_id`（整页数据库挂在笔记树下；行内数据库则在笔记 content 里只存 `databaseId`）、`title`、`icon`、`schema` jsonb（属性定义：`[{id, name, type: text|number|select|multi_select|date|checkbox|url|file|relation, options?}]`）、`created_at`、`updated_at`、`deleted_at`（软删除对齐现有约定）。
- `db_rows`：`id`、`user_id`、`database_id`、`sort`（手动排序）、`values` jsonb（`{propertyId: value}`）、`created_at`、`updated_at`、`deleted_at`。
- 视图配置：`db_databases.views` jsonb 数组（`[{id, type: table|board|..., config: {filters, sorts, groupBy, hiddenProps, cardSize...}}]`）——**视图只是同一份行数据的不同投影**，这是 Notion 数据库的核心设计，后面所有视图共享该模型。
- RLS（`auth.uid() = user_id`）+ GRANT + 备份/恢复 + 迁移测试，一个都不能少（见 §0）。

### 4.2 编辑器接入

- 新块 `databaseBlock`（atom，attrs: `databaseId`、`viewId`）。行内数据库：插入块时 POST 创建数据库再插入块；整页数据库：创建 `parent_note_id` 数据库 + 子笔记页，页内自动放一个 databaseBlock（或整页路由 `/database/[id]`，二选一——建议复用笔记页 + databaseBlock，少一条路由）。
- NodeView 按 `viewId` 找到视图配置，分派到对应视图组件（`components/database/` 新目录）。

### 4.3 表格视图（首个视图）

- `components/database/table-view.tsx`：自绘网格（不要用编辑器内表格，那是文档表格不是数据库）；列 = 属性，行 = db_rows。
- M3 范围：text/number/select/checkbox/date 五种属性的查看与编辑、加行、加列（新属性）、改列名/类型、行删除、列宽拖拽。
- 排序/筛选 UI 可放 M4 与看板一起做，但 `views.config` 结构先预留。

**M3 验收**：行内创建数据库 → 录入 3 行 → 刷新后数据仍在；整页数据库出现在侧边栏笔记树（parent_note_id 已支持层级）；软删除进回收站可见可恢复。

## 5. 阶段四（M4）：核心视图族 + 链接的视图

共用 `components/database/view-shared/`：筛选/排序求值器（对 `values` 纯函数计算，**必须单测**）、属性渲染器、菜单组件。

- 看板视图：按 select 属性分组（`views.config.groupBy`），卡片列内/跨列拖拽（写回 `sort` 与分组值；拖拽实现可参照 `app/(main)/tasks/page.tsx` 的 HTML5 DnD 模式）。
- 列表视图：单行标题 + 副属性列的紧凑列表，最简。
- 画廊视图：卡片网格，封面取 file 属性或首图；`cardSize` 进 config。
- 日历视图：按月网格，日期属性落格；自绘（不引日历库）即可，跨月导航。
- 时间轴视图：开始/结束两个日期属性画横条，M4 只做只读 + 点击编辑弹层，拖拽改期放 M5。
- 链接的视图：插入 `databaseBlock` 时允许选择「已有数据库」+ 新建一个视图（新 viewId 指向同一 databaseId）——数据模型已天然支持，此功能 = 选择器 UI + 视图复制。

## 6. 阶段五（M5）：图表、高级视图与 AI 速记

- 图表（垂直/水平条形图、折线图、环状图、数据图表）：`components/database/chart-view.tsx`，聚合求值器（groupBy + count/sum/avg，纯函数 + 单测）；渲染先用 SVG 自绘（量级小、无依赖），确实不够再评估引库（recharts 等需先确认）。
- 地图视图：地点属性（`{lat, lng, label}`）+ 瓦片地图（Leaflet + OSM，注意评估国内可用性与依赖体积，放最后一档）。
- 动态视图：按 `updated_at` 倒序的行动态流（数据现成，纯 UI）。
- 管理面板视图：多个「指标卡 + 图表块」的自由布局面板——建议在图表求值器完成后做，复用其聚合结果。
- AI 速记：依赖音频采集与转写服务。先走插件体系（`@organize/plugin-sdk` 的 `ai-action`），做成可选插件而非内核功能；需要明确转写 API 来源（当前仓库无 AI 服务密钥约定，动工前需与维护者确认）。

## 7. 横切关注点

- **备份/恢复/导出**：每张新表进 `lib/backup/schema.ts`；新块类型进 `lib/export/clipboard.ts` 的纯文本回退逻辑（否则复制页面内容会丢块）。
- **演示模式**：`presentation-mode.tsx` 对未知块类型的渲染回退要覆盖新块（至少渲染标题/占位，不崩）。
- **公开分享**：分享只读页的渲染路径（`app/share/...` 与 `lib/share/`）对新块用只读 NodeView；数据库块在分享页的可见性策略需明确（M3 时定：默认随父页只读可见）。
- **离线**：`public/sw.js` 与 `lib/offline/queue.ts` 对 databaseBlock 只保证不崩；在线编辑离线查看即可。
- **性能**：TOC/数据库 NodeView 都禁止在渲染路径做全文档重计算而不做缓存；数据库行数 >500 的虚拟滚动放 M4 后评估。

## 8. 里程碑速查

| 里程碑 | 内容 | 依赖 | 建议 PR 粒度 |
| --- | --- | --- | --- |
| M1 ✅ (#29) | 目录/折叠标题补完/路径栏/按钮/选项卡/Mermaid/通用嵌入 | 无新表 | 合为 1 PR（#29） |
| M2 | 同步区块（027 迁移） | M1 完成更佳（无硬依赖） | 1–2 PR |
| M3 | 数据库内核（028+ 迁移）+ 表格视图 + 行内/整页入口 | — | 模型 1 PR、表格视图 1–2 PR |
| M4 | 看板/列表/画廊/日历/时间轴 + 链接的视图 | M3 | 每视图 1 PR |
| M5 | 图表族/地图/动态/管理面板/AI 速记 | M4 | 每功能 1 PR |

> 每完成一个里程碑，回到本文档把对应行标记为 ✅ 并注明实现 PR 号，保持文档为最新真相。
