# Organize 全面功能增强与体验优化 - Product Requirement Document

## Overview
- **Summary**: 对 Organize（稍后读+笔记+待办+经验总结工具）进行 36 项功能增强和体验优化，涵盖效率工具（命令面板、全文搜索、今日视图）、阅读增强、任务增强、经验学习、创意功能、UI/交互打磨、数据管理等七大方向。
- **Purpose**: 将 Organize 从一个基础的"稍后读+笔记"原型，打磨为一个功能完整、交互流畅、具备知识管理能力的生产力工具。
- **Target Users**: 个人知识工作者、开发者、学生——需要统一管理阅读资料、待办事项、学习笔记和经验复盘的用户。

## Goals
- **G1** 提升核心工作流效率：通过命令面板、今日视图、全文搜索、撤销操作让日常使用更流畅
- **G2** 丰富阅读体验：高亮批注、目录导航、阅读时间预估、速读模式、智能排序
- **G3** 完善任务管理：子任务、截止提醒、详情页、艾森豪威尔矩阵、重复任务、日历视图、拖拽
- **G4** 强化学习闭环：间隔复习、每周复盘、随机回顾、经验模板
- **G5** 增加差异化/创意功能：AI 问答、知识图谱、每日笔记、速记浮窗、热力图、RSS
- **G6** 打磨 UI/交互：空状态、移动端滑动、拖拽排序、面包屑、快捷键
- **G7** 完善数据管理：导入、导出、回收站

## Non-Goals (Out of Scope)
- 多人协作/团队功能（产品定位是个人工具）
- 富文本笔记编辑器核心改造（另一 Agent 正在做，避免冲突）
- 移动端原生 App（Capacitor 骨架已有但不做完整实现）
- 桌面端 Tauri 功能完善（骨架已有但不做完整实现）
- 支付/订阅/账户体系
- 浏览器扩展（虽然 RSS 相关，但不做浏览器扩展本身）
- 笔记编辑器核心功能变更（不修改 tiptap-editor.tsx、block-action-menu.tsx、notes/[id]/page.tsx）

## Background & Context
- 项目使用 Next.js 14 App Router + React 18 + TypeScript + Tailwind CSS + Supabase
- UI 组件基于 Radix UI 构建了一套 shadcn 风格组件
- 已有 cmdk（命令面板库）、zustand（状态管理）、@tiptap/extension-highlight（高亮扩展）
- 卡片交互已统一为 `hover:bg-accent`（粉色底），主题色为橙红色系（hsl(16,85%,50%)）
- Mock 模式通过内存数据驱动 UI，无真实后端时也可开发
- 已实现模块：收集箱、阅读库（含详情）、笔记列表+详情（编辑器由另一 Agent 维护）、标签管理、待办任务、经验总结、统计、插件系统、分享、离线支持

## Functional Requirements

### 效率工具（P0 - 最高优先级）
- **FR-1**: 今日视图 Dashboard — 应用首页，聚合今日到期任务、进行中任务、待读文章推荐、最近笔记、待复盘任务
- **FR-2**: 全局命令面板 Cmd+K — 基于 cmdk 的搜索+操作框，支持跳转页面、新建（任务/笔记/URL）、搜索内容
- **FR-3**: 全文搜索 — 跨阅读/笔记/任务/经验的统一搜索，高亮匹配片段
- **FR-4**: 撤销操作 Toast — 删除/完成等操作后底部弹出 Toast 带"撤销"按钮
- **FR-5**: 右键菜单 — 列表页卡片右键弹出快捷操作菜单
- **FR-6**: 批量操作 — 列表页支持多选 + 批量打标签/删除/改状态
- **FR-7**: 双向链接 Wiki Links — 笔记/经验里 `[[` 可链接到其他内容，详情页显示反链（注意：不修改编辑器核心，用只读方式在详情页处理）

