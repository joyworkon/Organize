# Organize 全面功能增强 - Implementation Plan

按优先级和依赖关系分四批实现，每批完成后提交验证。

---

## 第一批：效率核心（P0） — 影响最大、使用最频繁

### [ ] T1: 撤销操作 Toast 组件
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 创建通用 Toast 组件（基于 Radix UI 或自行实现的固定定位+动画组件）
  - 创建 `useToast` hook（zustand store），支持添加 toast、自动消失、手动关闭
  - Toast 支持 action 按钮（用于"撤销"）
  - 在 layout 中添加 Toast 容器
  - 在删除/完成等操作处集成撤销逻辑
- **Acceptance Criteria Addressed**: AC-4
- **Test Requirements**:
  - `programmatic` TR-1.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-1.2: 点击删除卡片后底部出现 Toast，点击"撤销"卡片恢复
  - `human-judgment` TR-1.3: 深色模式下 Toast 样式正常
- **Notes**: 参考 shadcn/ui Toast 设计，自行实现避免引入额外依赖。zustand store 管理 toast 队列。

### [ ] T2: 全局命令面板（Cmd+K）
- **Priority**: high
- **Depends On**: T1
- **Description**:
  - 基于已有的 `cmdk` 库创建 Command 组件
  - 支持页面跳转命令（首页/收集箱/阅读库/笔记/待办/经验/标签/统计/设置）
  - 支持新建命令（新建任务/笔记/粘贴URL进入收集箱）
  - 支持全局搜索（前端过滤已有数据）
  - 键盘导航：↑↓ 选择、Enter 执行、Esc 关闭、Cmd+K 开关
  - 注册全局快捷键监听
- **Acceptance Criteria Addressed**: AC-2, AC-3
- **Test Requirements**:
  - `programmatic` TR-2.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-2.2: Cmd+K 呼出面板，输入可过滤命令和搜索内容
  - `human-judgment` TR-2.3: 键盘导航流畅，Enter 正确跳转/执行
- **Notes**: cmdk 已安装。搜索先做前端过滤（mock 数据量小），后续可加服务端搜索。

### [ ] T3: 空状态引导
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 为收集箱、阅读库、笔记列表、任务列表、经验列表、标签页创建空状态组件
  - 使用 lucide 图标 + 简洁文案 + 行动按钮
  - 替换所有"暂无数据"的简单文字为有引导的空状态
- **Acceptance Criteria Addressed**: AC-29
- **Test Requirements**:
  - `programmatic` TR-3.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-3.2: 各空列表显示友好的空状态，有行动按钮可直接新建
  - `human-judgment` TR-3.3: 深色模式样式正常

### [ ] T4: 今日视图 Dashboard
- **Priority**: high
- **Depends On**: T1, T2
- **Description**:
  - 创建 `/`（首页）路由，作为今日视图
  - 侧边栏"首页"指向今日视图
  - 区域划分：
    1. 今日概览（日期、完成率、连续天数）
    2. 今日到期 + 逾期任务（红色标记）
    3. 进行中任务
    4. 待读文章推荐（最新未读/置顶）
    5. 最近笔记（最近 5 条）
    6. 待复盘/待复习经验
    7. 快捷新建按钮（+任务 +笔记 +URL）
  - 移动端适配单列布局
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `programmatic` TR-4.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-4.2: 今日视图各区域正确加载数据，逾期红色标记
  - `human-judgment` TR-4.3: 深色模式正常，移动端响应式正常

### [ ] T5: 快捷键系统扩展
- **Priority**: high
- **Depends On**: T2
- **Description**:
  - 扩展 global-hotkeys.tsx，新增快捷键：
    - `g` 后按 `h/i/l/n/t/e/s` 跳转到各页面（goto 模式）
    - `c` 上下文感知新建（在任务页新建任务，在阅读页新建笔记等）
    - `j/k` 列表项上下导航（列表页）
    - `x` 勾选完成（列表页选中项）
    - `?` 显示快捷键帮助面板
  - 创建快捷键帮助面板 Dialog
- **Acceptance Criteria Addressed**: AC-33
- **Test Requirements**:
  - `programmatic` TR-5.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-5.2: 各快捷键正确工作，? 显示帮助面板
  - `human-judgment` TR-5.3: 不与 Cmd+K 等浏览器快捷键冲突

