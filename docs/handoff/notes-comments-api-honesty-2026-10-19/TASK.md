# 任务：notes-comments-api-honesty（2026-10-19）

执行 Agent：Kimi K3Max（`-m kimi-code/k3`，thinking effort max）
分支：`fix/notes-comments-api-honesty`

## 背景
`apps/web/app/api/notes/[id]/comments/route.ts`（GET/POST/PATCH/DELETE 评论线程与评论）仍有诚实性问题，与前几轮（#447 plugins、#448 synced-blocks、#449 canvas、#450 notes CRUD、#451 notes tags）同类。

## 已知问题（先核实再改）
1. 所有分支 `NextResponse.json({ error: error.message }, 500)` 泄露数据库报错 → 改用 `lib/api/error.ts` 的 `serverError`。
2. POST / PATCH / DELETE 都直接 `await request.json()`，非法 JSON 抛异常变 500 → 400「请求格式错误」（复用已有 `parseJsonBody`）；顶层非对象同样 400。
3. PATCH 编辑评论 / 切换 resolved 用 `.select().single()`：目标不存在或不是自己的评论时 PGRST116 变 500 并泄露 → 应 404（评论/线程不存在）。
4. DELETE commentId / threadId 0 行时返回 `{ success: true }` 假成功 → 判断：评论删除 0 行应 404；线程删除 0 行应 404。（若核对客户端发现依赖幂等成功，在 PROGRESS 写明理由后可保留，但要一致。）
5. POST 回复已有线程时 `body.threadId` 未校验类型；`blockId`/`body` 非字符串时 `String()` 强转 → 非字符串应 400。
6. `getContext` 里 note 查询任意错误都伪装 404：区分 PGRST116（404）与其它错误（serverError 500），与 #450 notes 一致。

## 建议做法
- 抽纯函数到 `apps/web/lib/notes/comments-api.ts`（解析/校验请求体、把 Supabase 结果映射成响应），补 vitest 单测（覆盖上面每条）。
- 先核对调用方：`components/editor/tiptap-editor.tsx`、`components/editor/editor-dialogs.tsx`、`components/notes/note-page-comments*`，以及 mock `lib/mock/api-shim.ts` 的 comments handler。只在确有必要时做最小客户端/shim 调整，并让 shim 行为与真实路由一致（含新增 400/404）。
- 正常路径行为不变：GET 返回线程嵌套评论（按时间正序）、POST 201、新建线程失败回滚线程。

## 不做
不改 schema/RLS/迁移、suggestions/move-block/versions/tags/notes CRUD 路由、e2e、globals.css；不新增依赖。

## 验证 / 完成定义
- `pnpm --filter web exec tsc --noEmit`、lint、vitest 全过（基线 2385 passed / 2 skipped，新增测试后数量上升）。
- 开 PR → CI 五项（verify/db-test/e2e-test/sw-e2e/collab-e2e）全绿 → `gh pr merge --squash --delete-branch`；本地 master 同步。
- 不 force push、不直推 master；不要本地跑 e2e。
- 每步追加本目录 PROGRESS.md；合并后最终状态只写本地 PROGRESS.md。
