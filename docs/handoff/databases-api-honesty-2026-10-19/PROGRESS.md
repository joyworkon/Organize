# PROGRESS — databases-api-honesty

## 2026-10-19
- [ ] 任务已派给 Kimi K3Max，待开始。
- [x] Kimi K3Max 开始执行：master `9bc41c8` 已同步（pull: Already up to date），建分支 `fix/databases-api-honesty`。
- [x] 背景复核（全部属实）：
  1. 四个路由（`databases/route.ts`、`databases/[id]/route.ts`、`databases/[id]/rows/route.ts`、`databases/[id]/rows/[rowId]/route.ts`）全部 DB/RPC 错误均为 `{ error: error.message }` 500 原样回显（含 dbErr/noteErr/maxErr）。
  2. POST databases / PATCH databases / POST rows / PATCH row 均为 `request.json().catch(() => ({}))`，非法 JSON 静默变空对象，无 400。
  3. PATCH databases / PATCH row 用 `.single()`，PGRST116 当 500 回显。
  4. DELETE databases / DELETE row 走 `mutate_trash`（`database` / `database_row`），忽略 RPC 返回 number `affected`，无 error 一律 `{ ok: true }`（对照 `notes/[id]` DELETE + `resolveNoteDelete`：`affected === 0` → 404）。
- [x] 调用方核对（`rg "/api/databases"`）：`database-block.tsx`、`table-view.tsx`、`database-block-client.ts` 只看 `res.ok` 与 body.error 文案（`readMutationError` + `resolveBlockMutationResult`），成功响应形状不变 → 零客户端改动。mock api-shim 无 `/api/databases*` handler（注释写明），不动 shim。
- [x] 实现：新增 `apps/web/lib/databases/api-mutation.ts`（parseJsonBody / buildDatabasePatchUpdate / buildRowPatchUpdate / isNoRowsError / databasePatchRejection / rowPatchRejection / classifyParentDatabase / resolveDatabaseDelete / resolveRowDelete）+ 单测 `api-mutation.test.ts`（20 例）。四个路由全部 DB/RPC 错误改 `serverError`（不泄露 message）；四处 POST/PATCH 非法 JSON/非对象 → 400「请求格式错误」，合法空对象仍走既有字段规则（PATCH 空字段 → 400「没有可更新的字段」；POST databases 合法空对象仍默认「未命名数据库」）；PATCH databases/rows 的 PGRST116 → 404（「数据库不存在或无权限」/「行不存在或已删除」）；DELETE 读 `mutate_trash` 返回 number，`affected === 0` → 404（「数据库不存在或已删除」/「行不存在或已删除」），`>0` 仍 `{ ok: true }`，RPC error → serverError。父库校验抽 `checkParentDatabase`（rows 两个路由内局部函数 + classifyParentDatabase）：dbErr → serverError、无行 → 404「数据库不存在」。PATCH databases 的 `icon` 非 null/string 时不写入 updates（保持现状语义，不再把 undefined 塞进 updates）。POST 成功仍 201、PATCH 成功仍返回更新行、主键冲突经 serverError → 409「数据已存在」。
- [x] 本地验证：`tsc --noEmit` exit 0；`lint` exit 0；`vitest run` exit 0，**2449 passed / 2 skipped**（基线 2429 + 新增 20）。