### [ ] T6: 面包屑导航
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 创建 Breadcrumb 组件
  - 在阅读详情、笔记详情（如果可访问）、任务详情、经验详情/编辑页添加面包屑
  - 面包屑可点击跳转上级页面
- **Acceptance Criteria Addressed**: AC-32
- **Test Requirements**:
  - `programmatic` TR-6.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-6.2: 详情页面包屑显示正确路径，点击跳转正确

---

## 第二批：功能完善（P1）— 阅读增强 + 任务增强

### [ ] T7: 阅读时间预估
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 创建工具函数 `estimateReadingTime(content: string, lang?: 'zh'|'en'): number`
  - 中文按 400 字/分钟，英文按 250 词/分钟
  - 在 ReadingCard 和阅读详情页显示预计阅读时间
  - 详情页阅读时记录实际阅读时间（基于 reading_progress 和页面停留时间）
- **Acceptance Criteria Addressed**: AC-10
- **Test Requirements**:
  - `programmatic` TR-7.1: 阅读时间工具函数对中英文内容返回合理数值
  - `programmatic` TR-7.2: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-7.3: 卡片和详情页正确显示阅读时间

### [ ] T8: 阅读目录 TOC
- **Priority**: high
- **Depends On**: None
- **Description**:
  - 从阅读正文 HTML 中提取 h2/h3 标题，生成目录树
  - 在阅读详情页右侧（桌面端）/底部抽屉（移动端）显示 TOC
  - 点击目录项平滑滚动到对应位置
  - 滚动时高亮当前所在章节（IntersectionObserver）
- **Acceptance Criteria Addressed**: AC-9
- **Test Requirements**:
  - `programmatic` TR-8.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-8.2: 有 h2/h3 的文章正确显示目录
  - `human-judgment` TR-8.3: 点击跳转正确，滚动高亮正确
  - `human-judgment` TR-8.4: 移动端 TOC 可通过按钮展开

### [ ] T9: Bionic Reading 速读模式
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 在阅读详情页添加"速读模式"切换按钮
  - 开启后对正文 HTML 进行处理：英文单词加粗前半部分（约前半字母），中文词加粗前半（基于简单分词或前半字数）
  - 切换时不修改原始 HTML，使用 DOM 包裹
- **Acceptance Criteria Addressed**: AC-11
- **Test Requirements**:
  - `programmatic` TR-9.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-9.2: 速读模式下文字前半加粗显示，切换流畅

### [ ] T10: 子任务 + 任务详情页
- **Priority**: high
- **Depends On**: T1
- **Description**:
  - 新建数据库迁移：tasks 表添加 `parent_id` 自引用外键（或新建 subtasks 表）；或用 checklist_items 表存储子任务
  - 更新共享类型
  - 创建任务详情页 `/tasks/[id]`
  - 详情页包含：标题编辑、描述编辑、状态/优先级/分类修改、子任务清单（可添加/勾选/删除）、关联阅读/笔记/经验、时间记录、操作按钮
  - TaskCard 显示子任务进度条
  - 更新 mock 数据支持子任务
- **Acceptance Criteria Addressed**: AC-13, AC-15
- **Test Requirements**:
  - `programmatic` TR-10.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-10.2: 任务详情页完整显示所有信息，子任务可增删勾选
  - `human-judgment` TR-10.3: 卡片显示子任务进度条

### [ ] T11: 截止提醒 + 浏览器通知
- **Priority**: medium
- **Depends On**: T4
- **Description**:
  - 在今日视图和侧边栏显示逾期/即将到期（24小时内）任务的红色徽章
  - 创建通知请求逻辑：首次使用时请求 Notification 权限
  - 应用加载时检查到期任务，发送浏览器通知（已授权时）
  - 通知点击跳转到任务详情
- **Acceptance Criteria Addressed**: AC-14
- **Test Requirements**:
  - `programmatic` TR-11.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-11.2: 逾期任务显示红色标记
  - `human-judgment` TR-11.3: 授权后通知正确弹出，点击跳转

### [ ] T12: 右键菜单
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 创建通用 ContextMenu 组件（基于 Radix DropdownMenu 或自研）
  - 在阅读卡片、笔记卡片、任务卡片、经验卡片上集成右键菜单
  - 菜单项：打开、置顶/取消置顶、编辑标签、分享、删除
  - 移动端长按照样触发（touch 事件）
