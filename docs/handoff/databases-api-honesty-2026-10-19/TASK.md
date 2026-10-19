# 任务：databases / rows API 写读路径不诚实（规划：五狗；执行：Kimi K3Max）

**执行 Agent：Kimi（`kimi-code/k3` + thinking.effort=max，即 K3Max）**。Codex 约到 2026-10-22 前不可用。难度：小～中（四个 route + 纯函数/单测；mock shim 无 databases handler）。

仓库 `/Users/k/Documents/ZCode/Organize`，基线 master `9bc41c8`（#453 notes-suggestions-move-block-api-honesty 已由 Kimi K3Max 合并）。只做下面这件事，不要扩大范围。

## 背景
`docs/design/migration-plan.md` 测试矩阵「data & network」：失败可重试、不假装成功、状态配文字。规划方核查四个路由（请复核）：

1. **属实**。`apps/web/app/api/databases/route.ts`、`databases/[id]/route.ts`、`databases/[id]/rows/route.ts`、`databases/[id]/rows/[rowId]/route.ts` 几乎所有 DB/RPC 错误都是 `NextResponse.json({ error: error.message }, { status: 500 })`（含 `dbErr.message` / `noteErr.message` / `maxErr.message`）——原样泄露。仓库已有 `serverError`（`@/lib/api/error`）。
2. **属实**。POST `/api/databases`、PATCH `/api/databases/[id]`、POST `/api/databases/[id]/rows`、PATCH `.../rows/[rowId]` 均用 `await request.json().catch(() => ({}))`：非法 JSON **静默变成空对象**，不是 400。空对象对 POST databases 会带着默认 title「未命名数据库」继续 insert；对 POST rows 会插入空 `values`；对 PATCH 会落到已有的「没有可更新的字段」400——但非法 JSON 与空 PATCH 语义应分开（非法 →「请求格式错误」）。
3. **属实**。PATCH 两个写路径用 `.single()`：目标不存在 / 已删 / 无权限时 PGRST116 → 当前当 500 回显 message，应为 404。
4. **属实（请复核 mutate_trash 返回）**。DELETE `/api/databases/[id]` 与 DELETE `.../rows/[rowId]` 走 `mutate_trash`（`database` / `database_row`），忽略 RPC 返回的 `affected`，无 error 一律 `{ ok: true }`——0 行时假装成功。对照 `notes/[id]` DELETE + `resolveNoteDelete`：`affected === 0` → 404。

调用方：`database-block.tsx`、`table-view.tsx`、`database-block-client.ts`（含 linked-database 列表 GET）。多数看 `res.ok`；`mock api-shim` **未实现** `/api/databases*`（注释写明），无需改 shim。

## 目标
1. **最小改动**。建议在 `apps/web/lib/databases/` 新增小纯函数（如 `api-mutation.ts`），集中「解析请求体 / 拼 PATCH updates / 分类 PGRST116 vs 其它 / 分类 DELETE affected」，便于单测；route 只按结果分支。可对照 `lib/notes/api-mutation.ts`、`lib/canvas/api-mutation.ts`，不要改那些文件。
2. 所有数据库/RPC 错误改用 `serverError(error)`（不泄露 message）。GET `[id]`：无行 → 仍 404「数据库不存在」；其它 error → `serverError`（现状已区分 `error` 与 `!data`，把 `error.message` 换成 `serverError` 即可）。父库校验（rows 路由）同理：`dbErr` → `serverError`，`!db` → 404「数据库不存在」。
3. POST / PATCH 请求体：非法 JSON 或顶层非对象 → 400 `{ error: "请求格式错误" }`，不发任何写。合法空对象再走现有字段规则（PATCH 无可更新字段仍 400「没有可更新的字段」）。
4. PATCH databases / rows：0 行（PGRST116 / `isNoRowsError`）→ 404（数据库可用「数据库不存在或无权限」；行可用「行不存在或已删除」或同义）；成功仍返回更新后的行（形状不变）。现有可更新字段规则（title/icon/schema/views；values/sort）**不变**。注意 PATCH databases 里 `icon` 赋值若得到 `undefined` 不要写入 updates（保持现状语义）。
5. DELETE：读取 RPC `data` 为 number 的 `affected`；`error` → `serverError`（或对照 notes 的通用删除失败文案 + code，二选一写清并单测）；`affected === 0` → 404「数据库不存在或已删除」/「行不存在或已删除」；`affected > 0` 仍 `{ ok: true }`（可附带 `affected`，若加字段需确认客户端只认 `ok`——目前客户端只看 ok，附带也可）。**不要改** `mutate_trash` SQL / 迁移。
6. POST databases：成功仍 201；父笔记校验 `noteErr` → `serverError`，`!noteCheck` 仍 400「父笔记不存在」；主键冲突走 `serverError` → 409「数据已存在」。POST rows：成功仍 201；`maxErr` → `serverError`。
7. **核对调用方**：`rg "/api/databases"`；只在确有必要时做最小客户端调整并补测。默认预期零客户端改动。
8. mock shim：无 databases handler → **不动** shim。
9. **单测**：纯函数（合法/非法 JSON；空 PATCH vs 非法 JSON；PATCH/DELETE 0 行与 1 行；父库不存在分类）。不新增依赖。
10. **勿做**：不改 schema/RLS/迁移/RPC、`database-block-client` 业务流（除非为诚实性所必需）、其它 API、e2e、`globals.css`；不新增依赖；不改 `lib/databases/block-mutation-result.ts` / `linked-list-load.ts` 除非测试必须。

