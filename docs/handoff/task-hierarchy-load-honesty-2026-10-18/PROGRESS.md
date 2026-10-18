# PROGRESS — task-hierarchy-load-honesty-2026-10-18

- 规划方已写好 TASK.md / PROMPT.md（基线 master `e31e06a`，vitest 基线 1981 passed / 2 skipped）。
- 待执行 Agent 从步骤 1 开始。

## 步骤 1 — 同步与建分支（2026-10-18）

- `git checkout master && git pull origin master`：本地 master 与 origin 一致，HEAD = `e31e06a`（与 TASK 基线相同）。
- 已建分支 `fix/task-hierarchy-load-honesty`。
- 工作区中其它 `docs/handoff/*` 的未跟踪/修改文件与本任务无关，提交时不会 add。

## 步骤 2 — 背景核实（2026-10-18）

逐条核对 `apps/web/components/tasks/task-hierarchy.tsx`，背景 1–5 全部属实：

1. `loadHierarchy`（35–49 行）：`Promise.all` 查子任务 + 可选 `maybeSingle` 上级，**从不读 `error`**；`setChildren((childrenResult.data || []) as Task[])` 失败写成空数组、`setParent((parentResult.data as Task | null) || null)` 写成 null；无 loadError / loading / toast / 重试。属实。
2. 已有子任务后刷新失败同样 `data || []` 覆盖上次成功快照。属实。
3. toast 完全没有（仅添加/完成子任务业务里有）；`isOnline` 已 import 但只用于写入路径，load 无门控。属实。
4. 全文件无 `loadError` / `loading` state、无重试入口；`useEffect([task.id, task.parent_task_id])` 只 `setTitle("")` + `loadHierarchy()`，不重置 children/parent。属实。
5. 无 `parent_task_id` 时父查询是 `Promise.resolve({ data: null })`（无 error），是合法「无上级」。属实，实现时按跳过处理。

依赖面（`rg -n "任务层级|上级任务|添加子任务"` + `rg -ln "TaskHierarchy|subtask-input"`）：

- 使用方：`app/(main)/tasks/[id]/page.tsx` 与 `components/tasks/task-inline-detail.tsx`（后者测试对 TaskHierarchy 整体 mock，不受影响）。
- 既有测试：`components/tasks/task-hierarchy.test.tsx`（重复任务下一实例 toast，#375 一带）——其 mock 的 `from("tasks")` thenable 恒返回 `{ data: mocks.children, error: null }`，本任务改动下 load 成功、不弹 toast，既有断言可保持通过。
- 无 e2e 文件引用 `subtask-input` / TaskHierarchy；`lib/backup/schema*` 命中的是导出字段文案，与 UI 无关。

结论：与 TASK 描述一致，未被修过，继续步骤 3。

## 步骤 3 — 最小修改（2026-10-18）

新增/改动文件（仅三个业务文件）：

1. **新增 `apps/web/lib/tasks/hierarchy-list-load.ts`**：常量 `TASK_HIERARCHY_LIST_LOAD_ERROR_MESSAGE = "任务层级加载失败"` + 纯函数 `nextHierarchyAfterLoad`。子侧 `error` 非空或 `data === null` 即失败（保留 previous）；父侧仅 `error` 非空算失败（`data === null` 无 error 是 maybeSingle 未命中=成功无上级）；`parent` 入参 `null` 表示跳过父查询=成功无上级；失败文案优先第一个非空 `error.message` trim，否则回退常量；两侧成功用新 data 并清错。
2. **新增 `apps/web/lib/tasks/hierarchy-list-load.test.ts`**：9 个用例，覆盖 TASK 目标 1 列出的全部分支（两侧成功清错 / 仅子失败保留子且父仍更新 / 仅父失败保留父且子仍更新 / 父跳过不算错 / 子 data null 无 error 亦失败 / message 空白回退常量 / 首屏失败 previous 皆空 / 成功空子数组 / 父 maybeSingle data=null 无错）。
3. **改 `apps/web/components/tasks/task-hierarchy.tsx`**：
   - 新增 `loading`（初始 true）/ `loadError` state、`childrenRef` / `parentRef` 快照、`loadSeqRef` 序号防切任务后在途旧响应写入新任务面板（落实「绝不能把上一任务层级留给新任务」）。
   - `loadHierarchy`：完整解构 `{ data, error }`；无 `parent_task_id` 时父入参传 `null`（跳过，跳过分支 `Promise.resolve` 补了 `error: null` 字段使两侧形状一致）；纯函数出 plan 后同步 refs + states；失败侧保留快照，绝不对失败侧 `setChildren([])`；`plan.loadError && isOnline()` 才弹 destructive toast；loading 开始 true 结束 false。
   - `useEffect([task.id, task.parent_task_id])`：先清 children/parent/loadError（state + refs 同步清空）再 `setTitle("")` + `loadHierarchy()`。
   - 乐观变更统一走新增 `updateChildren`（在事件处理器里基于 ref 计算，同步 ref + state）：addSubtask 的乐观插入/回滚/服务端替换、toggleSubtask 的乐观勾选/失败还原，刷新失败保留快照时不丢改动、不复活旧条目。
   - 渲染：`loading && children.length === 0 && !parent` → 「加载中…」（text-sm text-muted-foreground）；`loadError && children.length === 0 && !parent` → `role="alert"` dashed 边框错误空态 + outline/sm「重试」（样式对齐 task-reminders-editor）；`(children.length > 0 || parent) && loadError` → 保留上级按钮/子任务列表 + `role="alert"` 行内提示（border-destructive/40 bg-destructive/5）+ 就地重试；真正空（无错非 loading）维持原样。
   - **有 loadError 时保留底部添加子任务输入（不禁用）**——按 TASK 目标 2 的「优先保留输入以免扩大行为变化」选项。
   - 未动：recurring / atomic-update / 添加·完成子任务业务逻辑与文案、task-inline-detail、tasks/[id] 其它区块、globals.css、布局结构。

## 步骤 4–5 — 测试与本地验证（2026-10-18，仓库根目录跑）

- 新用例：`hierarchy-list-load.test.ts` 9 个全过；既有 `task-hierarchy.test.tsx` 2 个全过（重复任务下一实例 toast 用例语义未动，mock 无需调整——其 thenable 恒 `{ data, error: null }`，load 成功不弹 toast，原断言保持通过）。
- `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0。
- `corepack pnpm -C apps/web lint` → exit 0（No ESLint warnings or errors）。
- `corepack pnpm -C apps/web exec vitest run` → 261 files passed / 1 skipped；**1990 passed / 2 skipped**（基线 1981 + 新增 9，无失败）。
- 未在本地跑 e2e（遵守 TASK 要求，不占用 3000 端口服务）。

## 步骤 6 — 提交 / PR / CI（进行中）

- 待提交。
