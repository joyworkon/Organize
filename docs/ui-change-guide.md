# UI 可持续改版地图（ui-change-guide）

编制：2026-09-13。代码基线：master `e514eee`（C01 卡交付）；2026-09-16 随 Cairn 改版第二步（石墨中性 + 石板蓝）与第三步（内容泳道 / 页头收口 / 设置页分组）更新；2026-09-17 随第四步（工具行收口：筛选面板 + 标签筛选并入工具行）、第五步（工作台首屏信息密度：横带合并 + 卡片三档层级）与第六步（笔记页工具行收口：排序合成下拉 + 导入/图谱收进页头「更多」）更新；2026-09-17 随第七步（顶部工具条统一：笔记标签改四角圆角胶囊 + 「+」紧跟标签 + 稍后读文章顶栏并入同一条壳）与第八步（文章顶栏收密度并贴顶、标签分隔条与 × 显隐、**全站默认内容宽度统一到标准泳道**、侧栏速记「+」）更新。
计划卡：[long-term-agent-plan-2026-09-11.md §5 C01](long-term-agent-plan-2026-09-11.md)。
用途：改任何界面之前，先在这份地图上定位「改哪里、会牵动哪里」。本文随大改版 PR 更新（规则见 §6）。

## 1. 分层地图（自上而下的依赖方向：上层改不影响下层，下层改牵动上层）

| 层 | 内容 | 唯一入口文件 |
|---|---|---|
| L0 token | 语义色/圆角/阴影 CSS 变量、`.dark` 覆盖、编辑器节奏变量、**内容泳道宽度**（2026-09-16 起：石墨中性冷灰外壳，`--radius-md` 收到 6px；同日新增 `--organize-lane*` / `--organize-field`） | `app/globals.css`（:14-90 语义色与暗色；:39-54 圆角阴影；:985-1002 编辑器 prose 色映射；`--organize-*` 节奏与侧栏宽、内容泳道段、设置分组卡、`.organize-filter-idle`、`.organize-task-header` 兜底滚动） |
| L0+ 品牌色 | **单一品牌色**（石板蓝 亮 `215 32% 44.5%` / 暗 `215 29% 58%`）inline 覆盖 primary/primary-foreground/primary-text/ring（D02 后 accent 不随品牌；2026-09-16 起取消 5 色切换与持久化，同日由陶土橙改为石板蓝） | `hooks/use-theme-color.ts`（`BRAND_COLOR`，`applyThemeColor()` 无参，`useThemeColor()` 监听 html class 重放明暗） |
| L1 原语 | button/dialog/dropdown/select/popover/toast/command 等 18 件 | `components/ui/*`（**全站唯一**，无第二套 Button/Dialog——自查结论见 §5） |
| L2 业务组件 | 侧边栏/移动壳/命令面板/编辑器/反链面板等 | `components/layout/*`、`components/notes/*`、`components/editor/*`、`components/share/*` |
| L3 壳 | (main) 路由组装：侧边栏+移动壳+命令面板+全局热键 | `app/(main)/layout.tsx`（:25-45 固定顺序：MobileNavigation → Sidebar → GlobalHotkeys → CommandPalette → Toaster → main(NoteTabsBar) → 桥接器群） |
| L4 路由 | 页面 | `app/(main)/**/page.tsx`；独立壳：`app/desktop/notch/page.tsx`（Tauri 刘海，不在 (main) 内） |

**铁律**：改观感只动 L0/L0+（token + 主题色）；改交互只动 L1/L2；改信息架构才动 L3/L4。

## 2. 「改哪里影响哪里」速查