### 阅读增强（P1）
- **FR-8**: 阅读高亮批注 — 阅读页选中文字弹出气泡，可高亮+批注（批注自动关联为笔记）
- **FR-9**: 阅读目录 TOC — 长文章自动生成侧边目录，点击跳转，滚动高亮
- **FR-10**: 阅读时间预估 — 卡片显示预计阅读时间，详情页有进度条+已读时间
- **FR-11**: Bionic Reading 速读模式 — 加粗单词前半字母辅助速读
- **FR-12**: 智能队列排序 — 根据优先级/时间/置顶自动排序，"推荐下一篇"按钮

### 任务增强（P1）
- **FR-13**: 子任务 Checklist — 任务可添加子任务，进度条按子任务比例
- **FR-14**: 截止提醒 — 到期/逾期任务红色提醒，浏览器通知
- **FR-15**: 任务详情页 — 独立详情页，含描述、关联内容、子任务、时间记录
- **FR-16**: 艾森豪威尔矩阵视图 — 四象限看板
- **FR-17**: 重复任务 — 每天/每周/每月重复
- **FR-18**: 拖拽排序+日历视图 — 看板拖拽改状态/排序，日历视图显示到期任务

### 经验/学习增强（P2）
- **FR-19**: 间隔复习 — 经验记录后按 1/3/7/30 天安排复习，标记记住/再看
- **FR-20**: 每周复盘自动生成 — 自动聚合本周数据，生成周报可编辑保存
- **FR-21**: 随机回顾 — "随机一条"按钮从历史中抽取内容复习
- **FR-22**: 经验模板 — KPT/PDCA/STAR 等模板一键套用

### 创意/高级功能（P2-P3）
- **FR-23**: AI 知识库问答（RAG） — 接入 AI，基于用户资料库回答问题
- **FR-24**: 知识图谱视图 — 可视化标签/关联关系节点图
- **FR-25**: 每日笔记 — Daily Note 页面，自动聚合当天活动
- **FR-26**: 速记浮窗 — 全局快捷键弹出迷你输入框速记
- **FR-27**: 阅读热力图/Streak — GitHub 风格贡献图
- **FR-28**: RSS 订阅源 — 支持 RSS/Atom 订阅，新文章自动入收集箱

### UI/交互打磨（P1，穿插在各功能中实现）
- **FR-29**: 空状态引导 — 各模块空列表显示插画+引导按钮
- **FR-30**: 移动端滑动操作 — 卡片左滑显示快捷操作
- **FR-31**: 拖拽排序 — 看板/标签/导航项拖拽
- **FR-32**: 面包屑导航 — 详情页显示层级路径
- **FR-33**: 快捷键扩展 — 更多快捷键支持

### 数据管理（P2）
- **FR-34**: 数据导入 — 从 Cubox/Notion/Pocket/Raindrop HTML/JSON 导入
- **FR-35**: 全量导出 — 导出为 Markdown 压缩包
- **FR-36**: 回收站 — 删除内容 30 天内可恢复

## Non-Functional Requirements
- **NFR-1**: 类型安全 — 所有代码通过 `npx tsc --noEmit` 零错误
- **NFR-2**: 性能 — 命令面板呼出 <100ms，全文搜索结果 <300ms（mock 模式）
- **NFR-3**: 深色模式兼容 — 所有新组件必须完美适配浅色/深色主题
- **NFR-4**: 主题色一致性 — 所有颜色使用 CSS 变量（primary/accent），禁止硬编码颜色
- **NFR-5**: 移动端适配 — 所有新页面必须响应式，断点兼容 375px+
- **NFR-6**: Mock 模式兼容 — 所有新数据功能必须支持 mock 客户端（直接用 Supabase client 查询）
- **NFR-7**: 交互一致性 — 卡片统一 `hover:bg-accent transition-colors duration-150`，无悬浮阴影

