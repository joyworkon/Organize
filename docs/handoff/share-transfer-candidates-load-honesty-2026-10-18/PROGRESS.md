# PROGRESS — share-transfer-candidates-load-honesty-2026-10-18

执行 Agent：ZCode（GLM-5.3）。基线 master `6d04193`（#402 已合并）。

## 步骤 1：同步与分支 ✅

- `git checkout master && git pull origin master` → Already up to date，HEAD = `6d04193`。
- 分支 `fix/share-transfer-candidates-load-honesty` 已创建。

## 步骤 2：核对背景 1–4 ✅

核查对象 `apps/web/components/share/resource-share-dialog.tsx`（基线 6d04193）：

1. **属实**：TransferOwnershipSection mount 加载 `useEffect`（675–730 行）串行查 `resource_acl` → `workspace_members` → `user_profiles`；`grantErr`（687 行）/ `memberErr`（700 行）`throw` 后落入 `catch { // 候选加载失败按空集处理…; setCandidates([]); }`（720–722 行）→ `candidates = []` → 渲染空态文案「还没有可移交的协作者。先在上方邀请并把对方设为「可编辑」。」（768–771 行）。失败被伪装成真空态。
2. **属实**：合法空态走两处 early-return（692–695 无 editor 授权空间、704–707 成员过滤后只剩自己）`setCandidates([])`，与失败路径不同源；修复需保持二者可区分。
3. **属实**：`user_profiles` 查询（709–715 行）丢掉 `error`、`profileRows || []` 回退显示名——属「有候选但名字缺失」，仍可成功出候选，本任务不改。
4. **属实**：InviteSection（#402，`workspacesLoadError` + `teamWorkspacesRef` + `role="alert"` 重试行，508–520 行）与 WorkspaceGrantsSection / 公开链接段已诚实处理，本任务不动。

结论：问题存在，按 TASK 方案修复。

## 步骤 3：实现 ✅

新增/修改三个文件（未动 InviteSection / WorkspaceGrantsSection / 公开链接 / transfer RPC / e2e / globals.css）：

1. **新增 `apps/web/lib/share/transfer-candidates-load.ts`**：`TransferCandidate`（与组件内 `CandidateUser` 对齐）、`TRANSFER_CANDIDATES_LOAD_ERROR_MESSAGE = "可移交协作者加载失败"`、纯函数 `nextTransferCandidatesAfterLoad({ previous, data, error })` → `{ candidates, loadError }`。成功（error 假值）→ `candidates = [...data ?? []]`（保持顺序；浅拷贝解 readonly）、`loadError = null`；失败 → `candidates = previous`（同引用）、错误文案。与 #402 的 invite-workspaces-load 同构但独立。
2. **新增 `apps/web/lib/share/transfer-candidates-load.test.ts`**：4 个用例——成功有数据保持顺序、成功 data null/空 → 空数组无错误（真·空态）、失败有 previous → 同引用 + 错误文案、失败 previous 空 → 空数组 + 错误文案。
3. **改 `apps/web/components/share/resource-share-dialog.tsx`（仅 TransferOwnershipSection）**：
   - 新增 `candidatesLoadError` / `reloadingCandidates` state + `candidatesRef`（上次成功快照，`TransferCandidate[]`）。
   - mount 加载抽成可重入 `loadCandidates` useCallback：整条流水线（auth → resource_acl → workspace_members → user_profiles）成功时把组装好的 `CandidateUser[]` 交纯函数（error: null）；任一 throw / 查询失败走纯函数失败分支——失败**不覆盖**已有 `candidates`（成功才 set + 更新 ref）。
   - 保留原 active/取消语义：useEffect 传 `{ active }` signal，过期结果丢弃。
   - 渲染：`loading` 转圈不变；失败且无快照 → `role="alert"` 错误行（`text-xs text-destructive`）+「重试」按钮，**不再显示**「还没有可移交的协作者…」假空态；失败但有快照 → 保留 Select + 移交按钮，下方显示错误行 +「重试」；真·空（成功且空且无 loadError）才显示原空态文案。样式全用既有 Tailwind 类（与 #402 InviteSection 重试行一致），未改 globals.css，未加 toast。
   - `user_profiles` 丢 error 的名字回退（背景 3）按 TASK 不改。

## 步骤 4：本地验证 ✅

仓库根目录：

- `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0（修过一处 TS4104：纯函数成功分支 `data ?? []` 改 `[...data ?? []` 浅拷贝解 readonly）
- `corepack pnpm -C apps/web lint` → `✔ No ESLint warnings or errors`，exit 0
- `corepack pnpm -C apps/web exec vitest run` → **Test Files 269 passed | 1 skipped (270)；Tests 2037 passed | 2 skipped (2039)**（基线 2033 passed / 2 skipped，+4 = 本任务 4 个新单测全过）

## 步骤 5：提交 / PR / CI / 合并

（进行中）