| 想改的东西 | 要动的文件 | 会被牵动的暗面 |
|---|---|---|
| 内容宽度 / 页面版式节奏 | `app/globals.css` 内容泳道段：`--organize-lane`（1088px 标准，**2026-09-17 起全站默认档**）/ `--organize-lane-wide`（1400px）/ `--organize-lane-narrow`（800px）/ `--organize-field`（480px 单行表单字段） | **第八步起：侧边栏能点进去的每个功能页都用标准档 1088**——设置/插件/协作空间/速记去掉了 `organize-lane-narrow`，待办工作台与图谱去掉了 `organize-lane-wide`，页面不写泳道类就是标准档（由 `.organize-main-content > *` 兜住）。wide / narrow token 保留但当前无页面使用，**再要开档必须先说明为什么这一页必须与其它页不同宽**。仍有的例外只剩两处文档页：笔记详情与文章详情用 `organize-lane-full`（它们自带全宽偏好、fixed 目录与高亮面板，被裁会错位）。另两个坑：①泳道类必须落在 `.organize-main-content` 的**直接子节点**上，待办族的类在 `tasks/layout.tsx`；②泳道只在 ≥768px 生效，移动端仍是 mobile.css 的 16px 边距体系 |
| 列表页筛选器 | 待办：`components/tasks/task-filter-menu.tsx`（状态/分类/优先级/标签四组 chip 收进清单头的「筛选」面板）；其余列表页：`components/tags/tag-filter.tsx`（默认态只是一个安静的「标签」按钮，选中后 chip 就地显示） | **不要再给筛选器单开一条横带**：稍后读/笔记/经验一律把 `TagFilter` 塞进自己的工具行（`className` 可透传）。待办面板内部**禁止嵌 Radix Select**（开在 Popover 里会与外层 DismissableLayer 打架），四组条件用 chip；生效条数由 `countActiveTaskFilters` 单源计算（单测钉住）。默认态的安静样式来自 `.organize-filter-idle` |
| 待办清单头工具区 | `app/(main)/tasks/page.tsx` 的 `.organize-task-header`（筛选面板 / 日期分组 / 多选 / 模板 / 附件 / 通知提示 chip） | 清单栏宽度取决于**是否打开任务详情**（`TaskInlineDetail` 占 `34.5vw`，最小 420px），所以文字标签按 `selectedTask ? 2xl : lg` 分档，`TaskTemplatesDialog` / `TaskAttachmentsDialog` 收到 `compact` 时只留图标（可访问名进 `aria-label`+`title`，`a11y-button-names.spec.ts` 会查）；≤1024px 双栏仍装不下时靠 `.organize-task-header` 的横向滚动兜底（滚动条隐藏），**不要改回 `overflow-hidden`**，否则按钮被裁。移动端那条工具行在 `.mobile-task-tools`（mobile.css 给 44px 触控高） |
| 工作台首屏与卡片层级 | `components/dashboard/today-view.tsx`（首屏 `.dashboard-intro` 分组 + 四卡层级）+ globals.css `.dashboard-metric-row` / `.dashboard-metric-alert` / `.dashboard-section-link` | 首屏只有**两条横带**（问候语+入口 / 快速记录同属 `.dashboard-intro`），别再往中间插第三条；卡片层级靠**字号三档**（主卡 15px/600、次主卡 14px/600、辅列 13px/500 muted）与内边距（16px / 14px），**不要给辅列卡加品牌色图标**（会拉平层级）；四张卡的「全部」一律用 `.dashboard-section-link` 文字链（不是 ghost 按钮），只有真正的动作（随机一篇）保留按钮；首屏**只允许一个实心品牌按钮**（快速记录的「保存」），导航入口一律 outline；未读列表渲染 4 条对应查询 `limit(5)`，改渲染条数先看 `loadData` 的 limit |
| 笔记页工具行与页头动作 | `app/(main)/notes/page.tsx`（`.mobile-note-tools` 工具行 + PageHeader actions）+ `app/(main)/notes/page-utils.ts` 的 `SORT_FIELD_LABEL` / `sortSummary` | 工具行**只允许四簇**：标签筛选 / 排序 / 视图切换 / 多选——排序字段与升降序合成**一个下拉**（触发器标签走 `sortSummary` 单源，字段循环函数已删，改文案只动 page-utils）；导入两件套与图谱收进页头「更多」菜单，页头只留一个实心主动作「新建笔记」；图谱入口迁移要同步 §3 追踪表与 sidebar.tsx 顶部注释；移动端沿用同一套控件（mobile.css `.mobile-note-tools`，`.mobile-note-graph` / `.mobile-note-sort-order` 两条规则随按钮删除已移除）；**mock 后端只保留最后一个 `.order()`**（页面末位是 `id`），所以 mock 下看不到重排，排序落地靠「标题档取消日期分组」与 page-utils 单测证明 |
| 页面标题区 | `components/layout/page-header.tsx`（图标 36px + h1 `text-xl sm:text-2xl` + 描述 + 右侧 actions） | 全站页面标题的唯一实现，禁止再自建 h1 版式；工作台是特例（问候语 h1 + 吸顶条内的面包屑级「工作台」，样式在 globals.css `.dashboard-view-switcher`）；待办清单头是工作区面板头，保留自有样式 |
| 明暗模式 | `hooks/use-theme-mode.ts`（`ThemeMode` = system/light/dark，`setThemeMode` 广播 `organize:theme-mode-change`） | 侧栏按钮 `theme-toggle.tsx` 与设置页 `components/settings/appearance-section.tsx` 共用这份状态，改一处必须两处同步；存储键仍是 `organize-theme`，**「跟随系统」= 删键**（旧语义，改成写字面量会让老代码读成亮色）；契约由 `hooks/use-theme-mode.test.ts` 钉住 |
| 品牌色 | `hooks/use-theme-color.ts` 的 `BRAND_COLOR`（明暗成对，单色；当前石板蓝） | inline 变量**覆盖** globals.css 的 `--primary`/`--primary-text`——只改 CSS 变量不生效；MutationObserver 重放逻辑（:105-128）必须保持。**C02 起 `text-primary` 解析到 `--primary-text`（品牌安全文本色）**，`bg-/border-/ring-primary` 仍取品牌原色；tailwind `textColor.primary` 覆盖必须保留 `foreground` 子键（字符串形式会顶掉 `text-primary-foreground`）；对比度契约由 `hooks/use-theme-color.test.ts` 钉住（单色 5 断言，含 `bg-primary/10` tint 底与暗色卡片底），改色值先跑它；测试里的 `PAGE_LIGHT`/`PAGE_DARK`/`CARD_DARK` 是 globals.css 的镜像，改底色要两边同步 |
| 暗色模式 | globals.css `.dark` 块 | tailwind.config.ts `darkMode: ["class"]`；theme-toggle 切 html class；color-scheme（globals.css:97-102） |
| 圆角/阴影 | `--radius-*` / `--shadow-*` | `@supports (corner-shape)` 连续曲率层（:59-63） |
| 编辑器排版节奏 | `--organize-editor-padding` / `--organize-gutter` / `--organize-block-gap`（:2182-2188） | 移动端覆盖值在 :4581-4589 成对存在；prose 色映射 :985-1002 被历史版本预览与公开分享页共用 |
| 侧边栏宽度/折叠 | `--organize-sidebar-width`（:2256）+ `data-sidebar-collapsed`（:2258） | sidebar.tsx 折叠写 data 属性（:144,197-202） |
| 导航分组/顺序 | sidebar.tsx `navItems`（:53-61）+ 条件项（:116-127） | **四处入口需同步**：命令面板 NAV_ITEMS（command-palette.tsx:77-90）、移动底栏 `MOBILE_DESTINATIONS`（lib/navigation/mobile.ts:3-9）、g 前缀快捷键与帮助清单（global-hotkeys.tsx `GOTO_ROUTES` 单源派生，:22-49——g 键位/帮助条目/goto 提示均由它生成，一致性有单测钉住）、图谱/插件非一级入口（收进笔记页工具行/设置页，注释 :50-52） |
| 移动底栏五模块 | lib/navigation/mobile.ts | mobile-bottom-bar.tsx 渲染；详情路由与键盘弹出隐藏逻辑在 mobile-navigation.tsx:72,87 |
| 壳断点 | 767px（mobile.css @media + matchMedia） | **单断点体系**：`md:`（768px）分桌面/移动；新增第二断点需同时动 mobile.css、mobile-navigation.tsx:39、sidebar 的 md: 类 |
| 快捷键 | global-hotkeys.tsx（g 序列/`?` 帮助）、command-palette.tsx:339-352（⌘K） | `lib/hooks/use-hotkey.ts` 是唯一注册器：isTypingTarget 输入屏蔽、1.5s 序列 buffer、hasOpenDialog 弹层让位——新键位必须走它，不得自行 addEventListener |
| 新增按钮/对话框 | 一律 `components/ui/button|dialog` | 禁止第二套实现（现状核查：无 `.btn` 类、无原生 dialog；裸 `<button>` 仅限一次性图标按钮，如 theme-toggle.tsx:26-37） |
| 笔记页设置（全宽/字体/小字号） | note-page-menu.tsx → page.tsx :1266-1279 contentClassName + 根类 | CSS 生效点 globals.css:116-146；持久化 note-save-session.ts:664-667 与 local-draft.ts 成对 |
| 角色可见性 | lib/collab/roles.ts（owner/editor/viewer + saveRpcNameForRole）、lib/notes/capabilities.ts | 分流点集中在 notes/[id]/page.tsx（:1295/:1312/:1340/:1387/:1410/:1426-1428/:1496）；note-page-visuals.tsx:20；分享面板 components/share/resource-share-dialog.tsx（owner 才能改授权） |
| 顶部工具条（笔记标签条 / 文章顶栏）外壳与胶囊 | `app/globals.css` 的 `.organize-chrome-bar` / `.organize-chrome-pill`（灰底条 + 四角 6px 圆角胶囊，暗色条落回 background、开启态用 accent 提亮）；结构在 `components/notes/note-tabs-bar.tsx` 与 `app/(main)/library/[id]/page.tsx` 顶栏 | 三个坑：①`.organize-chrome-pill` 只给非 Button 元素用，`ui/Button` 的 ghost 变体带 `hover:bg-accent`，会在悬停时盖掉底色——Button 要直接写 `bg-card shadow-xs hover:bg-card dark:bg-accent dark:hover:bg-accent`（经 tailwind-merge 才压得住）；②标签条「+」在滚动容器内 `sticky right-0`，必须保持 `.note-tabs-add` 的不透明底，否则溢出时标签会从它下面滚过去；③文章顶栏（第八步）与标签条对齐的三件事：`-mt-4 md:-mt-6` 抵消内容区上内边距做到**贴顶不留白带**、内层 `md:h-10` 与标签条同高 40px、顶栏下沿那条 `bg-primary` 阅读进度线**已删除**（滚动进度仍在正文里以文字显示）；④文章顶栏桌面动作簇收在 `.reading-topbar-actions`（高亮/专注/收藏/更多/原文=唯一 outline），速读、宽度、转为笔记、分享在「更多」菜单里，状态徽标移到左侧面包屑后（lg 以上显示）——加动作先想能不能进菜单；⑤标签之间的灰色圆角小竖条是 `.note-tab + .note-tab::before`，相邻标签任一被选中或悬停时置 `opacity: 0`；未激活标签的 × 是 `opacity-0 group-hover/tab:opacity-100` |
| 表格配色/边框 | `data-table-color` 变量组（globals.css:1128-1190） | editor/extensions/table-style.ts 持久化属性成对 |

