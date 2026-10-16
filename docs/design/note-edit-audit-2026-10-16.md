# 笔记编辑与保存状态首轮审计

日期：2026-10-16。基线：master `f6119f6`。范围为笔记编辑页、保存会话 React 绑定和状态展示；列表、历史/评论、legacy 任务块绑定另行处理。

## 本轮修复

- 保存状态接入会话 phase，新增修改不沿用旧“已保存”；桌面和手机均显示 dirty、saving、offline、error、conflict 和 viewer，状态通过 live region 读出；在线保存失败提供44px“重试保存”入口，复用现有 flush，冲突不走普通重试。
- 加载错误与在线确认不存在分开；请求异常提供局部重试，离线失败联网后重试。笔记身份切换隔离页面状态，旧请求不再注水新页面。
- 账号变化先保全旧账号的待保存稿并封闭旧会话，再加载新账号；同账号认证事件保持编辑器。会话回调与依赖绑定当前 generation，旧响应不更新新会话 UI。
- 离线创建回退核对队列的账号归属，并读取后续本地草稿；恢复选择未完成前阻止自动保存覆盖草稿。创建仍先于保存，外账号队列不回放或删除。
- 保存/冲突补拉 Promise 拒绝进入已有失败处理，保留 dirty 与草稿；标题回车兼容 composing 和 229，受编辑能力门控。

本轮未改全局 token、TipTap 扩展、JSON/blockId 结构、数据库、RPC 名称或 ydoc 顺序；不会为样式重建 editor，实际笔记/账号变化建立独立页面实例。

## 验证证据

- 旧 HEAD 的状态组件执行新增展示回归：4/4 失败；修改后连同新增显式重试回归：5/5 通过。
- `corepack pnpm --filter @organize/web exec tsc --noEmit`：通过。
- `corepack pnpm --filter @organize/web exec next lint --dir lib --dir components --dir app --max-warnings 0`，以及改动 hook/测试单文件 ESLint：通过。扩展扫描全部 hooks 曾遇到未改的 `use-linked-task-sync.ts` 引用不存在规则；未扩大修改该既有配置问题。
- `corepack pnpm --filter @organize/web test`：227 文件通过、1 文件既有跳过；1723 用例通过、2 用例既有跳过。包含 editor-layout、block-interaction、保存协议与新增页面/hook/状态回归。
- 隔离 mock `corepack pnpm build`：通过。
- `corepack pnpm --filter @organize/web exec playwright test e2e/note-edit-state.spec.ts e2e/note-first-keystroke.spec.ts e2e/note-templates.spec.ts e2e/ui-adoption.spec.ts --grep 'note|offline|pending|IME'`：最终 9/9 通过。覆盖离线创建刷新/恢复/联网/SPA回读及稳定块 ID、外账号队列不展示不删除、320/390/1440 浅暗状态与无整页横滚、IME确认不拆分标题且保存后同一 editor DOM、首字与标题换行、显式模板保留。
- 首次浏览器整组模板测试在程序选区后加粗失败，单独重跑通过，最终整组也通过；未为偶发时序改动产品或弱化断言。
- 浅暗截图：[320浅色](screenshots/notes-edit/note-320-light.png)、[390深色](screenshots/notes-edit/note-390-dark.png)、[1440浅色](screenshots/notes-edit/note-1440-light.png)。主线程已目视320浅色及390深色。
- PR 的完整 CI（含真实后端协作与数据库）仍作为合并门禁。
- 浏览器使用隔离 mock 生产构建，未读取/复制 `.env*`，未修改用户开发 `.next`，未占用或终止 3000/3200 服务。

## 后续审计项

以下为 Astra 的代码时序审查发现，尚未完成浏览器复现或修复，不视为本轮已通过：

1. 历史恢复：`restorePreviewVersion` 在恢复前未等待当前稿保存，成功后清理该笔记草稿；快速恢复可能丢失尚未上传的编辑。历史/冲突族应先保全并等待保存，失败保留预览和本地稿，避免跨账号清稿，并核对协作房间。
2. Legacy taskItem 关联：批量创建任务记录旧位置，异步返回后按位置回填；中途删/移块时可能绑定其他块。后续应按稳定块 ID 查找并验证 editor/会话归属。
3. 列表剩余的跨 tab 并发新建、拖组/自动归组/标签条、置顶收藏失败提示与并发移动沿用前轮登记，本轮未扩展。

本地未单独执行浏览器缩放100/125/200%、完整bubble/列/表格/拖块/resize交互矩阵；编辑器布局和块交互由已有单元回归覆盖，不将其等同浏览器几何验收。真实多人并发、iOS/Android 软键盘与 safe-area、Tauri 原生双窗和拖动、真实上传/AI仍不在本地 mock 验证范围内；CI 的真实 Supabase/协作检查须单独确认，不把默认跳过当通过。

## 实际模型分工

GPT-6.1 Sol 实现与回归；GPT-6 Luna 保存状态展示；GPT-6 Astra 复杂异步与账号审查。主线程负责整合、隔离构建、验证和 PR，没有声称自动切换主线程模型。
