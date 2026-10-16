# 正式 UI 接入记录

日期：2026-10-15。分支：`feat/codex-ui-adoption`。本轮将 DESIGN.md 的中性灰方案接入正式 React 页面；`preview/index.html` 仍只是提案样稿，不能替代真实应用验收。

## 接入范围

| 层 | 正式实现 |
|---|---|
| 基础 | globals 明暗 token、运行时品牌色、根 ThemeBridge、按钮/输入/选择/复选框/菜单/弹层、焦点与减弱动态效果 |
| 导航 | 232/56px 侧栏、共享导航抽屉、手机52px顶栏、移除全局五入口底栏；条件共享入口、标签/笔记树/任务清单、原URL和快捷键保留 |
| 工作台 | 三视图、平面分区、全宽记录输入及下沿动作；草稿、账号隔离、IME、Shift+Enter和保存结果保持 |
| 资料库 | 五类视图、统一输入、平面资料行、阅读行、导入；快捷操作与标题链接分离，避免嵌套交互 |
| 笔记/阅读 | 默认主题去除局部旧品牌覆盖，标题/正文层级、列表与保存状态、阅读详情工具；用户显式选择的红蓝内容模板、字体、小字号、全宽、高亮色保持 |
| 待办 | 清单与侧面详情、独立详情、日/周/月/年、手机议程、日期弹层、倒数日、搜索、经验、依赖/完成状态 |
| 画布 | 正式 CanvasWorkspace 不替换；工具、属性面板滚动、焦点/触控、浮层和提示堆叠、原有工作区边界；世界坐标、版面/块、内容色板、CAS和手机只读规则保持 |
| 其余 | 收藏/标签、AI装饰图标、恢复结果、共享提示、认证表单、独立离线/严重错误、刘海面板的中性动作；设置/插件/垃圾箱/图谱沿用共享原语与主题 |

## 验证证据

下面为本地实际执行结果；不得将“接入”理解为所有设备与权限组合均已验收。PR 的完整 CI 仍是合并门禁。

- 类型检查：通过。
- 单元测试：218 文件通过，1 文件既有跳过；1676 用例通过，2 用例既有跳过。
- ESLint：零警告/错误。
- 隔离 mock 生产构建：通过，不读取或修改真实 `.env.local`。
- Playwright：工作台、资料库导入/分页、笔记模板、axe可访问性及画布布局/编辑/拖动回归已验证；73项组合回归中72项通过后修复最后的抽屉搜索焦点问题，最终 UI 专项13/13通过（25个路由状态 × 5种宽度 × 明暗、抽屉焦点、日历四模式、320/360/390px日期命中范围、笔记标题换行）。高亮深链及笔记首字输入额外2/2通过。分页测试等待实际追加，避免同时间戳的首屏条目误充完成信号。
- CUA 人工视觉：正式工作台、桌面日历/月周、390px手机议程/导航、笔记正文、正式画布与手机只读已核对；精选截图见下方。

## 明确保留与未验证项

用户标签、清单颜色、富文本/高亮/图表系列、画布内容样式与笔记红蓝模板是内容，允许彩色。错误、警告、成功保留语义色及文字，不是漏改。刘海双窗保持固定暗色与透明原生背景。

未在本轮本地浏览器中冒称完成：iOS Safari / Android 真机软键盘与安全区、Tauri 原生双窗/拖拽、真实上传/AI服务、真实权限与多人并发。相关保存、权限和数据库协议未更改；既有 CI 合同仍须通过。所有视觉改动可回退对应 squash 提交，不涉及数据迁移。

## 模型分工

按用户要求，基础原语/局部细节由 GPT-6 Luna，壳与响应式由 GPT-6.1 Sol，覆盖差距审查由 GPT-6 Astra 完成首批产出。中途调用触发账户额度限制，由主会话整合和补完；额度恢复后再次由 GPT-6 Astra 进行最终审查，4项P2均修复并复核关闭（日期命中重叠、速读实体字符、深色表格开关、错误页焦点）。GPT-6.1 Sol 随后核对最终实现与验证记录，未发现新阻断，发现的设置页及地图旧色名说明也已修正。没有把未执行的切换计为已执行。

## 正式应用截图

以下来自隔离 mock 生产构建。截图的示例数据不是生产账号资料；手机截图是浏览器尺寸验证。

| 页面 | 浅色 | 深色 |
|---|---|---|
| 工作台 | [桌面](screenshots/adopted/home-desktop-light.png) | [手机](screenshots/adopted/home-mobile-dark.png) |
| 桌面日历 | [截图](screenshots/adopted/calendar-desktop-light.png) | [截图](screenshots/adopted/calendar-desktop-dark.png) |
| 手机议程 | [截图](screenshots/adopted/calendar-mobile-light.png) | [截图](screenshots/adopted/calendar-mobile-dark.png) |
| 笔记正文 | [桌面](screenshots/adopted/note-desktop-light.png)、[手机](screenshots/adopted/note-mobile-light.png) | [桌面](screenshots/adopted/note-desktop-dark.png) |
| 正式画布 | [桌面](screenshots/adopted/canvas-desktop-light.png) | [桌面](screenshots/adopted/canvas-desktop-dark.png)、[手机只读](screenshots/adopted/canvas-mobile-dark.png) |
| 手机导航 | — | [截图](screenshots/adopted/navigation-mobile-dark.png) |
