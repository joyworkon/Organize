# PROGRESS：笔记标签 API 写路径诚实性

执行：Kimi K3Max（kimi-code/k3）。基线 master `3ae3135`（#450 已合并）。分支 `fix/notes-tags-api-honesty`。

## 2026-10-19

- [x] 同步 master：`git pull origin master` → Already up to date，HEAD=`3ae3135`。
- [x] 建分支 `fix/notes-tags-api-honesty`。
- [x] 背景核查（`apps/web/app/api/notes/[id]/tags/route.ts`）：
  1. **属实** — `route.ts:76` POST tags upsert 失败 `return NextResponse.json({ error: tagErr.message }, { status: 500 })`，泄露数据库报错；同文件 GET/DELETE/insert 分支均已 `serverError`。
  2. **属实** — `route.ts:61` `await request.json()` 无 try/catch，非法 JSON → 未捕获 500。
  3. **属实** — 缺 tag_id/name → 400「需要提供 tag_id 或 name」；23505 → 200 success；均保持不变。
  4. **属实** — GET/DELETE 已 `serverError`；DELETE 0 行仍 `{ success: true }`（幂等，保持）。
- [x] 复用判定：`lib/notes/api-mutation.ts` 的 `parseJsonBody`（非法 JSON / 顶层非对象 → 400「请求格式错误」）语义与 TASK 要求完全一致，直接复用，不新增依赖。
- [x] 新增 `apps/web/lib/notes/note-tags-api.ts`：`resolveNoteTagRef`（抽取 tag_id/name，保持真值/trim 语义，缺字段 → 400「需要提供 tag_id 或 name」）+ `parseNoteTagPostBody`（复用 parseJsonBody，非法 JSON/非对象 → 400「请求格式错误」）。
- [x] 改 `route.ts` POST：`request.json()` → `parseNoteTagPostBody` 按结果分支；upsert `tagErr` → `serverError(tagErr)` 不再泄露 message；23505 → 200、insert → 201、缺失字段 400 兜底、GET/DELETE 全部不变。
- [x] 单测 `apps/web/lib/notes/note-tags-api.test.ts`（9 条：非法 JSON/空体、顶层数组/字符串/null/数字、tag_id、name trim、tag_id 优先、缺字段、空白串/空串、name=null、数字 name toString）。
- [x] 调用方核对：mock api-shim 无 `/api/notes/:id/tags` handler（不动）；`use-tags.ts` 经 `readAddTagMutation`/`removeTagMutationFromResponse` 按 HTTP 状态走失败分支；`auto-tag-dialog.tsx` 只发合法 JSON `{ name }`，不受新 400 影响。客户端零改动。
- [x] 本地验证：`tsc --noEmit` exit 0；`next lint` exit 0（无警告）；`vitest run` 全量 **2385 passed / 2 skipped**（基线 2376 + 新增 9），311 文件通过。
