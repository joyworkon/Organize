# 任务：notes-suggestions-move-block-api-honesty（2026-10-19）

执行 Agent：Kimi K3Max（`-m kimi-code/k3`，thinking effort max）
分支：`fix/notes-suggestions-move-block-api-honesty`

## 背景
与前几轮（#448 synced-blocks、#449 canvas、#450 notes CRUD、#451 notes tags、#452 notes comments）同类。本轮只处理两个小路由：
- `apps/web/app/api/notes/[id]/suggestions/route.ts`（GET/POST/PATCH 块编辑建议）
- `apps/web/app/api/notes/[id]/move-block/route.ts`（POST 跨笔记移动块，调用 RPC `move_note_block`）

## 已知问题（先核实再改）
### suggestions
1. GET/POST 失败 `NextResponse.json({ error: error.message }, 500)` 泄露数据库报错 → 改用 `lib/api/error.ts` 的 `serverError`。
2. PATCH 任意错误都返回 409 并回显 `error.message`：应区分 PGRST116（建议不存在或已处理 → 409「建议不存在或已处理」，与 mock shim 文案一致）与其它真实错误（serverError 500）。
3. POST / PATCH 直接 `await request.json()`，非法 JSON 抛异常变 500 → 400「请求格式错误」；顶层非对象同样 400。
4. POST 字段类型未校验：`blockId` 非字符串应 400；`originalBlock`/`proposedBlock` 非对象应 400（保持「建议内容不完整」文案或明确的类型错误文案均可，单测覆盖）。PATCH `suggestionId` 非字符串 → 400「无效状态」。
5. `authorize` 里 note 查询任意错误都伪装 404：区分 PGRST116 / 无数据（404「笔记不存在」）与其它错误（serverError 500），与 #450/#452 一致。
6. GET 排序：真实路由按 `created_at` 倒序，mock shim 正序。核对 `components/editor/editor-dialogs.tsx` SuggestionDialog 与 `lib/editor/block-suggestions-load.ts` 期望哪种，统一 shim 与路由（不要改动客户端显示语义；若无依赖则让 shim 对齐真实路由倒序）。

### move-block
7. 直接 `await request.json()`，非法 JSON → 400「请求格式错误」；顶层非对象 400；`targetNoteId`/`blockId` 非字符串时 `String()` 强转 → 400「移动目标无效」。
8. RPC 失败一律 409 回显 `error.message`（泄露数据库/RPC 报错）。先读 RPC `move_note_block` 的定义（supabase/migrations 里 rg），把它主动 raise 的业务错误（笔记不存在/无权限、块不存在等）映射成稳定的中文文案 + 合理状态码（如 404/409），其它错误走 serverError 500；不再回显原始 message。
9. 核对客户端 `editor-dialogs.tsx` MoveDialog（约第 120 行 fetch move-block）只依赖 `response.ok` + `data.error`，确认无需改动。

## 建议做法
- 抽纯函数到 `apps/web/lib/notes/suggestions-api.ts` 与 `apps/web/lib/notes/move-block-api.ts`（或合并为一个文件，自定），覆盖请求体解析/校验、Supabase/RPC 错误分类；补 vitest 单测逐项覆盖上面各条。可复用已有 `parseJsonBody` 模式（参考 `lib/notes/api-mutation.ts`、`lib/notes/comments-api.ts`）。
- 对齐 `lib/mock/api-shim.ts` 的 listSuggestions/createSuggestion/patchSuggestion/moveBlock：非对象 body / 字段类型错 → 400；move-block 不存在/块不存在的状态码与文案与真实路由映射一致；必要时补 `api-shim.test.ts`。
- 正常路径行为不变：GET 返回数组、POST 201、PATCH 返回更新后行、move-block 成功 `{ success: true }`。

## 不做
不改 schema/RLS/迁移/RPC 本身、comments/versions/tags/notes CRUD 路由、e2e、globals.css；不新增依赖。

## 验证 / 完成定义
- `pnpm --filter web exec tsc --noEmit`、lint、vitest 全过（基线 2411 passed / 2 skipped，新增测试后数量上升）。
- 开 PR → CI 五项（verify/db-test/e2e-test/sw-e2e/collab-e2e）全绿 → `gh pr merge --squash --delete-branch`；确认远端分支已删；本地 master 同步。
- 不 force push、不直推 master；不要本地跑 e2e。
- 每步追加本目录 PROGRESS.md；合并后最终状态只写本地 PROGRESS.md。
