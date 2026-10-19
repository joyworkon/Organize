# PROGRESS — notes-role-load-honesty-2026-10-19

## 2026-10-19 执行 Agent：Kimi K3Max

- [x] 步骤 1 同步基线：master HEAD = `8e969d5`（#434 已合并），与 TASK.md 基线一致；已建分支 `fix/notes-role-load-honesty`。工作区其它 handoff 目录的未提交改动保持不动。
- [x] 步骤 2 背景核实：**属实**。`apps/web/app/(main)/notes/[id]/page.tsx:363-372` `resolveCollabRole` 只解构 `data`、忽略 `error`，无 try/catch；非法/空结果一律返回 `"viewer"`；约 414 行非属主路径调用；约 1864 行 `ResourceShareDialog myRole={noteRole ?? "owner"}`。RPC 失败会静默伪装成「只读协作者」，rpc 抛错为未处理 rejection。#434 已交付 `lib/share/resource-role-load.ts`（`resolveResourceRole` + `RESOURCE_ROLE_LOAD_ERROR_MESSAGE`）与 `ResourceShareDialog` 的 `roleUnverified` / `onRetryRole` props（resource-share-dialog.tsx:70-72,150-151,164-170 确认就绪）。
- [x] 步骤 3 改代码（仅 `apps/web/app/(main)/notes/[id]/page.tsx`，+42/-12）：
  - 新增 import `resolveResourceRole` / `ResolvedResourceRole`（复用 #434 helper，未改其 API、未新建第二 helper）。
  - 新增 state `noteRoleUnverified`（init false）；`loadNote` 开头与 `setNoteRole(null)` 一并清 false。
  - `resolveCollabRole` 改造：rpc 读 error + try/catch（抛错按 `{ data: null, error: e }`），经 `resolveResourceRole` 收敛，返回 `ResolvedResourceRole`；调用方属主分支 `{ role: "owner", unverified: false }`，非属主 `setNoteRole` + `setNoteRoleUnverified`；后续排版迁移判断改用 `resolvedRole.role`。
  - 新增 `retryLoadNoteRole`：仅当前角色为协作者态时单独重调 resource_role 更新 role/unverified，不整页重载。
  - `ResourceShareDialog` 传 `roleUnverified={noteRoleUnverified}` / `onRetryRole={retryLoadNoteRole}`；`myRole={noteRole ?? "owner"}` 保持不变；未改 resource-share-dialog.tsx。
- [x] 步骤 4 本地验证：`tsc --noEmit` exit 0；`lint` exit 0（无 warning）；vitest 全量运行中。
  - vitest 全量 exit 0：**2232 passed / 2 skipped**（298 文件，与基线一致）。未在本地跑 e2e。
