# 执行进度：分享邀请工作区加载诚实化（fix/share-invite-workspaces-load-honesty）

## 状态
- 2026-10-18 约 15:36 Asia/Taipei：任务已派给 ZCode，等待执行。
- 步骤 1 完成：`git pull origin master` 后 HEAD = `0a30b85`（与任务基线一致），已建分支 `fix/share-invite-workspaces-load-honesty`。工作区中其它未跟踪 `docs/handoff/*` 与两条已修改 PROGRESS.md 属其它任务，保持不动、不 add。
- 步骤 2 完成，背景核对全部属实（基线 `0a30b85`，`apps/web/components/share/resource-share-dialog.tsx`）：
  1. InviteSection mount `useEffect`（322–333 行）只解构 `{ data }`、丢 `error`，失败时 `(data || [])` → 空数组 → 下拉只剩「新建协作空间…」且 `workspaceChoice` 默认 `__new__`——吞错属实。
  2. 上方 OwnerShareSections 的 `loadData`（162–188 行）对 `wsErr`/`grantErr` 抛错并渲染 `loadError`，可作对照；不改。
  3. TransferOwnershipSection（约 684 行注释「候选加载失败按空集处理」）属实，属另一问题，不改。
- 步骤 3 完成：
  - 新增 `apps/web/lib/share/invite-workspaces-load.ts`：`InviteWorkspaceRow` + `INVITE_WORKSPACES_LOAD_ERROR_MESSAGE`（"协作空间加载失败"）+ `nextInviteWorkspacesAfterLoad({ previous, data, error })`。成功 → 过滤 team 保持顺序、`loadError = null`、`preferredChoice` = 首个 team id 或 `"__new__"`；失败 → `workspaces = previous`（同引用）、错误文案、`preferredChoice = null`（选定语义：null = 调用方不动用户当前选择，单测已写清）。
  - 新增 `apps/web/lib/share/invite-workspaces-load.test.ts`：4 个用例（成功过滤+顺序+首选、成功无 team/data null → `__new__`、失败有 previous → 同引用+文案+null、失败 previous 空 → 空+文案）。
  - 改 `apps/web/components/share/resource-share-dialog.tsx` 仅 InviteSection：mount 加载解构 `{ data, error }` 走纯函数（`loadTeamWorkspaces` useCallback + mount effect）；新增 `workspacesLoadError` / `reloadingWorkspaces` state 与 `teamWorkspacesRef`（上次成功快照，重试失败时作 previous 保留旧列表）；失败时不动 `teamWorkspaces` 与 `workspaceChoice`，只设错误；标题描述行下渲染 `role="alert"` 错误行（`text-xs text-destructive`）+「重试」按钮（重新跑同一加载函数，加载中禁用）。失败时下拉仍可用（含「新建协作空间…」），不再伪装成没有已有空间。未改 WorkspaceGrantsSection / TransferSection / 公开链接 / API / e2e / globals.css。
- 步骤 4 完成（仓库根目录）：
  - `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0
  - `corepack pnpm -C apps/web lint` → exit 0（No ESLint warnings or errors）
  - `corepack pnpm -C apps/web exec vitest run` → 全量 **2033 passed / 2 skipped**（268 文件 passed），基线 2029 → +4，正好是新增单测。jsdom 的 window.focus "Not implemented" 输出为既有测试噪音，不影响结果。
