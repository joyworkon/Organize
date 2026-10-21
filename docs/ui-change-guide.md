# UI 可持续改版地图（ui-change-guide）

编制：2026-09-13。代码基线：master `e514eee`（C01 卡交付）；2026-09-16 随 Cairn 改版第二步（石墨中性 + 石板蓝）与第三步（内容泳道 / 页头收口 / 设置页分组）更新；2026-09-17 随第四步（工具行收口：筛选面板 + 标签筛选并入工具行）、第五步（工作台首屏信息密度：横带合并 + 卡片三档层级）与第六步（笔记页工具行收口：排序合成下拉 + 导入/图谱收进页头「更多」）更新；2026-09-17 随第七步（顶部工具条统一：笔记标签改四角圆角胶囊 + 「+」紧跟标签 + 稍后读文章顶栏并入同一条壳）与第八步（文章顶栏收密度并贴顶、标签分隔条与 × 显隐、**全站默认内容宽度统一到标准泳道**、侧栏速记「+」）更新；2026-09-17 随第九步（详情页操作行统一壳 `.organize-detail-bar`：任务 / 经验详情与笔记详情同几何，破坏性操作收进「更多」，侧栏「+」对齐同一列）更新；2026-09-17 随第十步（功能页页头去说明：全站功能页标题区只留「名称 + 右侧动作」，不再放功能说明与计数，收藏夹页头面包屑与标题重复一并移除）更新。2026-09-17 随第十一步（**设计系统图标层**：TraeWork 单色 SVG 代码生成 + 131 文件 codemod 摘掉 lucide-react；**功能页页内搜索**统一进页头 `search` 槽；侧栏「待办」子导航改为缩进 + 竖导引线 + 分段小标题；置顶态从左侧色条改为灰底 chip；笔记列表页去掉前进/后退/「+」条；侧栏速记「+」改为设计系统闪电并落到最右列）更新。同日新增自检文档 [design-system-audit-2026-09-17.md](design-system-audit-2026-09-17.md)。
计划卡：[long-term-agent-plan-2026-09-11.md §5 C01](long-term-agent-plan-2026-09-11.md)。
用途：改任何界面之前，先在这份地图上定位「改哪里、会牵动哪里」。本文随大改版 PR 更新（规则见 §6）。

2026-10-15 新设计方向见 [DESIGN.md](../DESIGN.md)、[页面规格](design/page-specs.md) 与 [迁移计划](design/migration-plan.md)。已接入正式路由，范围、测试与原生平台边界见 [接入记录](design/adoption-report.md)；下文保留实现地图，历史行号仅作线索，以符号和源码为准。默认主题为中性明暗实色，手机为顶部菜单和共用侧栏抽屉；没有全局五入口底栏。

## 1. 分层地图（自上而下的依赖方向：上层改不影响下层，下层改牵动上层）

