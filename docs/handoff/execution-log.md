# Organize 重构执行日志

执行开始：2026-09-05。本文件是跨上下文恢复的唯一进度真相源：每次恢复先读本文件再继续，不重新开始。

## 环境与能力基线（R00 盘点）

- 基线提交：`d9ec06e`（交接包评审基线）；计划文档合并后 master = `3df63c9`。
- 本机：macOS arm64（darwin 25.6.0），Node v22.22.2，pnpm 9.10.0，系统时区 EDT（测试已验证 EDT/UTC/Asia/Shanghai 三进程）。
- Docker：可用（29.7.2，运行中）。
- Supabase CLI：2.116.0；本地后端运行中（`supabase status` 正常）；另链接远程项目 organize-staging——**只做本地验证，绝不触碰远程/生产库**。
- Playwright Chromium：已安装，E2E 可本地运行。
- `.env.local`：存在，`NEXT_PUBLIC_MOCK_BACKEND=false`（真实本地后端模式）。**不修改用户 .env.local**。
- AGENTS.md 部分计数已过时（迁移实际到 072；CI 含 audit/lint/typecheck/vitest/build/E2E/pgTAP 六门禁），一切以实际文件为准。

## 基线验证记录（R00 步骤 1）

- `tsc --noEmit`：通过（exit 0）。
- `vitest run`：132 文件 / 951 测试全部通过（EDT 时区）。
- 交接文档所述 notch.test.ts 2 个失败：已在 `TZ=Asia/Shanghai` 下复现（固定 UTC 时刻跨日导致），非已修复项。

## 每卡交付记录

### R00 基线记录与时区稳定测试 — ✅ 已完成（PR #224，master df9f88d）

- 基线提交：3df63c9
- 原问题与复现：`notch.test.ts` 的 `selectPanelTasks` 两个用例用固定 UTC 时刻（`2026-09-01T18:00:00.000Z` 等）表达"今天到期"，在东八区跨到本地次日被排除；`TZ=Asia/Shanghai npx vitest run lib/desktop/notch.test.ts` 复现 2 failed。
- 修改文件与职责：`apps/web/lib/desktop/notch.test.ts` 仅测试——"本地今天"样本改为 `localMoment()` 本地日历显式构造（与生产 `startOfDay` 语义一致）；新增两条 UTC 跨日样本（本地 23:30 仍算今天；本地次日凌晨不算今天），防实现退化成 UTC 字符串截取。
- 行为变化：无（纯测试稳定化，未改 `notch.ts` 任何判定逻辑）。
- 测试命令及退出结果：`npx vitest run lib/desktop/notch.test.ts` 在 TZ=EDT / UTC / Asia/Shanghai 三进程下均 10 passed；全量 `vitest run` 132/951 通过；`tsc --noEmit` 通过。
- 未覆盖场景：负偏移时区（如 America/Los_Angeles）未单列进程，但 EDT（UTC-4）本机进程已覆盖 UTC 西侧跨日路径。
- 回退办法：revert 本 PR 即恢复旧样本。
- 下一张可执行卡：R01。

### R01 Markdown 导出正文完整性 — ✅ 已完成（PR #225）

