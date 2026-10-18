# PROGRESS

- 2026-10-18 约 18:58 Asia/Taipei：规划方（五狗）写好 TASK.md / PROMPT.md，派给 ZCode（GLM-5.3）。基线 master `7c807b5`（#406 share-collaborator-grants-load-honesty 已合并）。下一任务：CollaboratorGrants workspaces 名称查询失败诚实处理（#406 follow-up）。

## 步骤 1：分支就绪

- 2026-10-18 ZCode：`git checkout master && git pull origin master` → HEAD `7c807b5`（与基线一致）；建分支 `fix/share-collaborator-workspace-names-load-honesty`。

## 步骤 2：背景核查（基线 7c807b5）

- 2026-10-18 ZCode：核对 TASK 背景 1–3，均属实：
  1. **属实**。`apps/web/components/share/resource-share-dialog.tsx` CollaboratorGrants `loadGrants` 中（当时 616 行）：`const { data: wsRows } = await supabase.from("workspaces").select("id, name").in("id", wsIds);` 只解构 `data` 丢 `error`；620 行 `wsName: names.get(row.workspace_id) || "协作空间"`。名称查询失败（supabase 返回 error 不 throw）→ names 全空 → 全部行显示「协作空间」，与真名缺失不可区分。
  2. **属实**。ACL 主失败已由 #406 诚实：`nextCollaboratorGrantsAfterLoad`（lib/share/collaborator-grants-load.ts）+ `loadError` / `role="alert"` 重试行 + `lastSuccessRef` 快照保留；本任务不重做。
  3. **属实**。属主侧 InviteSection（workspacesLoadError 516 行）、WorkspaceGrantsSection、TransferOwnershipSection、公开链接均已诚实（lib/share 下 invite-workspaces-load / transfer-candidates-load / public-share 各有纯函数与错误行）；本任务不动。

## 步骤 3–4：实现

- 2026-10-18 ZCode：新增 `apps/web/lib/share/collaborator-workspace-names-load.ts`：
  - `nextCollaboratorWorkspaceNamesAfterLoad({ grantRows, nameById, error })` → `{ rows, loadError }`；成功/失败都按 grant 顺序组装 rows（缺名回退「协作空间」），失败置 `loadError = COLLABORATOR_WORKSPACE_NAMES_LOAD_ERROR_MESSAGE`（"协作空间名称加载失败"）；`nameById` 接受 Map 或 Record；`CollaboratorGrantRow` 从 collaborator-grants-load import 类型，未复制接口。
  - 单测 `collaborator-workspace-names-load.test.ts` 5 个：成功有名 / 成功缺名回退无错 / 失败仍出 rows + 文案 / 失败且 grant 空为空数组 + 文案 / Record 形状等价。
- 2026-10-18 ZCode：薄改 `apps/web/components/share/resource-share-dialog.tsx` CollaboratorGrants `loadGrants`：
  - workspaces 查询改为 `const { data: wsRows, error: wsErr } = ...`，`wsErr` 不再丢弃；
  - ACL 失败（error/throw）仍走 `nextCollaboratorGrantsAfterLoad`（data: null, error: true）——与 #406 行为一致，保留旧快照 + 「协作授权加载失败」；
  - ACL 成功后交 `nextCollaboratorWorkspaceNamesAfterLoad`：名称失败也 `setRows(next.rows)`（授权列表保留，缺名回退）+ `setLoadError(文案)`，且**仍更新 `lastSuccessRef`**；成功则照常清错误 + setRows；
  - 渲染未动：名称失败且有 rows 时复用已有 `role="alert"` 错误行 +「重试」（列表下方），无新 toast / globals.css 改动。

## 步骤 5：本地验证

- 2026-10-18 ZCode：`corepack pnpm -C apps/web exec tsc --noEmit` → exit 0；`corepack pnpm -C apps/web lint` → exit 0（No ESLint warnings or errors）；`corepack pnpm -C apps/web exec vitest run` → exit 0，**2065 passed / 2 skipped**（基线 2060 passed / 2 skipped，+5 = 新增单测数；输出中 `window.focus` 为 notifications-click 测试既有 jsdom 噪音）。未跑 e2e（按约定）。