- **Acceptance Criteria Addressed**: AC-5
- **Test Requirements**:
  - `programmatic` TR-12.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-12.2: 右键卡片弹出菜单，各操作正确执行
  - `human-judgment` TR-12.3: 移动端长按可触发

### [ ] T13: 批量操作
- **Priority**: medium
- **Depends On**: T1
- **Description**:
  - 各列表页（阅读库、笔记、任务、经验）添加多选模式
  - 入口：长按卡片或点击顶部"选择"按钮
  - 多选后底部出现操作栏：批量打标签、批量删除、批量改状态（任务）
  - 卡片显示 checkbox 选中状态
- **Acceptance Criteria Addressed**: AC-6
- **Test Requirements**:
  - `programmatic` TR-13.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-13.2: 多选模式流畅，批量操作正确执行
  - `human-judgment` TR-13.3: 移动端友好

### [ ] T14: 智能排序 + "推荐下一篇"
- **Priority**: medium
- **Depends On**: T7
- **Description**:
  - 阅读库添加"智能排序"选项：置顶 > 未读优先 > 添加时间
  - 任务列表智能排序：置顶 > 逾期 > 今日到期 > 优先级 > 创建时间
  - 在今日视图添加"推荐下一篇"按钮，随机推荐一篇高优先级未读文章
- **Acceptance Criteria Addressed**: AC-12
- **Test Requirements**:
  - `programmatic` TR-14.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-14.2: 智能排序逻辑正确
  - `human-judgment` TR-14.3: "推荐下一篇"打开推荐文章

---

## 第三批：学习闭环 + 高级功能（P2）

### [ ] T15: 经验模板
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 创建预设模板配置：KPT（Keep/Problem/Try）、PDCA（Plan/Do/Check/Act）、STAR（Situation/Task/Action/Result）、四象限反思
  - 在经验编辑页添加"使用模板"按钮
  - 选择模板后填充结构化内容（注意：不修改编辑器核心，用文本模板方式填充）
  - 更新 mock 数据
- **Acceptance Criteria Addressed**: AC-22
- **Test Requirements**:
  - `programmatic` TR-15.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-15.2: 选择模板后内容正确填充

### [ ] T16: 随机回顾
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 在今日视图和经验列表页添加"随机回顾"按钮
  - 从历史笔记+经验中随机抽取一条
  - 展示为卡片式弹窗或直接打开详情
  - 连续点击"下一条"切换
- **Acceptance Criteria Addressed**: AC-21
- **Test Requirements**:
  - `programmatic` TR-16.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-16.2: 点击随机按钮展示随机内容

### [ ] T17: 每周复盘自动生成
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 创建 `/review/weekly` 页面
  - 自动统计本周数据：阅读篇数（按状态）、完成任务数、新增笔记数、新增经验数
  - 列出本周完成的任务、读完的文章
  - 提供编辑区域写周总结
  - 保存为经验条目（类型为 reflection）
  - 在今日视图显示"生成本周复盘"入口（仅周末/周一显示）
- **Acceptance Criteria Addressed**: AC-20
- **Test Requirements**:
  - `programmatic` TR-17.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-17.2: 周复盘正确聚合本周数据
  - `human-judgment` TR-17.3: 保存后生成经验条目

### [ ] T18: 每日笔记 Daily Note
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 创建 `/daily/[date]` 页面（date 格式 YYYY-MM-DD，默认今天）
  - 页面自动聚合：当天完成的任务、当天新增的阅读、当天更新的笔记
  - 提供自由速记区域（可保存为一条笔记或经验）
  - 添加日期导航（前一天/后一天/日历选择）
  - 侧边栏添加"每日"入口
- **Acceptance Criteria Addressed**: AC-25
- **Test Requirements**:
  - `programmatic` TR-18.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-18.2: 每日笔记正确聚合当天数据
  - `human-judgment` TR-18.3: 日期导航工作正常

### [ ] T19: 间隔复习
- **Priority**: medium
- **Depends On**: T4
- **Description**:
  - 新建数据库迁移：lessons 表添加 `next_review_at`、`review_stage`（0-4，对应 1/3/7/30/90天）、`last_reviewed_at` 字段
  - 更新共享类型
  - 经验创建时设置 next_review_at 为 1 天后
  - 今日视图显示"待复习"区域
  - 复习界面展示经验内容，两个按钮："记住了"（推进到下一阶段）/"再看看"（重置到阶段1，1天后再复习）
  - 更新 mock 数据