## Constraints
- **Technical**: Next.js 14 App Router, React 18, TypeScript, Tailwind CSS, Supabase, zustand
- **Code Isolation**: 不修改笔记编辑器核心文件（tiptap-editor.tsx, block-action-menu.tsx, notes/[id]/page.tsx, tiptap-*.tsx 扩展等）
- **Package Manager**: 只使用 pnpm，不引入 npm/yarn
- **Dependencies**: 优先使用已有依赖（cmdk 已有），新增第三方依赖需谨慎评估
- **Branch**: 所有改动在 `feature/other-improvements` 分支上进行

## Assumptions
- 用户使用本地 Supabase 或 mock 模式开发
- 命令面板使用已安装的 `cmdk` 库
- 浏览器通知需要用户授权，授权失败时静默降级
- AI 功能（RAG/自动标签）使用已有插件 SDK 模式，需要用户配置 API key
- RSS 解析使用简单的 XML 解析（可引入 fast-xml-parser 等轻量库）
- 知识图谱使用 SVG/Canvas 自行实现，不引入重型图表库（如 D3）以避免包体积膨胀
- 间隔复习、重复任务等功能可通过客户端逻辑+Supabase 表字段实现，无需额外服务

## Acceptance Criteria

### AC-1: 今日视图 Dashboard
- **Given**: 用户已登录并打开应用
- **When**: 访问首页 `/` 或点击侧边栏"今日"
- **Then**: 显示今日到期任务（含逾期标记）、进行中任务、待读推荐、最近笔记、待复盘条目、快捷新建按钮
- **Verification**: `human-judgment`

### AC-2: 命令面板 Cmd+K
- **Given**: 用户在应用任意页面
- **When**: 按下 `Cmd+K`（Mac）/`Ctrl+K`（Windows）
- **Then**: 命令面板弹出，可输入搜索内容、看到跳转命令、新建命令，支持键盘导航（↑↓EnterEsc）
- **Verification**: `programmatic` + `human-judgment`

### AC-3: 全文搜索
- **Given**: 用户在命令面板或搜索页输入关键词
- **When**: 输入 2 个以上字符
- **Then**: 实时展示匹配的阅读/笔记/任务/经验条目，高亮匹配文字片段
- **Verification**: `human-judgment`

### AC-4: 撤销 Toast
- **Given**: 用户执行了删除、标记完成等可撤销操作
- **When**: 操作成功
- **Then**: 底部弹出 Toast 显示操作结果和"撤销"按钮，点击撤销可恢复操作，Toast 5 秒后自动消失
- **Verification**: `programmatic` + `human-judgment`

### AC-5: 右键菜单
- **Given**: 用户在列表页
- **When**: 右键点击任意卡片
- **Then**: 弹出上下文菜单，显示打开、置顶、标签、删除等快捷操作
- **Verification**: `human-judgment`

### AC-6: 批量操作
- **Given**: 用户在列表页
- **When**: 长按卡片或点击批量选择按钮
- **Then**: 进入多选模式，可勾选多个卡片，批量操作栏显示可用操作（标签、删除、改状态）
- **Verification**: `human-judgment`

### AC-7: 双向链接
- **Given**: 笔记或经验内容包含 `[[标题]]` 格式的引用
- **When**: 在笔记/经验详情页查看
- **Then**: 引用变为可点击链接（在不修改编辑器核心的前提下，使用渲染后 DOM 处理或在只读视图中解析），详情页底部显示反链
- **Verification**: `human-judgment`

### AC-8: 阅读高亮批注
- **Given**: 用户在阅读详情页
- **When**: 选中正文文字
- **Then**: 弹出气泡菜单，支持高亮颜色选择和添加批注
- **Verification**: `human-judgment`

### AC-9: 阅读目录
- **Given**: 用户在阅读一篇有 h2/h3 标题的长文章
- **When**: 打开阅读详情页
- **Then**: 侧边显示 TOC 目录，点击跳转对应位置，滚动时当前章节高亮
- **Verification**: `human-judgment`