## 3. 功能入口追踪表（卡面验收：每个主要功能入口可追踪）

| 功能 | 路由 | 侧边栏 | 移动底栏 | 命令面板 | 快捷键 |
|---|---|---|---|---|---|
| 工作台 | `/` | ✓ 首项 | ✓ 首页 | ✓ 导航节 | g h |
| 稍后读 | `/library` | ✓（含标签子列表） | ✓ 阅读 | ✓ | g i / g l |
| 笔记 | `/notes` | ✓（含笔记树） | ✓ 笔记 | ✓ | g n |
| 待办 | `/tasks` | ✓（含清单） | ✓ 待办 | ✓ | g d |
| 经验 | `/tasks/lessons` | （tab） | （tab） | ✓ | g e |
| 速记 | `/memos` | ✓（行内「+」快速新建，非本页时走 `/memos?compose=1` 聚焦输入框后抹参数） | ✓ | ✓ | g m |
| 图谱 | `/graph` | ✗（笔记页页头「更多」菜单，移动端在列表「更多」） | ✗ | ✓ | g g |
| 收藏夹 | `/favorites` | ✓ 条件插入（有收藏才显示） | ✗ | ✓ | g f |
| 标签管理 | `/tags` | ✗（稍后读分组「管理标签」） | ✗ | ✓ | g t |
| 复盘/统计 | `/?view=review|stats` | ✗ | ✗ | ✓ | g r / g s |
| 插件 | `/plugins` | ✗（设置页内） | ✗ | ✓ 插件命令节 | g p |
| 垃圾箱 | `/trash` | ✓ | ✗ | ✓ | — |
| 设置 | `/settings` | ✓ | ✗ | ✓ | — |
| 与我共享/协作空间 | `/shared` `/spaces` | ✓ 条件插入 | ✗ | ✓ | — |
| 收集（稍后读） | — | QuickAdd | 顶栏新建 | 粘贴链接 | organize:quick-add 事件 |
| 刘海激发器 | `/desktop/notch` | ✗ 独立壳（Tauri） | ✗ | ✗ | ⌘⇧M（native） |

