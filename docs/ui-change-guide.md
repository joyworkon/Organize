# UI 可持续改版地图（ui-change-guide）

编制：2026-09-13。代码基线：master `e514eee`（C01 卡交付）。
计划卡：[long-term-agent-plan-2026-09-11.md §5 C01](long-term-agent-plan-2026-09-11.md)。
用途：改任何界面之前，先在这份地图上定位「改哪里、会牵动哪里」。本文随大改版 PR 更新（规则见 §6）。

## 1. 分层地图（自上而下的依赖方向：上层改不影响下层，下层改牵动上层）

| 层 | 内容 | 唯一入口文件 |
|---|---|---|
| L0 token | 语义色/圆角/阴影 CSS 变量、`.dark` 覆盖、编辑器节奏变量 | `app/globals.css`（:14-90 语义色与暗色；:39-54 圆角阴影；:985-1002 编辑器 prose 色映射；:2177-2259 `--organize-*` 节奏与侧栏宽） |
| L0+ 主题色 | 5 套品牌色 inline 覆盖 primary/ring（D02 后 accent 不随品牌） | `hooks/use-theme-color.ts`（COLORS :20-83，applyThemeColor :87-98，持久化 key `organize:theme-color`） |
| L1 原语 | button/dialog/dropdown/select/popover/toast/command 等 18 件 | `components/ui/*`（**全站唯一**，无第二套 Button/Dialog——自查结论见 §5） |
| L2 业务组件 | 侧边栏/移动壳/命令面板/编辑器/反链面板等 | `components/layout/*`、`components/notes/*`、`components/editor/*`、`components/share/*` |
| L3 壳 | (main) 路由组装：侧边栏+移动壳+命令面板+全局热键 | `app/(main)/layout.tsx`（:25-45 固定顺序：MobileNavigation → Sidebar → GlobalHotkeys → CommandPalette → Toaster → main(NoteTabsBar) → 桥接器群） |
| L4 路由 | 页面 | `app/(main)/**/page.tsx`；独立壳：`app/desktop/notch/page.tsx`（Tauri 刘海，不在 (main) 内） |

**铁律**：改观感只动 L0/L0+（token + 主题色）；改交互只动 L1/L2；改信息架构才动 L3/L4。

## 2. 「改哪里影响哪里」速查

| 想改的东西 | 要动的文件 | 会被牵动的暗面 |
|---|---|---|
| 品牌色 | `hooks/use-theme-color.ts` 的 COLORS（明暗成对） | inline 变量**覆盖** globals.css 的 `--primary`——只改 CSS 变量不生效；MutationObserver 重放逻辑（:105-128）必须保持 |
| 暗色模式 | globals.css `.dark` 块 | tailwind.config.ts `darkMode: ["class"]`；theme-toggle 切 html class；color-scheme（globals.css:97-102） |
| 圆角/阴影 | `--radius-*` / `--shadow-*` | `@supports (corner-shape)` 连续曲率层（:59-63） |
| 编辑器排版节奏 | `--organize-editor-padding` / `--organize-gutter` / `--organize-block-gap`（:2182-2188） | 移动端覆盖值在 :4581-4589 成对存在；prose 色映射 :985-1002 被历史版本预览与公开分享页共用 |
| 侧边栏宽度/折叠 | `--organize-sidebar-width`（:2256）+ `data-sidebar-collapsed`（:2258） | sidebar.tsx 折叠写 data 属性（:144,197-202） |
| 导航分组/顺序 | sidebar.tsx `navItems`（:53-61）+ 条件项（:116-127） | **四处入口需同步**：命令面板 NAV_ITEMS（command-palette.tsx:77-90）、移动底栏 `MOBILE_DESTINATIONS`（lib/navigation/mobile.ts:3-9）、g 前缀快捷键（global-hotkeys.tsx:86-108）、帮助弹窗清单（:33-71）。图谱/插件非一级入口（收进笔记页工具行/设置页，注释 :50-52） |
| 移动底栏五模块 | lib/navigation/mobile.ts | mobile-bottom-bar.tsx 渲染；详情路由与键盘弹出隐藏逻辑在 mobile-navigation.tsx:72,87 |
| 壳断点 | 767px（mobile.css @media + matchMedia） | **单断点体系**：`md:`（768px）分桌面/移动；新增第二断点需同时动 mobile.css、mobile-navigation.tsx:39、sidebar 的 md: 类 |
| 快捷键 | global-hotkeys.tsx（g 序列/`?` 帮助）、command-palette.tsx:339-352（⌘K） | `lib/hooks/use-hotkey.ts` 是唯一注册器：isTypingTarget 输入屏蔽、1.5s 序列 buffer、hasOpenDialog 弹层让位——新键位必须走它，不得自行 addEventListener |
| 新增按钮/对话框 | 一律 `components/ui/button|dialog` | 禁止第二套实现（现状核查：无 `.btn` 类、无原生 dialog；裸 `<button>` 仅限一次性图标按钮，如 theme-toggle.tsx:26-37） |
| 笔记页设置（全宽/字体/小字号） | note-page-menu.tsx → page.tsx :1266-1279 contentClassName + 根类 | CSS 生效点 globals.css:116-146；持久化 note-save-session.ts:664-667 与 local-draft.ts 成对 |
| 角色可见性 | lib/collab/roles.ts（owner/editor/viewer + saveRpcNameForRole）、lib/notes/capabilities.ts | 分流点集中在 notes/[id]/page.tsx（:1295/:1312/:1340/:1387/:1410/:1426-1428/:1496）；note-page-visuals.tsx:20；分享面板 components/share/resource-share-dialog.tsx（owner 才能改授权） |
| 表格配色/边框 | `data-table-color` 变量组（globals.css:1128-1190） | editor/extensions/table-style.ts 持久化属性成对 |

## 3. 功能入口追踪表（卡面验收：每个主要功能入口可追踪）

| 功能 | 路由 | 侧边栏 | 移动底栏 | 命令面板 | 快捷键 |
|---|---|---|---|---|---|
| 工作台 | `/` | ✓ 首项 | ✓ 首页 | ✓ 导航节 | g h |
| 稍后读 | `/library` | ✓（含标签子列表） | ✓ 阅读 | ✓ | g i / g l |
| 笔记 | `/notes` | ✓（含笔记树） | ✓ 笔记 | ✓ | g n |
| 待办 | `/tasks` | ✓（含清单） | ✓ 待办 | ✓ | g d |
| 经验 | `/tasks/lessons` | （tab） | （tab） | ✓ | g e |
| 速记 | `/memos` | ✓ | ✓ | ✓ | g m |
| 图谱 | `/graph` | ✗（笔记页工具行） | ✗ | ✓ | g g |
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
- 无全局 useMobile hook——matchMedia 仅 mobile-navigation.tsx:39 与 theme-toggle.tsx:12 两处内联；如需第三处，先抽 hook 再用。
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