### AC-10: 阅读时间预估
- **Given**: 阅读条目有正文内容
- **When**: 在阅读库卡片或详情页查看
- **Then**: 显示预计阅读分钟数（基于字数÷200字/分钟中文，英文÷250词/分钟）
- **Verification**: `programmatic`

### AC-11: Bionic Reading
- **Given**: 用户在阅读详情页
- **When**: 点击速读模式切换按钮
- **Then**: 正文中的单词/中文字词前半部分加粗显示
- **Verification**: `human-judgment`

### AC-12: 智能排序
- **Given**: 用户在阅读库或任务列表
- **When**: 选择"智能排序"视图
- **Then**: 条目按置顶>到期时间>优先级>创建时间排序，有"推荐下一篇"快捷按钮
- **Verification**: `human-judgment`

### AC-13: 子任务
- **Given**: 用户创建或编辑任务
- **When**: 添加子任务
- **Then**: 任务卡片和详情页显示子任务清单，完成进度按子任务比例显示
- **Verification**: `programmatic` + `human-judgment`

### AC-14: 截止提醒
- **Given**: 有任务即将到期或已逾期
- **When**: 用户打开应用
- **Then**: 今日视图/侧边栏显示红色提醒徽章，已授权通知时发送浏览器通知
- **Verification**: `human-judgment`

### AC-15: 任务详情页
- **Given**: 用户点击任务卡片
- **When**: 进入 `/tasks/[id]`
- **Then**: 显示完整任务信息：标题、描述、状态/优先级/分类、子任务、关联内容、时间记录、操作按钮
- **Verification**: `human-judgment`

### AC-16: 艾森豪威尔矩阵
- **Given**: 用户在任务页切换到矩阵视图
- **When**: 切换视图
- **Then**: 显示四象限（重要紧急/重要不紧急/不重要紧急/不重要不紧急），任务卡片按优先级+状态分布
- **Verification**: `human-judgment`

### AC-17: 重复任务
- **Given**: 创建任务时设置重复规则
- **When**: 任务标记为完成
- **Then**: 自动创建下一期任务（按重复规则计算新截止日期）
- **Verification**: `programmatic`

### AC-18: 拖拽排序+日历视图
- **Given**: 用户在看板视图
- **When**: 拖拽卡片到不同列或同一列内排序
- **Then**: 状态/排序即时更新；日历视图显示到期任务分布
- **Verification**: `human-judgment`

### AC-19: 间隔复习
- **Given**: 用户创建经验条目
- **When**: 经验创建后
- **Then**: 系统按 1/3/7/30 天安排复习提醒，今日视图显示待复习条目，可标记"记住了"/"再看看"
- **Verification**: `programmatic` + `human-judgment`

### AC-20: 每周复盘
- **Given**: 用户访问复盘页面或系统定时生成
- **When**: 查看每周复盘
- **Then**: 自动汇总本周阅读数量、完成任务、新增笔记/经验，可编辑后保存为经验条目
- **Verification**: `human-judgment`

### AC-21: 随机回顾
- **Given**: 用户在今日视图或经验页
- **When**: 点击"随机回顾"按钮
- **Then**: 随机展示一条历史笔记或经验内容
- **Verification**: `human-judgment`

### AC-22: 经验模板
- **Given**: 用户新建经验
- **When**: 选择模板（KPT/PDCA/STAR）
- **Then**: 编辑器预填充模板结构
- **Verification**: `human-judgment`

### AC-23: AI 知识库问答
- **Given**: 用户已配置 AI API key
- **When**: 在问答界面提问
- **Then**: AI 基于用户资料库内容生成回答，标注引用来源
- **Verification**: `human-judgment`（依赖外部 API，mock 模式下显示 stub 响应）

### AC-24: 知识图谱
- **Given**: 用户有一定数量的标签和内容
- **When**: 访问图谱页面
- **Then**: 显示可交互的节点图，标签为大节点，内容为小节点，同标签/关联间有连线
- **Verification**: `human-judgment`