## 执行步骤（按顺序）
1. `git checkout master && git pull origin master`（osxkeychain 挂起就用 `git -c 'credential.helper=!gh auth git-credential' pull origin master`），确认 HEAD 为 `9bc41c8` 或更新；`git checkout -b fix/databases-api-honesty`。**提交时只 add 本任务业务文件与本目录 PROGRESS.md**（可含本目录 TASK.md/PROMPT.md）；其它未跟踪 `docs/handoff/*` 及别的目录未提交的 PROGRESS 改动保持不动。切分支或 `gh pr merge` 切回 master 被本地 dirty handoff 卡住：先 `git stash push -m …`（只 stash 已跟踪改动），最后 stash pop；不要在特性分支上产生本地 merge 提交。
2. 核对背景 1–4 是否属实（含最新 `mutate_trash` 对 database / database_row 的 `affected` 语义），写入 PROGRESS.md。若已修好则说明并停止。
3. 按「目标」做最小修改 + 单测。
4. 本地验证（仓库根目录）：
   - `corepack pnpm -C apps/web exec tsc --noEmit`
   - `corepack pnpm -C apps/web lint`
   - `corepack pnpm -C apps/web exec vitest run`（全量）
   记录退出码与 vitest 数（基线 **2429 passed / 2 skipped**，新增单测相应 +N）。不在本地跑 e2e。
5. 提交 → push → `gh pr create` → 等 CI 五项（verify / db-test / e2e-test / sw-e2e / collab-e2e）全绿 → `gh pr merge --squash --delete-branch` → 本地切回 master 并 pull；确认远端特性分支已删（未删就 `git push origin --delete <分支>`）。不 force push、不直推 master。每步追加 PROGRESS.md（**PR 开出后不要再为 PROGRESS.md 单独推提交，免得重跑 CI**）。CI 失败就看日志修复再普通 push；无关 flake 可 `gh run rerun --failed` 一次。
6. **合并后不要再开只改 PROGRESS.md 的文档 PR**：最终状态写本地 PROGRESS.md（保持未提交），然后**退出进程**。

## 完成定义
- PR 已 squash 合并进 master，本地 master 已同步，远端分支已删，进程已退出。
- databases / rows API 不再泄露数据库报错；非法 JSON → 400；PATCH/DELETE 0 行诚实 404；创建/列表/表格块既有语义不受影响。
- tsc / lint / vitest 全绿；CI 五项全绿。

## 额度/限流
若额度剩约 3% 或遇限流/配额报错：写 HANDOFF.md + PROMPT.md（已完成/未完成步骤、确切文件与命令）后退出。

## 后续候选（给规划方，本任务不做）
- `collections/[id]/items` / `digest`、`library/items`、`imports`、`trash` 等仍有 `error.message` 回显或拼接
- `ai/ask` / `ai/materials` / `ai/settings` / `scrape` / `oembed` / `push/subscriptions` / cron 类