- **Acceptance Criteria Addressed**: AC-19
- **Test Requirements**:
  - `programmatic` TR-19.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-19.2: 新经验 1 天后出现在待复习列表
  - `human-judgment` TR-19.3: "记住了"/"再看看"正确更新复习时间

### [ ] T20: 速记浮窗
- **Priority**: medium
- **Depends On**: T1
- **Description**:
  - 创建 QuickCapture 浮窗组件（居中 Dialog，输入框+选项）
  - 全局快捷键 `Cmd+Shift+O` 呼出
  - 支持三种速记类型：添加任务（快捷输入标题）、粘贴链接（进入收集箱）、速记想法（保存为笔记或经验）
  - 提交后关闭浮窗，Toast 提示成功
  - 不离开当前页面
- **Acceptance Criteria Addressed**: AC-26
- **Test Requirements**:
  - `programmatic` TR-20.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-20.2: Cmd+Shift+O 呼出浮窗
  - `human-judgment` TR-20.3: 三种速记类型正确工作，Toast 提示

### [ ] T21: 阅读热力图/Streak
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 在统计页添加年度热力图组件（类似 GitHub 贡献图）
  - 统计每天的"活动量"：阅读了文章+完成任务+写了笔记/经验
  - 显示连续天数（Streak）
  - 鼠标悬停显示当天详情
  - 使用 SVG 绘制（53周×7天格子）
- **Acceptance Criteria Addressed**: AC-27
- **Test Requirements**:
  - `programmatic` TR-21.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-21.2: 热力图正确显示，颜色深浅表示活动量
  - `human-judgment` TR-21.3: 悬停显示详情

### [ ] T22: 双向链接反链（只读）
- **Priority**: low
- **Depends On**: None
- **Description**:
  - 创建工具函数解析内容中的 `[[标题]]` 引用
  - 在笔记详情页底部和经验详情/查看页底部添加"引用/被引用"区域
  - 将 `[[标题]]` 在渲染时转为链接（查找匹配的笔记/经验/阅读/任务）
  - 反链：查找其他内容中引用了当前条目的内容
  - 注意：不修改编辑器核心，只在渲染后处理和详情页展示
- **Acceptance Criteria Addressed**: AC-7
- **Test Requirements**:
  - `programmatic` TR-22.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-22.2: `[[标题]]` 被渲染为链接
  - `human-judgment` TR-22.3: 详情页底部正确显示反链列表

---

## 第四批：高级/创意功能 + 数据管理（P2-P3）

### [ ] T23: 回收站
- **Priority**: high
- **Depends On**: T1
- **Description**:
  - 新建数据库迁移：为 reading_items/notes/tasks/lessons 添加 `deleted_at` 字段（软删除）
  - 更新所有查询过滤掉 `deleted_at IS NOT NULL` 的记录
  - 删除操作改为软删除（设置 deleted_at）
  - 创建回收站页面 `/trash`，列出所有已删除内容
  - 支持恢复（清除 deleted_at）和永久删除
  - 30 天以上已删除内容提示可永久删除
  - 更新 mock 数据支持软删除
- **Acceptance Criteria Addressed**: AC-36
- **Test Requirements**:
  - `programmatic` TR-23.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-23.2: 删除后内容不在列表显示，出现在回收站
  - `human-judgment` TR-23.3: 恢复后内容重新出现在原列表

### [ ] T24: 全量导出
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 创建 `/api/export` API 路由
  - 将所有笔记和经验转为 Markdown 格式（frontmatter 含元数据）
  - 阅读条目和任务导出为 JSON
  - 标签信息嵌入
  - 使用 JSZip（需安装）打包为 zip 下载
  - 在设置/侧边栏添加导出入口
- **Acceptance Criteria Addressed**: AC-35
- **Test Requirements**:
  - `programmatic` TR-24.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-24.2: 导出 zip 包含正确的 Markdown 和 JSON 文件
  - `programmatic` TR-24.3: 导出的 Markdown 包含正确的 frontmatter

