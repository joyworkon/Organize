# 渐进迁移与验收

初版仅交付规范和隔离预览；用户随后确认统一方向并授权正式全站接入。本轮按下表接入基础层、壳、列表/详情和特殊工作区，实际证据与未验证项见 [接入记录](adoption-report.md)。以下阶段保留为后续改版的检查顺序。禁止将预览的localStorage、contenteditable、状态定时器或原生dialog视为生产实现。正式改版按特性分支+PR，CI通过才合并；设计规范更新不顺手变更数据模型/授权/保存协议。

## 责任映射（真实路径相对仓库根）

| 责任 | 接入位置 | 约束/相邻回归 |
|---|---|---|
| semantic token / prose /泳道 | `apps/web/app/globals.css`；`apps/web/tailwind.config.ts` | 本轮已映射中性明暗值，以 tokens.json 与实际 computed style 为准。保持textColor.primary到primary-text和primary-foreground子键。新token通过现变量映射，业务层不散写hex。 |
| inline品牌覆盖 | `apps/web/hooks/use-theme-color.ts`、`.test.ts` | applyThemeColor写四变量覆盖CSS。阶段1同时将BRAND_COLOR明暗值映射至中性primary/focus；保留MutationObserver、调用者与API；不可只改CSS导致运行时重回红色。测试里的PAGE_LIGHT/PAGE_DARK/CARD_DARK须同步底色，增加文字/焦点对比断言。 |
| 主题偏好 | `apps/web/hooks/use-theme-mode.ts`、`components/layout/theme-toggle.tsx`、`components/settings/appearance-section.tsx` | 保留organize-theme键、跟随系统=删键、theme-mode-change广播；不重置偏好。 |
| 原语 | `apps/web/components/ui/button.tsx`、`dialog.tsx`、`dropdown-menu.tsx`、`popover.tsx`、`command.tsx`、`input.tsx`等 | 一套Radix/shadcn，不安装Apps SDK UI/Tailwind4；改视觉变体与触控命中区。button accessible name、嵌套dismissable layer与FocusScope不变。 |
| 页头/搜索 | `components/layout/page-header.tsx`、`page-search.tsx`、`lib/search/page-search.ts` | 沿用唯一实现，CSS保留@layer components防止覆盖hidden；页内搜索与全局搜索语义分开。 |
| 全局壳/导航 | `app/(main)/layout.tsx`、`components/layout/sidebar.tsx`、`mobile-navigation.tsx`、`mobile-bottom-bar.tsx`、`app/mobile.css`、`lib/navigation/mobile.ts` | 768壳断点一致；drawer不是新导航数据源。sidebar/command-palette/global-hotkeys/mobile四处对齐；收藏辅助组、共享条件组保持源码语义。旧五入口底栏改为局部上下文工具；手机键盘打开时隐藏局部工具，safe-area继续生效。 |
| 全局命令/热键 | `components/command-palette.tsx`、`components/layout/global-hotkeys.tsx`、`lib/hooks/use-hotkey.ts` | 按实际文件位置查找导出，不另注册keydown；IME、输入屏蔽、弹层让位、g序列缓存保持。 |
| 工作台 | `components/dashboard/dashboard-hub.tsx`、`dashboard-layout.tsx`、`today-view.tsx`、`dashboard-capture.tsx`、`review-view.tsx`、`stats-view.tsx` | 只调整组合/密度；三视图与query保留。统计数据不重算，快速记录副作用不进setState updater。 |
| 资料库/集合 | `app/(main)/library/page.tsx`、`components/library/*`、`components/collections/*`、`lib/reading/collect.ts` | 五tab、collection深链、统一捕捉器与去重保存保留；文件上传与速记API/shim合同不改。 |
| 阅读 | `app/(main)/library/[id]/page.tsx`、`components/reading/digest-editor.tsx`、`highlights-panel.tsx`、`highlight-menu.tsx` | 阅读滚动progress、目录/高亮坐标、全宽偏好、整理稿和引用源状态不变。 |
| 笔记列表与树 | `app/(main)/notes/page.tsx`、`components/notes/note-card.tsx`、`note-groups-bar.tsx`、`note-tabs-bar.tsx` | 拖动分组、笔记树、opened/recent tabs存储、排序page-utils保留；列表页不显示空标签条。 |
| 笔记编辑/状态 | `app/(main)/notes/[id]/page.tsx`、`components/editor/tiptap-editor.tsx`、`bubble-toolbar.tsx`、`editor-popover.tsx`、`lib/notes/note-save-session.ts`、`hooks/use-note-session.ts` | 视觉只动CSS/壳/样式props，不能为排版重建editor实例。blockId、document JSON、revision/mutation、队列、角色RPC、ydoc保存顺序完全保持。不能在祖先加transform/contain导致浮层和drag坐标偏移。 |
| 历史/冲突/评论 | `components/notes/note-history-panel.tsx`、`note-history-preview.tsx`、`note-conflict-dialog.tsx`、`note-page-comments.tsx` | 侧面与sheet只变承载，恢复、冲突比较、评论锚点与权限不改；旧本地稿保全。 |
| 待办 | `app/(main)/tasks/*`、`components/tasks/task-inline-detail.tsx`、`task-dialog.tsx`、`task-card.tsx`、`task-filter-menu.tsx`、`task-sidebar.tsx` | 任务筛选Popover不嵌Radix Select；selectedTask打开时工具横滚不能overflow-hidden；task/list/scope query、子任务和依赖不变。 |
| 画布 | `components/canvas/canvas-workspace.tsx`、`canvas-viewport.tsx`、`canvas-property-bar.tsx`、`canvas-store.ts`、`canvas-hit-test.ts`、`use-is-narrow-viewport.ts` | 属性/工具可重排，viewport坐标/命中测试/CAS/拖动不改；手机只读沿用实际判断并与壳阈值对齐验证。 |
| 设置/共享/原生壳 | `components/settings/*`、`components/share/*`、`app/(main)/settings/page.tsx`、`app/s/[token]/page.tsx`、`app/desktop/notch/page.tsx` | AI key mask/SSRF、backup/restore、owner/editor/viewer、public claim/save、native双窗协议均不改。 |
| 图标 | `components/icons/ds-icons.generated.tsx`、`scripts/ds-icon-map.json`、`scripts/gen-ds-icons.mjs` | 原图标源码复用，新增映射后生成；不手写业务SVG path、不再引lucide。预览仅抽取现有生成SVG。 |

