# PROGRESS — plugins-api-honesty-2026-10-19

## 2026-10-19 执行（Kimi K3Max）

- [x] 同步 master：HEAD = `a462857`（#446），建分支 `fix/plugins-api-honesty`。
- [x] 背景复核（全部属实）：
  1. 四个 handler（GET/POST `/api/plugins`、PATCH/DELETE `/api/plugins/[id]`）均 `NextResponse.json({ error: error.message }, { status: 500 })`，未用 `@/lib/api/error` 的 `serverError`。属实。
  2. POST（route.ts:39）、PATCH（[id]/route.ts:19）`await request.json()` 无保护，非法 JSON → 未捕获 500。属实。
  3. PATCH：`updateData` 为空仍发 update；`.single()` 0 行 → PGRST116 → 500。属实。
  4. DELETE：不带 `.select("id")`，0 行也返回 `{ success: true }`。属实。
  5. 插件页 `togglePlugin`（page.tsx:39-41）：不查 `recordsResponse.ok` 直接 `.json().find`，GET 失败时 TypeError 文案。属实。
  - mock shim（`lib/mock/api-shim.ts`）有 GET/POST/PATCH plugins 路由：`patchPlugin` 0 行返回 500「插件不存在」，需对齐 404；无 DELETE 路由，不用补。
- [x] 代码修改（最小改动，响应成功形状不变，bootstrap.ts 未动）：
  - 新增 `apps/web/lib/plugin/api-mutation.ts` 纯函数：`parseJsonBody` / `buildPluginPatch` / `readPluginPatchResult` / `readPluginDeleteResult` / `readPluginRecords`。
  - `app/api/plugins/route.ts`：GET/POST 的 DB error 改 `serverError(error)`；POST 非法 JSON → 400「请求格式错误」（经 `parseJsonBody(await request.text())`）。
  - `app/api/plugins/[id]/route.ts`：PATCH 非法 JSON → 400；空字段 → 400「没有可更新的字段」；`.single()` → `.maybeSingle()`，0 行 → 404「插件不存在或无权限」；DELETE 加 `.select("id")`，0 行 → 404「插件不存在或已卸载」；两处 DB error 改 `serverError`。
  - `app/(main)/plugins/page.tsx` `togglePlugin`：GET 非 2xx 或返回非数组 → 抛「加载插件配置失败，请重试」（`.json()` 失败也归入），不再 TypeError。
  - `lib/mock/api-shim.ts` `patchPlugin`：0 行 500「插件不存在」→ 404「插件不存在或无权限」，与真实路由对齐。
  - 单测：新增 `lib/plugin/api-mutation.test.ts`（18 例）；`lib/mock/api-shim.test.ts` 末尾补 PATCH 已知/未知 id 两例。
- [x] 本地验证：`tsc --noEmit` exit 0；`next lint` exit 0（无警告）。
- [x] `vitest run` 全量：306 文件通过、**2319 passed / 2 skipped**，exit 0（基线 2298 + 新增 20，另 1 例为既有浮动）。
- [x] 提交 `7d4e408`（8 文件：2 route + 插件页 + api-mutation + 测试 + shim + shim 测试 + 本 PROGRESS），push 并开 PR #447。
- [x] CI 五项全绿（run 39247158327）：verify 3m30s / db-test 2m31s / sw-e2e 4m5s / e2e-test 8m51s / collab-e2e 11m11s。