| 层 | 内容 | 唯一入口文件 |
|---|---|---|
| L0 token | 中性明暗语义色/圆角/阴影 CSS 变量、编辑器节奏与内容泳道；控件圆角8px、composer/dialog16px，数值源为 `docs/design/tokens.json` | `app/globals.css`（语义色与 `.dark`、圆角阴影、prose 色映射、`--organize-*` 节奏与侧栏宽、内容泳道、筛选与任务工具行） |
| L0+ 品牌色 | 单一中性主色，亮 `0 0% 12.55%` / 暗 `0 0% 93.33%`；inline 覆盖 primary/primary-foreground/primary-text/ring，hover/选中为中性灰；用户标签与内容色板独立保留 | `hooks/use-theme-color.ts`（`BRAND_COLOR`、`applyThemeColor()`、`useThemeColor()`）；根 `components/layout/theme-bridge.tsx` 初始化独立路由 |
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
| 页面标题区 | `components/layout/page-header.tsx`（图标18px + h1 `text-xl font-semibold leading-7` + 右侧 actions） | 全站页面标题的唯一实现，禁止再自建 h1 版式；**第十步起功能页页头只放「名称 + 右侧动作」，不放功能说明与计数**（组件仍保留 `description` prop 但目前无页面使用，新增页头文案前先问「这句说明是否值得占一行」）；工作台是特例（问候语 h1 + 吸顶条内的面包屑级「工作台」，样式在 globals.css `.dashboard-view-switcher`）；待办清单头是工作区面板头，保留自有样式；收藏夹页头不放面包屑（与 h1 重复，第十步已删） |
| 明暗模式 | `hooks/use-theme-mode.ts`（`ThemeMode` = system/light/dark，`setThemeMode` 广播 `organize:theme-mode-change`） | 侧栏按钮 `theme-toggle.tsx` 与设置页 `components/settings/appearance-section.tsx` 共用这份状态，改一处必须两处同步；存储键仍是 `organize-theme`，**「跟随系统」= 删键**（旧语义，改成写字面量会让老代码读成亮色）；契约由 `hooks/use-theme-mode.test.ts` 钉住 |
| 品牌色 | `hooks/use-theme-color.ts` 的 `BRAND_COLOR`（明暗成对，单色；当前中性实色） | inline 变量**覆盖** globals.css 的 `--primary`/`--primary-text`——只改 CSS 变量不生效；MutationObserver 重放逻辑（:105-128）必须保持。**C02 起 `text-primary` 解析到 `--primary-text`（品牌安全文本色）**，`bg-/border-/ring-primary` 仍取品牌原色；tailwind `textColor.primary` 覆盖必须保留 `foreground` 子键（字符串形式会顶掉 `text-primary-foreground`）；对比度契约由 `hooks/use-theme-color.test.ts` 钉住（单色 5 断言，含 `bg-primary/10` tint 底与暗色卡片底），改色值先跑它；测试里的 `PAGE_LIGHT`/`PAGE_DARK`/`CARD_DARK` 是 globals.css 的镜像，改底色要两边同步 |
| 暗色模式 | globals.css `.dark` 块 | tailwind.config.ts `darkMode: ["class"]`；theme-toggle 切 html class；color-scheme（globals.css:97-102） |
| 圆角/阴影 | `--radius-*` / `--shadow-*` | `@supports (corner-shape)` 连续曲率层（:59-63） |
| 编辑器排版节奏 | `--organize-editor-padding` / `--organize-gutter` / `--organize-block-gap`（:2182-2188） | 移动端覆盖值在 :4581-4589 成对存在；prose 色映射 :985-1002 被历史版本预览与公开分享页共用 |
| 侧边栏宽度/折叠 | `--organize-sidebar-width`（:2256）+ `data-sidebar-collapsed`（:2258） | sidebar.tsx 折叠写 data 属性（:144,197-202） |
| 导航分组/顺序 | sidebar.tsx `navItems`（:53-61）+ 条件项（:116-127） | **四处入口需同步**：命令面板 NAV_ITEMS（command-palette.tsx:77-90）、移动返回位置 `MOBILE_DESTINATIONS`（lib/navigation/mobile.ts:3-9）、g 前缀快捷键与帮助清单（global-hotkeys.tsx `GOTO_ROUTES` 单源派生，:22-49——g 键位/帮助条目/goto 提示均由它生成，一致性有单测钉住）、图谱/插件非一级入口（收进笔记页工具行/设置页，注释 :50-52） |
| 手机导航/上下文工具 | lib/navigation/mobile.ts、mobile-navigation.tsx、sidebar.tsx | 顶部菜单 + 共用侧栏抽屉；无全局五入口底栏。`MOBILE_DESTINATIONS` 仅存集合返回位置；mobile-bottom-bar.tsx 为可选局部动作承载。详情保留自己的返回/工具，键盘/safe-area 由现有 VisualViewport 逻辑处理。 |
| 壳断点 | 767px（mobile.css @media + matchMedia） | **单断点体系**：`md:`（768px）分桌面/移动；新增第二断点需同时动 mobile.css、mobile-navigation.tsx:39、sidebar 的 md: 类 |
| 日历快速新建 | `components/tasks/calendar-quick-create.tsx`、`task-month-view.tsx`、`calendar-mobile-month.tsx`、`app/(main)/tasks/calendar/page.tsx` | 桌面 Radix Popover 按格子/时间段矩形避让，手机同内容底部 Dialog。受控占位跟随标题/排期，成功返回行本地合并并短暂高亮；失败原位保留输入。N 新建、Enter 提交（IME 除外）、Esc 返回触发格；更多选项保存后走 task query 详情。 |
| 日历重复发生 | `components/tasks/task-month-view.tsx`、`lib/tasks/recurrence.ts`、`lib/tasks/recurring-occurrences.ts` | 月格（42 天）/周/日/手机议程按可见范围生成最多 400 个只读投影；月末/闰日从源日期锚定推进。投影以 `data-recurring-projection` 标记、点击打开源任务，禁止拖拽/resize/键盘改期/手机改期；年视图只显示真实任务圆点。数据不落库，现有真实任务与倒数日交互保持。 |
| 资料添加到画布 | `components/library/add-to-canvas-dialog.tsx`、`lib/canvas/add-target-memory.ts` / `material-feedback.ts` / `focus-link.ts`、`components/canvas/canvas-workspace.tsx` | 共享选择器、按用户记忆已成功目标、已加载快照重复提示；成功链接以 focus 一次性选择并适合卡片，replace 仅移除 focus。保留列表/页面失败重试与单次 PATCH/CAS。 |
| 构思画布页面与选区视图 | `components/canvas/canvas-outline-panel.tsx`、`canvas-board-actions.ts`、`canvas-board.tsx`、`canvas-property-bar.tsx`、`canvas-workspace.tsx`、`canvas-shortcuts.ts`；`lib/canvas/commands.ts` / `selection-bounds.ts` | 页面复制是一条可撤销事务，保留源引用并重建结构 ID；大纲删除用 showConfirm；Shift+2 与按钮共用选区包围盒和可见视口，Shift+1 保持适合全部。只读/预览隐藏写动作；不改 schema/CAS/保存队列，不增加坐标祖先 transform/contain。 |
| 快捷键 | global-hotkeys.tsx（g 序列/`?` 帮助）、command-palette.tsx:339-352（⌘K） | `lib/hooks/use-hotkey.ts` 是唯一注册器：isTypingTarget 输入屏蔽、1.5s 序列 buffer、hasOpenDialog 弹层让位——新键位必须走它，不得自行 addEventListener |
| 新增按钮/对话框 | 一律 `components/ui/button|dialog` | 禁止第二套实现（现状核查：无 `.btn` 类、无原生 dialog；裸 `<button>` 仅限一次性图标按钮，如 theme-toggle.tsx:26-37） |
| 笔记页设置（全宽/字体/小字号） | note-page-menu.tsx → page.tsx :1266-1279 contentClassName + 根类 | CSS 生效点 globals.css:116-146；持久化 note-save-session.ts:664-667 与 local-draft.ts 成对 |
| 笔记多选块工具栏 | `components/editor/block-multi-select-bar.tsx`、`block-multi-select-actions.ts`、`block-action-options.ts`、`extensions/block-multi-select.ts` | 转换/颜色以单事务批处理，沿用块转换及 ID 规则；移动限连续兄弟，包裹限连续顶层块。折叠摘要复制首块文字，内容保留全部原块。复杂删除（含键盘）走 showConfirm，确认后复查文档与权限；操作后恢复多选高亮。页面转换需逐块执行。 |
| 笔记正文链接 | `components/editor/link-hover-card.tsx`、`link-editor-popover.tsx`、`bubble-toolbar.tsx`、`editor-extensions.ts`、`lib/editor/link-url.ts` | 卡片与输入复用 EditorPopover + Button，body portal；折叠光标/悬停/触屏点击可查阅，内部状态复用已加载映射。只读仅打开/复制；链接编辑映射原选区并复查权限，沿用 TipTap 粘贴/autolink，不新增 ⌘K 处理、不改 mark/保存合同。 |
| 笔记图片块 | `components/editor/extensions/resizable-image.tsx`、`image-toolbar.tsx`、`image-geometry.ts`、`components/ui/image-viewer.tsx`、`use-editor-upload.ts` | 图片选中工具栏与查看器均为 body portal；宽度仍为 px/null，保留旧 JSON/HTML 和 DOM 选择器；双侧键盘/拖动调宽、单事务撤销；替换复用原上传回退，异步结束复查权限与节点。只读仅查看操作，文字 BubbleMenu 排除图片 NodeSelection。因默认 null 属性会改变旧 JSON，本轮不新增 align。 |
| 笔记编辑/保存状态 | `app/(main)/notes/[id]/page.tsx`、`hooks/use-note-session.ts`、`lib/notes/note-save-session.ts`、`components/notes/note-save-status.tsx` | 状态直接消费会话 phase；切笔记/账号隔离，离线创建核对账号并恢复后续草稿。保持 RPC、blockId、JSON 和 ydoc 顺序；范围与开放项见 [2026-10-16 审计](design/note-edit-audit-2026-10-16.md)。 |
| 角色可见性 | lib/collab/roles.ts（owner/editor/viewer + saveRpcNameForRole）、lib/notes/capabilities.ts | 分流点集中在 notes/[id]/page.tsx（:1295/:1312/:1340/:1387/:1410/:1426-1428/:1496）；note-page-visuals.tsx:20；分享面板 components/share/resource-share-dialog.tsx（owner 才能改授权） |
| 顶部工具条（笔记标签条 / 文章顶栏）外壳与胶囊 | `app/globals.css` 的 `.organize-chrome-bar` / `.organize-chrome-pill`（灰底条 + 四角 6px 圆角胶囊，暗色条落回 background、开启态用 accent 提亮）；结构在 `components/notes/note-tabs-bar.tsx` 与 `app/(main)/library/[id]/page.tsx` 顶栏 | 三个坑：①`.organize-chrome-pill` 只给非 Button 元素用，`ui/Button` 的 ghost 变体带 `hover:bg-accent`，会在悬停时盖掉底色——Button 要直接写 `bg-card shadow-xs hover:bg-card dark:bg-accent dark:hover:bg-accent`（经 tailwind-merge 才压得住）；②标签条「+」在滚动容器内 `sticky right-0`，必须保持 `.note-tabs-add` 的不透明底，否则溢出时标签会从它下面滚过去；③文章顶栏（第八步）与标签条对齐的三件事：`-mt-4 md:-mt-6` 抵消内容区上内边距做到**贴顶不留白带**、内层 `md:h-10` 与标签条同高 40px、顶栏下沿那条 `bg-primary` 阅读进度线**已删除**（滚动进度仍在正文里以文字显示）；④文章顶栏桌面动作簇收在 `.reading-topbar-actions`（高亮/专注/收藏/更多/原文=唯一 outline），速读、宽度、转为笔记、分享在「更多」菜单里，状态徽标移到左侧面包屑后（lg 以上显示）——加动作先想能不能进菜单；⑤标签之间的灰色圆角小竖条是 `.note-tab + .note-tab::before`，相邻标签任一被选中或悬停时置 `opacity: 0`；未激活标签的 × 是 `opacity-0 group-hover/tab:opacity-100` |
| 详情页操作行（笔记 / 任务 / 经验详情） | `app/globals.css` 的 `.organize-detail-bar` + `-inner/-group/-nav/-back/-actions`（与笔记 `.note-topbar` 共用几何：44px 行高、`padding 0 .5rem`/md `.75rem`、吸顶、静止态无分隔线）；结构在 `app/(main)/notes/[id]/page.tsx`（用 `.note-topbar`，因上方有常驻标签条，吸顶偏移 40px）、`app/(main)/tasks/[id]/page.tsx` 与 `app/(main)/lessons/[id]/page.tsx`（用 `.organize-detail-bar`，桌面吸顶 top:0） | 四个坑：①任务详情在 `tasks/layout.tsx` 的 tab 行下面，**不能用 `-mt-4 md:-mt-6` 负边距贴顶**（会压住 tab 行），只有经验详情这种直接挂在主内容区的页面才用负边距；②顶栏里不放孤立的红色破坏性图标——`移入垃圾箱` 一律进「更多」菜单末位（`DropdownMenuSeparator` + `text-destructive focus:text-destructive`），红色只出现在确认框的确认按钮上；③确认框用 `components/ui/prompt-dialog` 的 `showConfirm`（`destructive: true`），不要用原生 `confirm()`；④这三条操作行的高度/内边距靠共用 CSS 选择器保持一致，改 `.note-topbar-inner` 一类规则时记得它同时管着 `.organize-detail-bar-inner` |
| 图标资产 | `apps/web/scripts/ds-icon-map.json`（图标名 → TraeWork SVG 文件名）+ `scripts/gen-ds-icons.mjs` 生成 `components/icons/ds-icons.generated.tsx`；业务侧一律 `from "@/components/icons"` | 三个坑：①**不要手写 SVG path**，改图标就改映射再跑生成脚本（`node scripts/gen-ds-icons.mjs`，源目录可用 `TRAEWORK_ICONS` 覆盖）；②`TraeWork Copy/` 是未跟踪的只读参考物，构建期不能依赖它存在——生成产物必须入库；③图标全部 `fill="currentColor"`，颜色只能由文字色带，给图标直接写颜色会破坏暗色。`rg "lucide-react" apps/web --glob '!node_modules'` 应只命中 `package.json` |
| 功能页页内搜索 | `components/layout/page-search.tsx`（唯一形态）+ `components/layout/page-header.tsx` 的 `search` 槽 + `lib/search/page-search.ts`（`matchesPageSearch` / `filterByPageSearch`）+ globals.css `.organize-page-search*` | 四个坑：①**只搜本功能**（标题 + 标签，部分页加 URL/摘要），跨功能搜索是 ⌘K 命令面板，语义不许重叠；②视觉契约固定为「未聚焦浅灰底无边框 / 聚焦纸面底 + 品牌色外框 + 光环」，别在页面里另写一套输入框；③`.organize-page-search` 的 `display` 规则**必须留在 `@layer components` 里**，否则会盖掉 Tailwind 的 `hidden` / `md:hidden`，桌面副本会在手机宽度下漏出来；④待办族（`/tasks`、`/tasks/countdown`）的搜索框贴的是工作台内框（`px-8`），右缘比标准泳道页窄 32px，这是对的；`/tasks/calendar` 故意没有页内搜索（日历格子无列表可筛，跨任务搜索在 `/tasks/search` tab） |
| 侧栏「待办」子导航 | `components/tasks/task-sidebar.tsx`（`nested = hideHeading`）+ globals.css `.organize-task-subnav` / `-item` / `-caption` | 三个坑：①缩进 `margin-left: 20px` 是算出来的（nav `p-3` 12px + 父行 `pl-3` 12px + 图标半宽 8px = 32px 竖线压在父图标中心线上），改侧栏内边距要同步改它；②子项选中态用 `data-selected` + CSS 左侧色条 + `bg-accent/60`，**不要复用一级导航那块实底 accent**（两层同权重就白改了）；③内层那个是**「已删除任务」**视图，跟侧栏一级的「垃圾箱」不是一回事，别再改回「垃圾桶」 |
| 置顶态标识 | globals.css `.organize-pinned-chip` / `.organize-pinned-card`；用在 `components/reading/reading-card.tsx` 与 `components/notes/note-card.tsx` | 旧实现是卡片左缘一条 `before:w-1 bg-primary` 竖条，跟圆角/复选框抢位、暗色下几乎看不见，已删；新实现是 meta 行里的灰底 chip + 卡片一层极淡底色。**不要再往卡片左缘加竖条**（那个位置留给多选复选框） |
| 笔记标签页条 | `components/notes/note-tabs-bar.tsx` | 只在 `/notes/<id>` **且**有已开标签时渲染；`/notes` 列表页不渲染。前进/后退按钮与末尾「+」已删（列表页顶上摆一条只有导航按钮的空壳没有意义，新建笔记入口在页头「新建笔记」和侧栏「笔记」行的「+」两处都有） |
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
- **图标已收口（2026-09-17）**：源码零 `lucide-react` 引用，131 个文件统一从 `@/components/icons` 取图标；`lucide-react` 只剩 package.json 依赖项，可在后续 PR 摘掉。
- **`.ds-*` 组件类有意不采用**：Cairn 的 L1 原语是 shadcn/Radix 一套，TraeWork 只作亮色视觉参考（它没有暗色一份）。详见 [design-system-audit-2026-09-17.md](design-system-audit-2026-09-17.md) §3。
- **弱化文本靠 token 本身，不靠叠透明度**：`hsl(var(--muted-foreground) / 0.7x)` 这类"再淡一点"写法在浅灰底上会掉到 3:1 以下，`e2e/a11y-button-names.spec.ts` 的 C02 `color-contrast` 门禁会直接拦下（侧栏「待办」分段小标题就踩过一次：0.75 透明度实测 2.96:1，改回完整 token 后 4.78:1 亮 / 7.1:1 暗）。要更弱只能换 token 或改字号字重。
- **每个侧栏功能页都有页内搜索**：`/`（今天视图）`/library` `/notes` `/tasks` `/tasks/lessons` `/tasks/countdown` `/memos` `/favorites` `/trash` `/tags` `/plugins` `/graph` `/settings` `/shared` `/spaces`。唯一例外 `/tasks/calendar`。

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
5. 新增功能页 = 必须带页内搜索：走 `PageHeader` 的 `search` 槽 + `lib/search/page-search.ts`，口径固定为「本功能内的标题 + 标签」；确实不适用（如日历格子）要在 §4 的例外清单里写明原因。
6. 新增图标 = 先加 `scripts/ds-icon-map.json` 映射再跑生成脚本，不许在业务组件里内联 SVG，也不许重新引入第二套图标库。