上表简写components/lib/hooks均位于apps/web下；命令面板实际路径见接入时rg定位（本次核验为components/command-palette.tsx）。任何路径变化先更新ui-change-guide，本表不以漂移行号定位。

## 阶段与退出条件

1. **规范锁定**：对六类预览做桌面/手机/浅暗评审，确认tokens、全路由表和保留合同。本阶段只有docs，不覆盖现有主题。退出：所有交互有作用、无外网依赖、所有可见控件有名称、JSON/CSS一致。
2. **基础层**：一个PR接入globals+BRAND_COLOR+原语，提供临时设计flag或可回退提交；主题偏好键不迁移。退出：明暗切换后computed styles仍为目标中性值、primary文本对比通过、主要现存界面无溢出。同步ui-change-guide实际现状。
3. **壳与列表**：一个PR处理sidebar/PageHeader/PageSearch/mobile drawer与上下文工具；再逐族资料库/笔记列表/待办。保留所有旧URL、query与命令入口。退出：手机44px目标、键盘可达、列表CRUD与搜索回归；不是一次修改所有页面class。
4. **正文与详情**：阅读、笔记、任务侧面；只调外壳与prose。保存会话/协作/TipTap结构不动。退出：缩放100/125/200%、滚动、选区bubble、列/表格/拖把/resize、输入法、未保存切页、离线恢复/冲突各验证。
5. **特殊工作区**：画布、图谱、公开分享、历史/评论、设置、auth、notch逐族；母token已稳定后再接。退出：画布手机只读、权限分支、public gate、原生拖拽和safe-area通过。
6. **清理**：删除被替代样式而不删除仍被深链使用的页面；记录例外、更新ui-change-guide和截图基线。退出：无第二套原语/热键/保存逻辑，无遗留红primary inline覆写。

每阶段只提交完成的可评审范围；失败可revert对应squash提交，不回滚数据/用户偏好。不把多个未完成阶段混进一个“统一改版”提交。

## 可验证测试矩阵

| 维度 | 最少覆盖 | 通过标准 |
|---|---|---|
| viewport | 390×844、430×932、768×1024、1024×768、1440×900；200% zoom | 列表/设置无整页横滚；正文≥可视宽-32；工具行可达；表格/画布局部滚动允许。 |
| theme | light/dark/system；重载；系统主题变更 | 主题键语义不变；inline与CSS目标一致；正文AA≥4.5、焦点/控件≥3。 |
| navigation | 真实所有路由表+query+legacy redirects；返回/前进/深链 | 选中项准确，旧memo/collection/task过滤不丢，关闭详情返回原视图与滚动。 |
| pointer/keyboard | mouse、touch、Tab/ShiftTab、Enter/Escape、方向键、中文拼音IME | hover功能focus/touch可达；模态焦点围住且返回；输入法Enter不提交；无无名图标按钮。 |
| data & network | 有数据/空/筛选空/慢/失败/离线/重连/冲突/只读 | 内容不闪白；可重试；保留本地稿；无假“已保存”；角色正确；状态配文字。 |
| editor | 标题/正文/粘贴/列/表格/附件/图片resize/块拖动/评论/历史/实时协作 | JSON和blockId不变；菜单定位不飘；无双重保存/跨笔记串稿，重载后内容一致。 |
| platforms | Chromium/WebKit、iOS Safari真机、Android Chrome真机、Tauri macOS | softkeyboard、safe-area、原生窗口拖动/刘海切换实际验收；浏览器尺寸模拟不冒称真机通过。 |

正式代码验证：pnpm统一包管理；`pnpm --filter @organize/web exec tsc --noEmit`、`pnpm --filter @organize/web test`及repo规定lint/build。视觉token改动至少跑use-theme-color/prose-contrast；编辑器变动跑editor-layout、block-interaction、相关collab E2E；mobileRoute与theme-mode契约测试保持。按真实e2e配置选择已有套件，不为了文档改动安装依赖或伪造通过记录。

PR证据：列影响层、前后浅暗截图、viewport与状态、测试命令结果、未覆盖真机项、回退方式；只能声称本PR正式路由已改动的部分。预览只验证设计表达和本地交互，不验证Supabase/RLS/上传/真实保存。