### [ ] T25: 数据导入
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 创建导入页面/对话框
  - 支持 Pocket/Raindrop/Instapaper/Cubox 的 HTML 书签格式导入
  - 支持通用 JSON 导入（匹配 Organize 导出格式）
  - 解析 HTML 书签格式（`<DT><A>` 标签）
  - 导入进度显示，去重（URL 相同跳过）
  - 自动标记来源标签
- **Acceptance Criteria Addressed**: AC-34
- **Test Requirements**:
  - `programmatic` TR-25.1: HTML 书签解析函数正确提取 URL/标题/标签
  - `programmatic` TR-25.2: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-25.3: 导入后内容正确出现在收集箱/阅读库

### [ ] T26: 重复任务
- **Priority**: medium
- **Depends On**: T10
- **Description**:
  - 新建数据库迁移：tasks 表添加 `recurrence_rule`（jsonb，存频率/间隔/周几等）
  - 更新共享类型
  - 创建任务时可设置重复：每天/每周（选周几）/每月（选几号）/每月最后一天
  - 任务标记完成时检查 recurrence_rule，自动创建下一期任务
  - 更新 mock 数据
- **Acceptance Criteria Addressed**: AC-17
- **Test Requirements**:
  - `programmatic` TR-26.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-26.2: 每日重复任务完成后生成第二天的任务
  - `human-judgment` TR-26.3: 每周重复任务正确设置下一次日期

### [ ] T27: 艾森豪威尔矩阵视图
- **Priority**: medium
- **Depends On**: T10
- **Description**:
  - 在任务页添加"矩阵"视图选项
  - 四象限布局：重要紧急（高优先级+逾期/今日）、重要不紧急（高优先级+未来）、不重要紧急（中优先级+到期）、不重要不紧急（低优先级/无日期）
  - 每象限显示对应任务卡片
  - 桌面端 2x2 网格，移动端可滚动四象限
- **Acceptance Criteria Addressed**: AC-16
- **Test Requirements**:
  - `programmatic` TR-27.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-27.2: 任务按优先级/截止日期正确分布到四象限
  - `human-judgment` TR-27.3: 移动端可正常查看

### [ ] T28: 日历视图
- **Priority**: low
- **Depends On**: T10
- **Description**:
  - 创建简单的月历视图组件（不引入重型日历库）
  - 每一天显示到期任务数和已完成数
  - 点击某天展开当天任务列表
  - 在任务页添加"日历"视图选项
- **Acceptance Criteria Addressed**: AC-18
- **Test Requirements**:
  - `programmatic` TR-28.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-28.2: 日历正确显示月份和任务分布
  - `human-judgment` TR-28.3: 月份切换正常

### [ ] T29: 移动端滑动操作
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 为所有卡片（阅读/笔记/任务/经验）添加触摸滑动支持
  - 左滑显示操作按钮（完成/置顶/删除）
  - 使用 touchstart/touchmove/touchend 事件实现
  - 仅在移动端（<768px）启用
  - 滑动有弹性动画，可回弹
- **Acceptance Criteria Addressed**: AC-30
- **Test Requirements**:
  - `programmatic` TR-29.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-29.2: 移动端左滑显示操作按钮
  - `human-judgment` TR-29.3: 桌面端不受影响

### [ ] T30: 拖拽排序（看板）
- **Priority**: low
- **Depends On**: None
- **Description**:
  - 任务看板视图支持卡片拖拽到不同列（改变状态）
  - 同一列内支持拖拽排序
  - 使用原生 HTML5 Drag and Drop API（桌面端）
  - 移动端可暂时不支持拖拽或用按钮移动
  - 拖拽有视觉反馈
- **Acceptance Criteria Addressed**: AC-18, AC-31
- **Test Requirements**:
  - `programmatic` TR-30.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-30.2: 拖拽卡片到其他列正确更新状态
  - `human-judgment` TR-30.3: 列内拖拽正确更新排序

### [ ] T31: 阅读高亮批注
- **Priority**: medium
- **Depends On**: None
- **Description**:
  - 新建数据库迁移：highlights 表（id, user_id, reading_item_id, content, color, note, start_offset, end_offset, created_at）
  - 更新共享类型
  - 在阅读详情页，选中文字弹出气泡菜单
  - 支持 4 种高亮颜色（黄/绿/粉/蓝）
  - 可添加批注文字
  - 高亮在正文中显示为对应颜色背景
  - 右侧显示高亮列表，点击跳转
  - 更新 mock 数据
  - 注意：不修改编辑器核心，高亮在阅读视图中独立实现
