# PROGRESS — synced-blocks API 诚实性

执行 Agent：Kimi K3Max。基线 master `0340d58`。分支 `fix/synced-blocks-api-honesty`。

## 2026-10-19 步骤记录

### 1. 基线与分支
- `git pull origin master` → Already up to date，HEAD = `0340d58988637d200b56e8fbb4e63782babf778d`（与任务书基线一致）。
- 建分支 `fix/synced-blocks-api-honesty`。
- 工作区有大量其它 handoff 目录的 dirty/untracked 文件（其它 Agent 任务），本任务只 add 业务文件 + 本目录 PROGRESS.md。

### 2. 背景核查（TASK.md 背景 1–4，全部属实）
- **属实 1**：`app/api/synced-blocks/route.ts`（GET/POST）与 `[id]/route.ts`（PATCH/DELETE）所有 DB/RPC 错误均 `NextResponse.json({ error: error.message }, { status: 500 })` 原样泄露；POST 主键冲突（23505）也当 500。仓库已有 `serverError`（`lib/api/error.ts`，23505→409「数据已存在」+ `code:"DUPLICATE"`）。
- **属实 2（最要紧）**：PATCH `request.json().catch(() => ({}))` + `Array.isArray(body.content) ? body.content : []`——非法 JSON / content 非数组时静默把同步区块覆盖成空内容、递增 revision、返回 200。数据丢失并假装成功。
- **属实 3**：POST 同样逻辑静默创建空区块 201；`id` 非字符串静默忽略。
- **属实 4**：DELETE 无 `.select("id")`，0 行删除（不存在/已删/不属本人）也返回 `{ ok: true }`。

### 3. 客户端调用方核对（新 400/404 影响面）
`rg` 全仓 `/api/synced-blocks` 调用方：
- `components/editor/extensions/synced-block-client.ts`：唯一 POST 调用方，恒传 `{ content: [{ type: "paragraph" }] }`（数组）。→ POST 对「未提供 content」按 400 处理安全；**结论：POST content 缺失或非数组一律 400**。
- `components/editor/extensions/synced-block-sync.ts`：唯一 PATCH/GET 调用方，PATCH 恒传 `{ content, expected_revision }`（content 来自编辑器序列化数组）；对非 2xx 走 `{ ok: false, reason: "http", status }` 失败分支，不假装成功。→ 新 400 不会让正常流程误报错（正常流程恒传数组）。
- **无任何客户端调 DELETE** `/api/synced-blocks/[id]`（仅 e2e 的 `page.route` 拦截与测试用）。→ DELETE 0 行 404 不影响任何正常流程。
- `e2e/synced-block.spec.ts` 用 `page.route` mock 拦截，不依赖真实路由响应码；不改动。
- 结论：**无需调整任何客户端代码**。

### 4. 实现（最小改动）
- 新增 `apps/web/lib/synced-block/api-mutation.ts` 纯函数：
  - `parseJsonBody(request)`：非法 JSON / 顶层非对象 → 400「请求格式错误」；
  - `validateCreateBody(body)`：content 缺失或非数组 → 400「同步区块内容格式错误」；`id` 提供了但不是非空字符串 → 400「同步区块 id 格式错误」；
  - `validatePatchBody(body)`：content 缺失或非数组 → 400（不调 RPC、不覆盖）；`expected_revision` 语义不变（非整数 → null 兜底覆盖）；
  - `deleteBlockResult(deletedCount)`：0 行 → 404「同步区块不存在或已删除」。
- `app/api/synced-blocks/route.ts`：GET/POST 的 DB 错误改 `serverError(error)`（不泄露 message；POST 23505 → 409「数据已存在」+ code DUPLICATE）；POST 用纯函数校验，非法输入不再静默创建空区块；201 形状不变。
- `app/api/synced-blocks/[id]/route.ts`：PATCH 校验失败 400 先于 RPC（不再静默清空 + 假 200）；RPC 错误改 `serverError`；200/409/404 形状不变。DELETE 加 `.select("id")`，0 行 → 404；成功仍 `{ ok: true }`；DB 错误改 `serverError`。
- mock shim（`lib/mock/api-shim.ts` 三个 handler）复用同一组纯函数对齐：POST 重复 id 500 → **409**（形状 `{ error: "数据已存在", code: "DUPLICATE" }`）；POST/PATCH 非对象 body → 400「请求格式错误」、content/id 非法 → 400（PATCH 400 先于 404，与真实 route 顺序一致）；DELETE 0 行 → 404。shim dispatch 层对「非法 JSON 字符串」仍 500（共享层，改动会影响全部 mock 路由，超出本任务范围；真实 route 的 400 由纯函数单测覆盖）。
- **客户端零改动**：POST/PATCH 调用方恒传数组 content；无客户端调 DELETE；e2e `synced-block.spec.ts` 走 `page.route` 拦截（PATCH 均传合法数组），不依赖旧行为。
- 单测：新增 `lib/synced-block/api-mutation.test.ts`（15 例）；`lib/mock/api-shim.test.ts` 补 3 例（POST 重复 id 409 / POST 400 不建空块 / PATCH 400 不覆盖不递增 revision），并在既有用例尾部补「重复 DELETE → 404」。

### 5. 本地验证（仓库根目录，2026-10-19）
- `corepack pnpm -C apps/web exec tsc --noEmit` → 退出码 0。
- `corepack pnpm -C apps/web lint` → 退出码 0，No ESLint warnings or errors。
- `corepack pnpm -C apps/web exec vitest run`（全量）→ **2337 passed / 2 skipped（2339 总）**，307 文件通过 / 1 跳过；基线 2319 + 新增 18（api-mutation 15 + api-shim 3），数目吻合。未在本地跑 e2e。