- 基线提交：df9f88d
- 原问题与复现：旧 `lib/export/tiptap-to-md.ts` 对未知节点默认 `renderInline` 返回空、`renderListItem` 把所有子块拍平——直接执行复现：callout/分栏正文丢失、表格多段落单元格为空、嵌套列表子项丢失、任务列表缺 `- ` 前缀、有序列表不尊重 start、代码围栏被内容内 ``` 截断、tabs/mermaid/嵌入/按钮/数据库块全部输出空。回归测试 21 个用例在旧实现上失败（已确认复现后才改实现）。
- 修改文件与职责：`lib/export/tiptap-to-md.ts`——块级递归与行内渲染分离；新增 `renderMarkdownExport() -> { markdown, warnings }` 类型化降级结果（unknown-node / database-rows-excluded / table-merged-cells / render-failed，同类去重），`tiptapJsonToMarkdown` 保留纯字符串 API 共用一次渲染；复杂块降级矩阵：callout→引用（emoji 前缀）、columns 依次展开、details 摘要加粗+正文、tabs 各页标题+正文、mermaid/htmlEmbed 代码围栏、embed 源链接（仅 http/https/站内安全目标）、buttonBlock 标签+安全目标（javascript: 等不导出）、目录/面包屑可读说明、syncedBlock 导出已有快照、databaseBlock 引用说明+警告（不读取行数据）；表格单元格多段落 `<br>` 连接、竖线防双转义、合并单元格平铺+警告；嵌套列表按标记宽度缩进；任务列表 `- [ ]`/`- [x]`；有序列表尊重 start；代码围栏避开内容内连续反引号。
- 行为变化：导出内容更完整（修复丢失）；`tiptapJsonToMarkdown` 字符串 API 与空笔记/标题行为不变；调用方（settings 页、export-button）无需改动。
- 测试命令及退出结果：`npx vitest run lib/export/tiptap-to-md.test.ts` 27 passed（旧实现上 21 failed）；全量 `vitest run` 132 文件 / 975 测试通过；`tsc --noEmit` 通过；`next lint --max-warnings 0` 通过；代表性语法用已有 marked@12 解析验证（列表/表格/引用块）。
- 未覆盖场景：真实大型笔记（千块级）的导出耗时未测；Y.Doc 内容进入 JSON 后的形状由保存层保证。
- 回退办法：revert 本 PR。
- 下一张可执行卡：R02。

### R02 导出当前编辑快照 — ✅ 已完成（PR #226）

- 基线提交：3be3c6b
- 原问题与复现：编辑页 `exportMarkdown` 先 `await flushSave()` 再让 `exportNoteToMarkdown` 重新从数据库拉数据——离线/保存失败时导出的是服务器旧内容甚至直接失败；异步间隙读共享 refs，快速切页可能导出错笔记。卡片路径 `note-card.tsx` 菜单调用 `exportNoteToMarkdown` 无 catch，失败产生未处理 rejection 且无用户反馈；`ExportButton` 的 handleExport 也无 catch。
- 修改文件与职责：新增 `lib/export/note-export.ts`——`renderNoteExport()`（纯函数：快照→markdown+清洗文件名+warnings）与 `downloadNoteExport()`（触发下载），核心库不依赖 React/网络；`components/share/export-button.tsx`——服务端路径改用 note-export 渲染（保持权限读库），`exportNoteToMarkdown` 改为返回 boolean、内部 catch+toast 反馈，不再抛未处理异常；`app/(main)/notes/[id]/page.tsx`——`exportMarkdown` 改为同步捕获点击瞬间快照（editor.getJSON 优先）后立即渲染下载，移除 `await flushSave()`，dirty 时提示"已导出当前内容，云端仍待同步"，不清 dirty/草稿/冲突状态，数据库块降级有简短提示。
- 行为变化：编辑页导出=本地最新快照（离线/冲突也含本地最新字，不落库）；卡片导出仍=服务器已保存版本；失败有 toast 反馈。
- 测试命令及退出结果：新增 `lib/export/note-export.test.ts` 7 passed（离线快照、冲突快照、快照不可变、中文/非法文件名、标题回退、warnings 分离、下载触发）；全量 `vitest run` 133 文件 / 982 测试通过；`tsc --noEmit`、`next lint --max-warnings 0` 通过；PR 上 CI E2E（浏览器层含笔记页保存链路）通过。
- 未覆盖场景：真实浏览器中"编辑后立即离线导出"的手动点击验证安排在最终跨模块 E2E（避免每卡起生产构建）。
- 回退办法：revert 本 PR。
- 下一张可执行卡：R03。

### R03 本地草稿失败必须可见 — ✅ 已完成（PR #227）

- 基线提交：7584587
- 原问题与复现：`writeLocalNoteDraft` catch 所有异常返回 null，`persistCurrentDraft` 忽略结果——配额满/隐私模式时页面照常显示"保存失败，本地草稿已保留，请检查网络后重试"和冲突框"当前内容没有丢失，并已保存在本地"，均为不实陈述（代码路径确认，注入抛错 storage 的行为测试固定）。
- 修改文件与职责：`lib/notes/local-draft.ts`——`writeLocalNoteDraft` 返回类型化 `DraftWriteResult`（ok/quota/unavailable/serialization；DOMException name 与 code 22/1014 判 quota，序列化失败单列，其余保守 unavailable），序列化前置于存储写入避免半成品；`app/(main)/notes/[id]/page.tsx`——`persistCurrentDraft` 消费结果并维护 `localDraftPersistFailed` 状态；新增持续错误条（amber，role=alert，不自动消失）附"导出当前内容"入口（复用 R02 本地快照导出）；冲突对话框文案按实际写入结果二态；保存失败文案改为不依赖写入结果的如实表述；云端保存成功清草稿时撤销错误条；新增标准 beforeunload 提醒（仅内存修改时，注释明确只是辅助）。
- 行为变化：草稿写入失败不再被吞——持续可见 + 可导出；编辑/正常服务器保存链路、viewer、离线创建队列行为不变。
- 测试命令及退出结果：`lib/notes/local-draft.test.ts` 8 passed（新增 quota/unavailable/serialization/ok 四类注入用例 + 既有键隔离保持）；全量 `vitest run` 133 文件 / 986 测试通过；`tsc --noEmit`、`next lint --max-warnings 0` 通过。
- 未覆盖场景：真实浏览器配额注入（DevTools 覆盖 storage）留待 D05 跨状态验收；beforeunload 在移动端不可靠已在代码注释与文档声明。
- 回退办法：revert 本 PR。
- 下一张可执行卡：R04。

### R04 同步块正确判定成功并减少无效事务 — ✅ 已完成（PR #228）

- 基线提交：63e61e6
- 原问题与复现（代码路径确认 + 行为测试固定）：①PATCH/GET/POST 从不检查 `res.ok`——500 且响应含 JSON 时 `data.updated_at` 回退本地时间，**显示"已同步"并广播**，500 响应非 JSON 时静默吞掉；②transaction 监听器不检查 docChanged——光标移动/其他块编辑都会重排防抖 PATCH；③远端替换用普通事务无 meta，靠"1 秒内忽略"防回声，同页双实例互为回声源；④注水 `setNodeMarkup` 也触发监听器（属性变化≠内容变化）；⑤viewer（不可编辑）无写请求防护。
- 修改文件与职责：新增 `components/editor/extensions/synced-block-sync.ts`——传输层（`patchSyncedBlock`/`fetchSyncedBlock`：HTTP 状态先行、坏 JSON/形状校验，类型化 ok/failure）、`syncedBlockNeedsSync`（docChanged→远端 meta→同块身份→内容 JSON 比较，pos 为新文档坐标经 invert 映射回旧文档）、`replaceSyncedBlockContent`（`organizeSyncedRemote` meta + `addToHistory:false`）、`shouldAcceptSyncMessage`（origin 会话 id + 单调 seq 来源识别，取代时间窗口）、`createSyncSessionId`；`synced-block.tsx`——状态机 loading/saved/saving/error + dirty，失败保留待写快照并显示块内"重试"，仅服务器确认成功后清 pending 并广播；保存期间新编辑自动再排空；`editor.isEditable` 为 false 不发写请求；`synced-block-client.ts`——POST 检查 res.ok 与 id 形状。
- 行为变化：500/网络失败不再显示已同步、不再广播；选区移动与其他块编辑 0 次 PATCH；一次内容修改只产生一次防抖 PATCH（保存中继续编辑会串行再排空）；同页/跨标签回声由 origin+seq 根治；Undo 历史不再记录远端回写。
- 测试命令及退出结果：新增 `synced-block-sync.test.ts` 16 用例（选区 0 PATCH、块内编辑触发、其他块编辑不触发、属性变化不触发、远端 meta 不回声、PATCH 500/坏 JSON/成功、GET 401/not-found/成功、origin+seq 识别、会话 id 唯一）；全量 `vitest run` 134 文件 / 1002 测试通过；`tsc --noEmit`、`next lint --max-warnings 0` 通过。
- 未覆盖场景：真实双浏览器并发编辑的 E2E 属 R05 验收矩阵（跨设备冲突本卡不声称解决）；`COLLAB_E2E` 场景不受影响（同步块不经 CRDT）。
- 回退办法：revert 本 PR。
- 下一张可执行卡：R06。

### R05 同步块重开、离线、并发完整性 — ✅ 已完成（PR #229，设计文档 docs/handoff/r05-synced-block-design.md）

- 基线提交：b74911e。**高风险卡：先写设计（接口/状态/兼容/回退）后实施 + 独立第二遍代码审查**。
- 缺口盘点（实施前确认）：hydrated 持久化属性致重开跳过拉取；PATCH 无并发检查静默覆盖；无离线 pending 持久化；无跨设备重验证；mock 下 501；备份恢复 insert 无 on conflict（既有边界，本卡不改，设计文档 §6 留档）。
- 接口：迁移 073（revision 列 default 1 + security definer RPC `synced_block_patch`——单条 UPDATE 内完成 expected 比较，冲突返回 current.revision/content，not_found 不泄露存在性；anon 显式 revoke 对齐 067 模式）；PATCH route 改走 RPC（200/409/404 同形状）；GET/POST 带 revision；备份导出为显式列清单故合同不变，恢复行 default 1。
- 组件状态：loading/saved/saving/error/conflict/stale；hydrated 属性保留读写但组件忽略（重开必拉取）；pending 持久化 localStorage（键含 userId，换账号天然隔离）；409 幂等命中与真实冲突分流；冲突/stale 默认不覆盖远端，「拉取远端」「用本地覆盖」显式动作；可见性/聚焦/联网驱动 GET 重验证（5s 节流）；`organize:synced-block-status` 事件 + 笔记页顶栏「N 个同步块待同步」聚合。
- **独立第二遍代码审查**（方式：无利益关联的独立 agent 只读审查全部 R05 文件 + 设计文档交叉核对）发现 9 项问题，全部修复：
  - P0：pending 持久化接线错误——onTransaction/重试绕过 `setPending` 导致 localStorage 永远无写入（核心承诺失效）→ 统一走唯一写入口
  - P0/P1：挂载恢复与可见性刷新无条件用远端 revision 覆盖乐观锁基准 → stale 态下任何 flush 都会静默覆盖远端 → 分叉时不动基准；挂载分叉不再自动补交（改 stale + 显式动作）；幂等一致时直接收敛不再空 PATCH
  - P1：conflict 态 UI 缺「拉取远端/用本地覆盖」按钮（重试死循环）→ 补齐
  - P2：pending 键补 userId 维度与设计文档对齐
  - P3：getSyncedUserId 不再永久缓存 null；mock POST 补 id 冲突 500；pgTAP 特权断言改 `is()` 包装（原写法实际未注册测试）+ anon 显式 revoke
- 验证：vitest 134 文件 / 1007 测试；**pgTAP 073 真实本地库 14 断言通过**（全套 27 文件 PASS）；tsc、lint 零警告。
- 未覆盖（如实记录）：两浏览器真实并发编辑的浏览器端演示未跑——协议层（原子 UPDATE + 409 流程）由真实库 pgTAP 与单测覆盖；待真实协作 E2E 安排（handoff 停止条件：不声称”同步已完善”）。
- 回退办法：revert 本 PR；revision 列留存无害（旧代码不读写）；pending localStorage 键残留不影响。
- 下一张可执行卡：R06。

### R06 命令定义、显示和执行一致 — ✅ 已完成（PR #230）

- 基线提交：44f00bc
- 原问题与复现：嵌套菜单过滤用黑名单 `NESTED_BLOCKED_COMMANDS`（仅 8 项），但 `executeNestedCommand` 的 switch 只实现 16 项 insert + 4 项 emit——目录/路径栏/按钮/选项卡/Mermaid/嵌入/同步块/三种数据库共 **10 个命令在嵌套场景显示却落入 `default: break`：删掉 `/` 触发字符后什么都不做**（代码路径确认 + 行为测试固定）。
- 上下文支持矩阵（top=顶层 / nested=列表·单元格·分栏内；`✗` = 嵌套菜单隐藏，非禁用黑名单）：

| 命令 | top | nested | nested 执行路径 |
|---|---|---|---|
| 文本/标题1-4/引用/代码块/分隔线 | ✓ | ✓ | insert |
| 折叠/折叠标题1-4/标注 | ✓ | ✓ | insert |
| 无序/有序/待办列表 | ✓ | ✓ | insert |
| 图片/HTML/公式/引用阅读条目 | ✓ | ✓ | emit（nested 事件路径） |
| AI 速记/页面/表格/分栏2-5列 | ✓ | ✗ | 容器或顶层语义 |
| 目录/路径栏/按钮/选项卡/Mermaid/嵌入/同步块/三种数据库 | ✓ | ✗ | 首轮隐藏（原为静默无动作） |
| 插件命令 | ✓ | ✗ | 需顶层块位置语义 |

- 修改文件与职责：`types.ts`——`BlockCommandContext`/`BlockCommandRunResult` 类型与 `supportedContexts` 字段；`block-commands.ts`——13 个 top-only 命令标注 `supportedContexts: ["top"]`，新增 resolver `isCommandAvailableInContext`，嵌套执行器 `executeNestedCommand` 移入本文件并返回 handled/unsupported/failed（插入内容改构造表，与顶层 run 同源）；`block-command-menu.tsx`——删除黑名单改用 resolver，unsupported 时不消费触发字符（`/` 与已输入文字保留）；新增 `block-command-contexts.test.ts` 一致性测试（显示 ⇔ 有执行路径，防回归）。
- 行为变化：嵌套菜单不再显示无执行路径的 10 个命令；unsupported 命令不再吞掉触发文本；顶层与全部既有嵌套能力不变。
- 测试命令及退出结果：新增 5 用例（一致性表、顶层全显示、unsupported 保文本、嵌套 divider/task-list 插入且消费触发文本）；全量 `vitest run` 135 文件 / 1012 测试通过；`tsc --noEmit`、`next lint --max-warnings 0` 通过。
- 未覆盖场景：表格单元格内的真实鼠标操作路径属 E2E/D05 范围；「合并顶层与嵌套通用插入逻辑」按计划措辞为逐步进行（本卡完成构造表同源化，顶层 replace 与嵌套 insert 语义差异保留）。
- 回退办法：revert 本 PR。
- 下一张可执行卡：R07。

### R07 笔记保存会话抽离 — ✅ 已完成（PR #231）

- 基线提交：832f07d。**高风险卡：先行为测试、后搬代码；真实浏览器 E2E 验证后才合并。**
- 行为时序图（搬移前盘点，对应计划 R07.1）：加载（getSession→拉笔记→角色判定→本地草稿恢复/离线创建初始化）→ 编辑（onUpdate→draft+来源标记→persist→900ms 防抖）→ 排空（while dirty：快照复制→幂等键复用→按角色/协作选 RPC→循环）→ 冲突（不自动覆盖→拉远端+066 归因→三动作）→ 失败（planSaveFailure 分类：退避重试/等联网/明确报错）→ 成功（revision 推进/清草稿/notes-changed）→ 切页（draftNoteId 归属校验→新会话）→ 卸载（pagehide flush + beforeunload）→ 恢复（skip-flush 标志消费）。
- 修改文件与职责：
  - 新增 `lib/notes/note-save-session.ts`——纯会话核心，依赖注入（transport/draftStorage/timers/randomId/consumeSkipFlush/role·collab·online 活跃值），页面不再直接编排 dirty/revision/mutation/重试；对外 API：patchDraft/setContent/restoreDraft/hydrate/exportSnapshot/queueSave/flush(返回类型化 NoteFlushResult)/flushSaved/suppressAutosave/resolveConflictOverwriteRemote/resolveConflictReloadRemote/discardLocalDraft/destroy/getUiState
  - 新增 `hooks/use-note-session.ts`——React 绑定：noteId+accountId 为 generation，变化即销毁旧会话；页面经 useSyncExternalStore 式订阅消费统一派生 UI 状态（phase: clean/dirty/saving/local-only/conflict/error + lastSavedAt/saveError/offlinePending/conflict/localPersistence/pendingChildBlocks），不再用互不约束的散 flag
  - `app/(main)/notes/[id]/page.tsx`——删除约 300 行保存管线（persistCurrentDraft/flushSave 排空循环/重试定时器/幂等键缓存/冲突组装），改为会话消费；共享 draftRef 桥接保留既有页面写点（documented bridge）
  - 新增 `lib/collab/transaction-source.ts`（TransactionSource 从编辑器组件下沉到 lib，避免 lib→components 依赖）
- 语义保持：role→RPC 选择（owner v1/editor v2/协作在线 v2+null）✓；任务 mutation 仅 user 来源+双链开关 ✓；幂等键同内容复用 ✓；冲突不自动覆盖+归因 ✓；viewer 不写 ✓；离线创建先建后存（23505 幂等）✓；skip-flush 消费 ✓；beforeunload/pagehide ✓；R03 本机写入失败上报 ✓；R05 子块计数经 setPendingChildBlocks 汇入统一状态 ✓。行为差异：离线创建加载后原仅置标记，现排队保存（离线→local-only 标记；在线→立即补交，修复滞留）——已在代码注释说明。
- **独立第二遍代码审查**（方式：无利益关联的独立 agent 对照旧实现逐段 diff + 最小 React 复现）发现 2 P0 / 2 P2 / 3 P3，全部修复：
  - P0-1 注水时序：pendingHydrationRef 不触发 effect 重跑→revision 恒 0→存量笔记首次保存必假冲突；且 SPA 切页会用旧笔记 revision 注水 → 改为 state（loadedRevision 携带 noteId）+「每会话一次、noteId 匹配」守卫
  - P0-2 setUi 传同一可变引用触发 React eager bailout→冲突框/错误条/保存中在自动保存路径不可见 → 改传快照
  - P1 兜底 flush 变死代码（cleanup 先 destroy）→ hook cleanup 改为 flush→finally destroy
  - 修复引入的新竞态（flush-then-destroy 期间旧会话第二轮读到新笔记草稿）→ 会话绑定草稿对象身份，整体替换即失效（新增行为测试固定）；applyDraftToPage 改就地合并保持身份
  - P2 断网瞬间 offlinePending 缺失（补 markOfflinePending）；离线创建打开即 queueSave 制造多余 dirty（改 offline→标记 / online→补交）；P3 setContent/hydrate 补 destroyed 守卫、keepLocalCopy 失败提示降为 toast（接受，已记录）
- 测试命令及退出结果：新增 `note-save-session.test.ts` 17 用例覆盖计划关键行为清单（A/B 切换隔离、保存中继续输入串行排空、响应丢失幂等重试、冲突不自动覆盖+覆盖/采用、离线/离线创建、恢复不写回、viewer、角色失败停止、来源过滤、防抖单飞、quota 如实上报、销毁清定时器、草稿身份绑定失效）；全量 vitest 136 文件 / 1028 测试；tsc、lint 零警告；**审查修复后本地真实浏览器 E2E（mock 生产构建 + Chromium）复跑：smoke 5/5 通过，含「笔记保存后导航往返：内容持久化」**；协作 E2E 3 条按设计跳过（COLLAB_E2E 未开）。
- 未覆盖场景：协作断线/恢复（CRDT 层，协议问题另开卡的计划约定不变）；⌘S 各分支的浏览器手动全遍历（flushSaved 映射有单测）。
- 回退办法：revert 本 PR 即恢复页面内联保存管线（会话模块留存不影响）。
- 下一张可执行卡：R08。

### R08 页面展示与任务同步抽离 — ✅ 已完成（PR #232）

- 基线提交：b0b6240
- 修改文件与职责：
  - 新增 `hooks/use-linked-task-sync.ts`——任务→笔记反向同步自页面抽离，并落实 R08.4 轮询纪律：**无引用笔记不产生 3 秒轮询**（先探测一次，本笔记 note:saved 事件后再探测，出现引用才升级轮询）；页面不可见暂停 tick；重新可见/窗口聚焦立即同步；in-flight 门保证请求不重叠。回写仍为 remote-sync 系统事务（不进 Undo、不激活任务，R08 验收项保持）
  - 新增 `lib/notes/capabilities.ts` + 测试——owner/editor/viewer 能力集中派生（canEdit/canModifyTags/isViewer），页面不再散落 `noteRole === "viewer"` 比较；真实权限收口仍在保存 RPC/RLS，分享按钮等入口未删除
  - 新增 `components/notes/note-save-status.tsx`（顶栏状态区：离线/同步块/错误/保存中/已保存/viewer 角标，纯展示消费 R07 会话派生状态）
  - 新增 `components/notes/note-recovery-dialog.tsx`、`components/notes/note-conflict-dialog.tsx`（恢复/冲突对话框抽离，含 066 归因文案、任务冲突警示、三动作）
  - `app/(main)/notes/[id]/page.tsx`——轮询 effect 与三块 JSX 替换为 hook/组件；层级/图标/封面/字体仍走 session patch；标签仍走原标签接口
- 行为变化（均为计划 R08.4 授权的改进）：无引用笔记不再每 3 秒查询 task_item_refs；后台标签页暂停轮询；聚焦/恢复可见立即同步一次。其余行为不变。
- 测试命令及退出结果：capabilities 3 用例；全量 vitest 137 文件 / 1032 测试；tsc、lint 零警告；mock 生产构建 + Chromium E2E smoke 5/5（覆盖新组件渲染与笔记保存链路）。
- 未覆盖场景：任务轮询纪律（可见性/聚焦）的浏览器级手测留待 D05 跨状态验收；Realtime 订阅仍按既有决策用轮询（本地 dev signature_error 问题未变）。
- 回退办法：revert 本 PR。
- 下一张可执行卡：R09。

## 待办队列

R09 → D00/D01 → D02 → D03 → D04 → D05 → R10 → R11 → R12 → D06 → 跨模块端到端检查。

## 遗留问题

（暂无）
