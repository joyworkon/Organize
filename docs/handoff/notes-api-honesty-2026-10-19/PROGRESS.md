# PROGRESS — notes-api-honesty-2026-10-19

- 2026-10-19 约 10:05 EDT：规划方（五狗）写好 TASK.md / PROMPT.md，派给 Kimi K3Max。基线 master `b9e22de`（#449 canvas-patch-cas-honesty 已合并）。vitest 基线 2363 passed / 2 skipped。
- 10:09 EDT：已切 `fix/notes-api-honesty`（基线恰为 b9e22de，pull 显示 Already up to date）。
- 10:09 EDT：复核 TASK 背景 1–5，全部属实：
  1. `app/api/notes/route.ts` GET:43、POST:101 原样回 `error.message`；`[id]/route.ts` PATCH:154 同。
  2. POST:60、PATCH:48 `await request.json()` 无 try/catch，非法 JSON → 未处理 500。
  3. PATCH 空 updateData 仍 `.update({})`；0 行 PGRST116 走 500 + message。
  4. GET `[id]` 任意 error 一律 404「笔记不存在」。
  5. DELETE `affected === 0` 仍 `{ success: true, affected: 0 }`。
- 调用方核对（`rg "/api/notes"`）：唯一调 POST /api/notes 的 `components/editor/extensions/database-block-client.ts:83` 已查 `noteRes.ok`，新 400/409 仅走失败 toast 分支，客户端无需改。GET/PATCH/DELETE `/api/notes/[id]` 无前端调用（前端只调 tags/comments/suggestions/versions/move-block/auto-group 子路由，不在范围）。
- mock shim 核对：`lib/mock/api-shim.ts` 仅注册 versions/comments/suggestions/move-block 子路由，无 `/api/notes` GET/POST 与 `/api/notes/:id` GET/PATCH/DELETE handler → 按 TASK §8 不动 shim。
- 10:17 EDT：实现完成。
  - 新增 `apps/web/lib/notes/api-mutation.ts`（纯函数）：`parseJsonBody`（非法 JSON/非对象 → 400 请求格式错误）、`buildNotePatchUpdate`（空 updateData → 400 没有可更新的字段；字段规则与原 route 逐条一致）、`noteGetRejection`/`notePatchRejection`（PGRST116 → 404「笔记不存在」/「笔记不存在或无权限」，其它 → null 交给 serverError）、`resolveNoteDelete`（RPC error → 500 删除笔记失败 + TRASH_MUTATION_FAILED 保持原文案；affected 0 → 404 笔记不存在或已删除）。
  - `app/api/notes/route.ts`：GET/POST 数据库错误改 `serverError`（23505 自动 409 数据已存在）；POST 经 parseJsonBody。
  - `app/api/notes/[id]/route.ts`：GET/PATCH 错误按 PGRST116 分类 404、其余 serverError；PATCH 经 parseJsonBody + buildNotePatchUpdate，空 PATCH 不发 update、不递增 content_revision；parent 存在性/循环校验原样保留；DELETE 走 resolveNoteDelete，成功形状 `{ success, affected }` 不变。
  - 客户端零改动（database-block-client 已查 `noteRes.ok`）。
- 10:17 EDT 本地验证全绿：`tsc --noEmit` 0；`next lint` 0（无警告）；`vitest run` 310 passed + 1 skipped 文件，**2376 passed / 2 skipped**（基线 2363 + 新增 13 条用例）。
