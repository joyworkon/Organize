# PROGRESS — shared-notes-role-load-honesty

执行 Agent：Kimi（kimi-code/k3，thinking.effort=max）。任务书见同目录 TASK.md。

## 2026-10-19 执行记录

### 1. 基线同步
- `git checkout master && git pull origin master`：HEAD = `090c36ebb618bddc44998951f15d04873fa5f8f0`（#432 已合并），与 TASK 基线一致。
- 建分支 `fix/shared-notes-role-load-honesty`。

### 2. 背景核实（TASK 步骤 2）
核实 `apps/web/hooks/use-shared-notes.ts` 76–86 行：
- 每行 `supabase.rpc("resource_role", ...)` 只解构 `data: role`，**未读 `error`**；
- `isCollabRole(role) ? role : "viewer"`：RPC 报错 / data 为 null / 非法值时静默变成 `viewer`；
- `Promise.all(rows.map(...))` 中任一 rpc 抛异常会 reject 整个 Promise.all → 走主列表 catch → 整页错误（单行失败拖垮整页）；
- 页面 `shared/page.tsx` Badge/extra 直接 `collabRoleLabel(note.myRole)` → 把「权限没查到」显示成「仅查看」。

**结论：属实，未修好，按 TASK 目标修复。**

### 3. 实现（TASK 步骤 3）
- 新增 `apps/web/lib/share/shared-notes-role-load.ts`：`SHARED_NOTES_ROLE_LOAD_ERROR_MESSAGE`（"部分笔记的权限加载失败，请重试"）、`SHARED_NOTE_ROLE_UNVERIFIED_LABEL`（"权限未加载"）、`resolveSharedNoteRole({ data, error })`（成功原样 / 失败 viewer+roleUnverified）、`sharedNotesRoleLoadError(items)`（任一未验证返回常量，空数组 null）。
- 新增 `shared-notes-role-load.test.ts`：10 个用例（owner/editor 原样、error 真值、data null、非法字符串、异常对象、汇总有/无 unverified、空数组、label 常量）。
- `use-shared-notes.ts`（仅 `useSharedNotes`，未碰 `useHasSharedNotes`）：`SharedNoteItem` 加 `roleUnverified: boolean`；单行 rpc 用 try/catch 包住并读取 error，经 `resolveSharedNoteRole` 收敛——单行失败不再 reject 整个 Promise.all；新增 state `rolesError`（主查询成功时 = `sharedNotesRoleLoadError(assembled)`，rows 空 → null；未登录清空；主查询失败 catch 路径保持 #431 原样不动）；返回值加 `rolesError`。
- `shared/page.tsx`：`rolesError` 且列表有内容时列表上方 `role="alert"` + 重试行（样式照抄 ownerNamesError 行，两条提示可同时出现）；`note.roleUnverified` 时 Badge（secondary）与搜索 extra 用 `SHARED_NOTE_ROLE_UNVERIFIED_LABEL`，不再显示「仅查看」；为假时保持 `collabRoleLabel(note.myRole)`。未改 globals.css，未新增依赖。