条件入口（收藏/与我共享/协作空间）由数据存在性驱动——改版时不得改成常驻或删除深链。

## 4. 现状自检结论（2026-09-13）

- **无第二套 Button/Dialog**（grep `.btn`、原生 `<dialog>` 均零命中；prompt-dialog 基于 ui/dialog）。
- 无全局 useMobile hook——matchMedia 内联仅剩 mobile-navigation.tsx（壳断点）一处；明暗那份已按本规则抽成 `hooks/use-theme-mode.ts`（2026-09-16），侧栏按钮与设置页共用。如需再有第三处，同样先抽 hook。
- 图谱页自含 SVG 力导向但**复用全局 token**（fill-primary 等），非独立视觉体系；改色不会漏。
- 帮助弹窗（`?`）内的键位清单是**手工清单**（global-hotkeys.tsx:33-71）——加键位必须同步，无自动校验。
- 移动壳高度由 `--mobile-header-height`/`--mobile-tab-height` + safe-area 计算（app/mobile.css:6-9）；`viewportFit: cover`（app/layout.tsx:20-22）。

## 5. 一页改版模板（每次改版按此执行，复制进 PR 描述）

```markdown
## 改版目标（一句话）
<例如：把 X 入口从二级菜单提为底栏>

## 影响面（对照 §2 速查勾选）
- [ ] token/主题色（涉及：__）
- [ ] L1 原语（涉及：__；确认未新建第二套）
- [ ] L2 业务组件（涉及：__）
- [ ] 壳/导航（四处入口同步：sidebar / 命令面板 NAV_ITEMS / 移动底栏 / g 快捷键 + `?` 帮助清单）
- [ ] 断点（是否触碰 767px 单断点体系）
- [ ] 角色/权限入口（viewer/editor/owner 分流是否变化）

## 兼容清单
- [ ] 旧 URL/深链保持可达（或 302 兼容层）
- [ ] 键盘路径可达（新入口有快捷键或命令面板命令）
- [ ] 移动端（底栏/顶栏/安全区）与桌面同步验证
- [ ] 暗色模式验证（inline 主题色覆盖生效）

## 回归
- [ ] typecheck / Vitest / lint / build
- [ ] 相关 E2E（笔记页改动跑 collab 套件相关 spec）
- [ ] 本 PR 不夹带权限/数据模型变化（计划 §3 红线）
```

## 6. 维护规则

1. 大改版 PR（改 §2 表中任意一行所列文件）必须同步更新本文对应行——本文是地图不是历史。
2. 新增一级入口/移动模块/快捷键 = 信息架构变更：除 §5 模板外需在账本留一行证据。
3. 视觉 PR（L0/L0+）不夹带权限与数据模型变化；无法兼容的改版必须给迁移与回退路径（计划 §3）。
4. 行号会漂移：引用行号仅辅助定位，以文件+符号名为准；发现失修随手修。
