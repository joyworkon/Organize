# PROGRESS — add-to-collection-load-honesty-2026-10-18

- 规划方已写好 TASK.md / PROMPT.md，基线 master `0c8fdd6`，vitest 基线 1990 passed / 2 skipped。
- 执行：ZCode（GLM-5.3）。Codex 至约 2026-10-22 前不可用。

（ZCode 从步骤 1 起追加。）

## 步骤 1：同步 master 建分支 — 完成
- `git -c 'credential.helper=!gh auth git-credential' pull origin master` → Already up to date，HEAD `0c8fdd6`（等于基线）。
- `git checkout -b fix/add-to-collection-load-honesty` 成功。
- 工作区有其它 handoff 的未提交 PROGRESS/未跟踪目录（非本任务产物），提交时只 add 本任务业务文件 + 本目录 PROGRESS.md。

## 步骤 2：核对背景 1–5 — 全部属实
逐条对照 `apps/web/components/collections/add-to-collection-dialog.tsx`（master 基线版本）：
1. 属实：`useEffect`（35–58 行）内 `!res.ok` 只 `toast(destructive)` 后 `return`（44–47 行），不设 loadError；`collections` 初值 `[]` + `finally` 关 loading → 落到 162–165 行「还没有集合。新建一个，把相关资料归到一起。」假空态。
2. 属实：async IIFE 只有 `try/finally` 无 `catch`——`fetch` 抛错时既不 toast 也不设错，仍落假空态。
3. 属实：`target` 变化触发重载，失败路径不动 `collections`（旧列表碰巧保留但无行内错误/重试）；切换 target 时未清 `suggestedIds`，失败时上一目标的建议芯片仍在；首屏失败永远假空。
4. 属实：toast 无离线门控，文件未导入 `isOnline`。
5. 属实：全文件无 `loadError` state、无重试入口；真正空库（成功 0 条）走 162–165 行既有文案 + 底部新建输入，保持不变即可。
- `rg "还没有集合|AddToCollectionDialog|/api/collections"`：仅 `add-to-collection-dialog.tsx` / `collections-view.tsx` / `add-to-collections-button.tsx` 三个组件引用；无单测引用对话框。
- e2e：`apps/web/e2e/library-collections.spec.ts` 只走成功路径（建集合 → 对话框点行 → 成功 toast），不依赖假空态文案；`ui-adoption.spec.ts` 不涉对话框。改失败分支不影响 e2e。
- 与描述相符，继续执行。

## 步骤 3：最小修改 — 完成
- 新建 `apps/web/lib/collections/list-load.ts`：`COLLECTIONS_LIST_LOAD_ERROR_MESSAGE = "集合加载失败"` + `nextCollectionsAfterLoad({ previous, data, error })`（失败保留 previous、loadError 优先 `error.message` trim 后非空否则常量；成功整体替换并清错），与 #389 templates-list-load 同构。未动 `lib/collections/types.ts`。
- 新建 `apps/web/lib/collections/list-load.test.ts`：6 个用例（成功替换清错 / 失败保留非空 previous 透传 message / message 空白回退常量 / null data 无 error 亦失败 / 首屏失败 previous=[] 仍 [] 且有 loadError / 成功空数组真空态）。
- 改 `apps/web/components/collections/add-to-collection-dialog.tsx`：
  - 新增 `loadError` state、`collectionsRef`（上次成功快照，供 effect 闭包读取）、`reloadCount`（自增触发同一 effect 重拉，即重试路径）。
  - **换 target/重试时的选择**：`setLoadError(null)` + `setSuggestedIds([])`，但**不清空 collections**——失败时保留跨次打开的上次成功列表 + 行内提示 + 重试（TASK 允许方案）；清 suggestedIds 同时解决背景 3 的「上一目标建议芯片残留」。
  - 加载逻辑：try/catch/JSON 解析失败都归一为事实（`ok` / `data` / `fetchError`），经 `nextCollectionsAfterLoad` 落 state；`!res.ok` 且 API 回 `error` 字符串时透传为 message；成功才重算 `suggestedIds`；失败 toast 加 `isOnline()` 门控（对齐 task-templates 模式）。
  - 渲染：`loadError && collections.length === 0` → `role="alert"` 错误空态（FilePlus + destructive 文案 + outline/sm 重试，不再显示「还没有集合…」）；`collections.length > 0 && loadError` → 列表上方行内 `role="alert"` + 重试；真正空库（成功 0 条且无错）维持原文案；底部「新建集合」输入保留。loading 分支不变。
  - 加入/新建集合的 POST 逻辑、对话框布局、`add-to-collections-button.tsx`、`collections-view.tsx`、API route 均未动。

## 步骤 4–5：本地验证 — 全绿
- `corepack pnpm -C apps/web exec vitest run lib/collections/list-load.test.ts` → 6 passed，exit 0。
- `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0。
- `corepack pnpm -C apps/web lint` → No ESLint warnings or errors，exit 0。
- `corepack pnpm -C apps/web exec vitest run` 全量 → **Tests 1996 passed | 2 skipped**（基线 1990 + 新增 6，无失败），exit 0。
- 未在本地跑 e2e（遵守约定，不占 3000 端口）。