### AC-25: 每日笔记
- **Given**: 用户访问 Daily Note
- **When**: 打开 `/daily/[date]`
- **Then**: 自动聚合当天创建/完成的任务、阅读、笔记，提供速记区域
- **Verification**: `human-judgment`

### AC-26: 速记浮窗
- **Given**: 用户在任意页面
- **When**: 按下全局快捷键 `Cmd+Shift+O`
- **Then**: 弹出迷你输入框，可快速记录想法/添加任务/粘贴链接，不离开当前页面
- **Verification**: `human-judgment`

### AC-27: 阅读热力图
- **Given**: 用户有历史阅读/完成记录
- **When**: 访问统计页
- **Then**: 显示 GitHub 风格的年度热力图，颜色深浅表示当天活跃程度
- **Verification**: `human-judgment`

### AC-28: RSS 订阅
- **Given**: 用户添加了 RSS 源
- **When**: RSS 源有新文章
- **Then**: 新文章自动出现在收集箱，可管理订阅源列表
- **Verification**: `human-judgment`

### AC-29: 空状态引导
- **Given**: 任意模块列表为空
- **When**: 访问空列表页
- **Then**: 显示友好的空状态提示（图标+文字+行动按钮），无空白区域
- **Verification**: `human-judgment`

### AC-30: 移动端滑动操作
- **Given**: 用户在移动设备上访问列表页
- **When**: 左滑卡片
- **Then**: 显示删除/完成/置顶等快捷操作按钮
- **Verification**: `human-judgment`

### AC-31: 拖拽排序
- **Given**: 用户在支持排序的视图（看板、标签列表）
- **When**: 拖拽项目
- **Then**: 项目位置更新，排序持久化
- **Verification**: `human-judgment`

### AC-32: 面包屑导航
- **Given**: 用户在详情页
- **When**: 查看页面顶部
- **Then**: 显示面包屑路径（如"首页 > 阅读库 > 文章标题"），可点击跳转
- **Verification**: `human-judgment`

### AC-33: 快捷键扩展
- **Given**: 用户在应用中
- **When**: 使用对应快捷键（g+k 待办、g+e 经验、j/k 导航等）
- **Then**: 执行对应操作，快捷键帮助面板（?键）列出所有快捷键
- **Verification**: `programmatic` + `human-judgment`

### AC-34: 数据导入
- **Given**: 用户有其他服务的导出文件（HTML/JSON）
- **When**: 在设置页选择文件导入
- **Then**: 解析文件并创建对应的阅读条目/标签，显示导入进度和结果
- **Verification**: `programmatic` + `human-judgment`

### AC-35: 全量导出
- **Given**: 用户点击导出按钮
- **When**: 触发导出
- **Then**: 生成 Markdown 压缩包供下载，包含所有笔记/经验/阅读元数据/任务
- **Verification**: `programmatic`

### AC-36: 回收站
- **Given**: 用户删除了某条内容
- **When**: 访问回收站页面
- **Then**: 显示 30 天内删除的内容，可恢复或永久删除
- **Verification**: `human-judgment`

## Open Questions
- [ ] FR-8 阅读高亮批注的存储方式：新建 highlights 表还是复用 notes？建议新建 highlights 表关联 reading_item_id
- [ ] FR-23 AI RAG 是否需要嵌入向量？一期可做简单关键词匹配+上下文窗口拼接，后续再加向量
- [ ] FR-28 RSS 是服务端定时抓取还是客户端触发？建议客户端触发+简易服务端缓存
- [ ] FR-7 双向链接在不修改编辑器核心的情况下如何实现 `[[` 自动补全？一期只做渲染时解析为链接+反链列表
- [ ] 日历视图用什么组件？建议自研简单月历视图，不引入重型日历库
- [ ] 知识图谱是否需要引入力导向图库？建议使用轻量方案，不引入 d3-force
