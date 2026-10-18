# PROGRESS — 任务模板对话框加载诚实化（fix/task-templates-load-honesty）

## 步骤 1：同步与建分支（2026-10-18）

- `git pull origin master` → Already up to date，HEAD `8a353a7c3eed1b90bedc754c108c798f9c9a26fc`（= 基线 8a353a7，符合）。
- `git checkout -b fix/task-templates-load-honesty` 成功。
- 工作区有其他任务的未跟踪 `docs/handoff/*` 与一个已跟踪的 `docs/handoff/lessons-list-load-honesty-2026-10-18/PROGRESS.md` 修改，均不属于本任务，提交时不 add。

## 步骤 2：现状核对（对照 TASK.md 背景 1–4）

逐条核实 `apps/web/components/tasks/task-templates-dialog.tsx`（基线版本），**四条全部属实**：

1. 属实。`loadTemplates`（75–87 行）：失败分支只 `toast({ title: "读取模板失败", variant: "destructive" })` 后 `return`，不设任何错误 state；`templates` 初值 `[]`、`loading` 已置 false → 落到 289–293 行「还没有任务模板」空态，加载失败被伪装成空库。
2. 属实。失败分支碰巧没有 `setTemplates([])`（保留上次快照），但无行内错误条、无重试入口，用户只见一闪而过的 toast，不知道列表可能过期。
3. 属实。第 83 行 toast 无离线门控（对比 lessons-list 81 行 `if (isOnline())` 才 destructive toast）。
4. 属实。全文件无 `loadError` state、无重试按钮。

- `rg -n "还没有任务模板" apps/web` → 仅 `task-templates-dialog.tsx:292` 一处，无测试/e2e 依赖；成功空列表文案与行为保持不变，不受影响。
- 参考对齐：`lib/lessons/list-load.ts`（nextLessonsAfterLoad，#388）、`lib/reading/list-load.ts`（#387）；UI 接线参考 `lessons-list.tsx`（loadError + lessonsRef + isOnline 门控 + 行内 alert 条 + 错误空态重试）与 `reading-view.tsx` 718–748 行同款样式。
- `createBrowserClient` 未带 Database 泛型，`data` 为 `any[] | null`，可直接传入纯函数入参 `TaskTemplate[] | null`。

结论：与 TASK.md 描述一致，未被修过，按目标 1–2 继续最小修改。

## 步骤 3：实现

1. 新建 `apps/web/lib/tasks/templates-list-load.ts`：常量 `TASK_TEMPLATES_LIST_LOAD_ERROR_MESSAGE = "任务模板加载失败"` + 纯函数 `nextTemplatesAfterLoad({ previous, data, error })`——失败（error 非空或 data 为 null）保留 previous（同引用）并给 loadError（message trim 非空优先，否则常量）；成功整体替换并清错。与 #387/#388 同构。
2. 新建 `apps/web/lib/tasks/templates-list-load.test.ts`：6 个用例——成功替换清错；失败保留非空 previous 并透传 message；message 空白回退常量；data null 无 error 亦按失败；首屏失败 previous=[] 时 templates 仍 [] 且有 loadError；成功空数组 → [] 且无错。
3. 改 `apps/web/components/tasks/task-templates-dialog.tsx`（最小修改）：
   - 新增 `loadError` state + `templatesRef`（useRef 保存上次成功快照，供 loadTemplates 读最新值）。
   - `loadTemplates`：统一经 `nextTemplatesAfterLoad` 落 state；失败保留 previous、设 loadError，**无 setTemplates([])**；在线（`isOnline()`）才 destructive toast（标题用常量）；成功清 loadError。`setLoading` 行为不变（开始 true、结束 false）。
   - 删除模板成功后同步过滤 `templatesRef`（防止下次刷新失败时把已删模板从旧快照里「复活」——删除流程本身未动）。
   - 渲染（非编辑态列表区）：loading → 「加载中…」；`loadError && templates.length === 0` → dashed 错误空态（role="alert"，标题为失败文案，非「还没有任务模板」）+ Button outline/sm 重试；`templates.length === 0 && !loadError` → 原空态「还没有任务模板」原样保留；`templates.length > 0 && loadError` → 列表照常显示，顶部 `role="alert"` 行内错误条（destructive/40 边框样式，同 lessons/reading）+ 重试。重试 = 清 loadError 后 `void loadTemplates()`。
   - 未动：套用/新建/编辑/删除流程、`lib/tasks/templates.ts`、Dialog 触发器与 compact、globals.css、其它任务对话框。

## 步骤 4–5：测试与本地验证（仓库根目录）

- 新单测全过（vitest run 含 6 个新用例）。
- `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0
- `corepack pnpm -C apps/web lint` → exit 0（No ESLint warnings or errors）
- `corepack pnpm -C apps/web exec vitest run` → exit 0，**1969 passed / 2 skipped**（基线 1963 passed / 2 skipped，+6 为本任务新用例，无失败）
- e2e 按要求未在本地跑。

## 步骤 6：提交 / PR / CI

（待补）