- **Acceptance Criteria Addressed**: AC-8
- **Test Requirements**:
  - `programmatic` TR-31.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-31.2: 选中文字弹出高亮菜单
  - `human-judgment` TR-31.3: 高亮正确显示在正文中
  - `human-judgment` TR-31.4: 批注可查看

### [ ] T32: RSS 订阅源
- **Priority**: low
- **Depends On**: None
- **Description**:
  - 新建数据库迁移：feeds 表（id, user_id, url, title, last_fetched_at, created_at）、feed_items 表（关联 feed 和 reading_item）
  - 更新共享类型
  - 创建 RSS 源管理页面 `/feeds`
  - 支持添加/删除 RSS 源
  - 创建 API 路由 `/api/feeds/refresh` 手动刷新 RSS
  - 使用 fast-xml-parser（需安装）解析 RSS/Atom XML
  - 新条目自动进入收集箱（去重）
  - 更新 mock 数据
- **Acceptance Criteria Addressed**: AC-28
- **Test Requirements**:
  - `programmatic` TR-32.1: RSS XML 解析函数正确提取条目标题/链接/摘要
  - `programmatic` TR-32.2: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-32.3: 添加 RSS 源后可刷新并导入新文章

### [ ] T33: AI 知识库问答（RAG 简化版）
- **Priority**: low
- **Depends On**: None
- **Description**:
  - 创建 `/ask` 页面或 Dialog
  - 简化版 RAG：用户提问时，搜索相关笔记和经验（关键词匹配标题+内容），取前 5 条作为上下文
  - 调用已有 AI 插件的 API（或直接调用 OpenAI 兼容接口）
  - 流式显示回答
  - 标注引用来源（链接到原笔记/经验）
  - Mock 模式下返回 stub 回答
  - 需要用户配置 API key（在设置页）
- **Acceptance Criteria Addressed**: AC-23
- **Test Requirements**:
  - `programmatic` TR-33.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-33.2: 提问后显示回答和引用来源
  - `human-judgment` TR-33.3: 无 API key 时提示配置

### [ ] T34: 知识图谱视图
- **Priority**: low
- **Depends On**: None
- **Description**:
  - 创建 `/graph` 页面
  - 使用 SVG 实现简单力导向图（不引入 d3）
  - 标签作为大节点（颜色区分），内容（阅读/笔记/任务/经验）作为小节点
  - 同标签的内容节点与标签节点连线
  - 关联关系（如任务关联阅读）也连线
  - 支持拖拽节点、缩放
  - 点击节点跳转到对应内容
  - 数据量小时展示效果好，数据量大时可缩放
- **Acceptance Criteria Addressed**: AC-24
- **Test Requirements**:
  - `programmatic` TR-34.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-34.2: 图谱正确显示标签和内容节点
  - `human-judgment` TR-34.3: 拖拽和缩放工作正常
  - `human-judgment` TR-34.4: 点击节点跳转正确

### [ ] T35: 拖拽排序扩展（标签/导航项）
- **Priority**: low
- **Depends On**: T30
- **Description**:
  - 标签管理页支持拖拽排序
  - 侧边栏导航项支持拖拽排序（自定义顺序）
  - 需要数据库迁移：tags 表加 sort_order 字段
  - 排序保存到数据库
- **Acceptance Criteria Addressed**: AC-31
- **Test Requirements**:
  - `programmatic` TR-35.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-35.2: 标签拖拽排序后顺序持久化

### [ ] T36: 最终检查与样式收尾
- **Priority**: high
- **Depends On**: All previous tasks
- **Description**:
  - 全量 TypeScript 类型检查
  - 深色模式全页面审查修复
  - 移动端响应式全页面审查
  - 主题色硬编码审查（确保无蓝紫色残留）
  - 所有空状态、Loading 状态、Error 状态检查
  - 提交代码
- **Acceptance Criteria Addressed**: All
- **Test Requirements**:
  - `programmatic` TR-36.1: `npx tsc --noEmit` 零错误
  - `human-judgment` TR-36.2: 所有页面深色/浅色模式显示正常
  - `human-judgment` TR-36.3: 所有页面移动端显示正常
  - `human-judgment` TR-36.4: 无硬编码颜色（使用主题色变量）
