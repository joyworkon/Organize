# PROGRESS

- 2026-10-18 约 18:16 Asia/Taipei：规划方（五狗）写好 TASK.md / PROMPT.md，派给 ZCode（GLM-5.3）。基线 master `b08dea5`（#405 lesson-detail-link-options-load-honesty 已合并）。下一任务：分享对话框 CollaboratorGrants 授权列表加载失败诚实处理。
- 2026-10-18 ZCode 开工。步骤 1：`git checkout master && git pull origin master` → Already up to date，HEAD `b08dea5`；`git checkout -b fix/share-collaborator-grants-load-honesty`。工作树里其它任务目录的 PROGRESS.md 改动与未跟踪 `docs/handoff/*` 保持不动，提交时只 add 本任务文件。
- 步骤 2 核对（`apps/web/components/share/resource-share-dialog.tsx` @ `b08dea5`）：
  1. ✅ 属实。CollaboratorGrants 579–644 行：`resource_acl` 查询 `error` 会 `throw`（599 行），落入 `catch { if (active) setRows([]); }`（613–614 行）→ `rows.length === 0` → 渲染「这篇内容通过协作空间与你共享。」（631–632 行）。失败与真空态不可区分，确为假空态。
  2. ✅ 属实。`workspaces` 名称查询（603 行）只解构 `data`、丢 `error`，`wsRows || []` 回退显示名「协作空间」。本任务不改。
  3. ✅ 属实。InviteSection（#402 `nextInviteWorkspacesAfterLoad`）、TransferOwnershipSection（#403 `nextTransferCandidatesAfterLoad` + `candidatesRef` + 可重入 `loadCandidates` + `role="alert"` 重试行）已诚实，本任务不碰。
  结论：问题未修，继续。实现方式与 #403 同构：纯函数 `lib/share/collaborator-grants-load.ts` + 组件内 `lastSuccessRef` / 可重入 `loadGrants` / 错误重试行。
- 步骤 3 实现：
  - 新增 `apps/web/lib/share/collaborator-grants-load.ts`：`CollaboratorGrantRow { wsName; role }`、`COLLABORATOR_GRANTS_LOAD_ERROR_MESSAGE = "协作授权加载失败"`、`nextCollaboratorGrantsAfterLoad({ previous, data, error }) → { rows, loadError }`（成功 → `data ? [...data] : []` 无错；失败 → `previous` 同引用 + 错误文案）。
  - 新增 `collaborator-grants-load.test.ts` 5 个用例：成功有数据（新数组、顺序保持）/ 成功 null 与空数组 → 真空态 / 失败有 previous → 同引用 + 文案 / 失败 previous 空 → 空数组 + 文案 / 失败 error 为布尔 true（组件 failed 标志）。
  - `resource-share-dialog.tsx` 仅改 CollaboratorGrants + 一处 import：`rows` 改用 `CollaboratorGrantRow[]`；新增 `reloading` / `loadError` state 与 `lastSuccessRef`；mount 加载抽成可重入 `loadGrants(signal?)`（useCallback，`signal.active` 过期丢弃），try 内组装 `assembled`、catch 置 `failed = true`，统一经纯函数落状态，成功才更新 ref 与 rows；渲染：`loading` 转圈 → `loadError && rows.length === 0` 只显示 `role="alert"` 错误行（`text-xs text-destructive`）+「重试」按钮（重试中禁用、文案「重试中…」）→ 真空（成功且无行）才显示「这篇内容通过协作空间与你共享。」→ 有行时列表 + 下方错误行（若 loadError 非空）。`workspaces` 名称查询丢 error 的降级原样保留。未动 InviteSection / WorkspaceGrantsSection / TransferOwnershipSection / 公开链接 / globals.css。
- 步骤 4 本地验证（仓库根目录）：
  - `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0
  - `corepack pnpm -C apps/web lint` → ✔ No ESLint warnings or errors（exit 0）
  - `corepack pnpm -C apps/web exec vitest run` → exit 0，**2060 passed / 2 skipped**（273 文件，基线 2055，+5 符合 ≥4）；单跑新文件 5/5 通过。stderr 里 `Not implemented: window.focus` 为 jsdom 既有噪音（notifications-click.test.ts），非失败。未跑 e2e。
