# PROGRESS

- 2026-10-18 约 19:27 Asia/Taipei：规划方（五狗）写好 TASK.md / PROMPT.md，派给 ZCode（GLM-5.3）。基线 master `aec2e7d`（#407 share-collaborator-workspace-names-load-honesty 已合并）。下一任务：TransferOwnershipSection user_profiles 名称查询失败诚实处理（#403 PROGRESS 留下的 follow-up，对标 #407）。
- 2026-10-18 步骤 1 完成：`git pull origin master` Already up to date（HEAD = `aec2e7d`），建分支 `fix/share-transfer-candidate-names-load-honesty`。其它未跟踪 `docs/handoff/*` 与别的 PROGRESS.md 改动保持不动。
- 2026-10-18 步骤 2 核对（基线 `aec2e7d`，`apps/web/components/share/resource-share-dialog.tsx`）：三点全部属实。
  1. 属实：`loadCandidates` 内 `user_profiles` 查询（原 780–783 行）只解构 `data` 丢 `error`；名称查询失败时 `profileRows` 为 null → `names` 空 Map → 全部候选 `name: null` → UI 885 行 `c.name || "协作者"` 全显「协作者」，与真·缺名不可区分；且 `failed` 仍 false，走 `nextTransferCandidatesAfterLoad` 成功分支，无 loadError / 重试。
  2. 属实：ACL（`grantErr` throw）/ members（`memberErr` throw）/ 其它 throw 走 `nextTransferCandidatesAfterLoad` 失败分支（保 `candidatesRef` 快照 + `candidatesLoadError` + 重试行 845–857），#403 主失败逻辑在位，不重做。
  3. 属实：InviteSection / WorkspaceGrantsSection / CollaboratorGrants（#406/#407 已接线 `nextCollaboratorWorkspaceNamesAfterLoad`，见 631–649 行的 failed/else 分支模式）/ 公开链接均已诚实，本任务不改。
- 2026-10-18 步骤 3 完成：
  - 新增 `apps/web/lib/share/transfer-candidate-names-load.ts`：`TRANSFER_CANDIDATE_NAMES_LOAD_ERROR_MESSAGE = "协作者名称加载失败"` + `nextTransferCandidateNamesAfterLoad({ userIds, nameById, error })` → `{ candidates, loadError }`；成功按 userIds 顺序组装（真·缺名仍 null），失败仍组装（能取到的照取）+ 错误文案；type import `TransferCandidate`，未复制接口。
  - 新增 `apps/web/lib/share/transfer-candidate-names-load.test.ts`：5 个用例（成功有名按序 / 成功缺名+display_name null 不算失败 / 失败仍出 candidates+错误文案 / 失败且 userIds 空 / Record 形状等价）。
  - 薄改 `apps/web/components/share/resource-share-dialog.tsx` TransferOwnershipSection `loadCandidates`：`user_profiles` 查询解构 `error: profileErr`；重构为 #407 同构的 failed/else 分支——主失败（grantErr/memberErr/throw）走 `nextTransferCandidatesAfterLoad`（保 `candidatesRef` 快照 + `candidatesLoadError`，与 #403 一致）；主流水线成功走 `nextTransferCandidateNamesAfterLoad`，名称失败时仍 `setCandidates` + 更新 `candidatesRef` + `setCandidatesLoadError`（复用现有 role="alert" 重试行）。渲染层零改动（缺名回退仍 `c.name || "协作者"`），未动勿做清单文件。
- 2026-10-18 步骤 4 完成（仓库根目录）：`corepack pnpm -C apps/web exec tsc --noEmit` 退出码 0；`corepack pnpm -C apps/web lint` 退出码 0（No ESLint warnings or errors）；`corepack pnpm -C apps/web exec vitest run` 全量退出码 0，**2070 passed / 2 skipped**（基线 2065 → +5，本任务新增 5 个用例全过）。
