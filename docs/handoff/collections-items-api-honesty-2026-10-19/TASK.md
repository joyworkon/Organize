# 任务：collections/[id]/items API 写路径不诚实（规划：五狗；执行：Kimi K3Max）

**执行 Agent：Kimi（`kimi-code/k3` + thinking.effort=max，即 K3Max）**。Codex 约到 2026-10-22 前不可用。难度：小（单 route + 可选纯函数/单测；有 mock shim，需对齐）。

仓库 `/Users/k/Documents/ZCode/Organize`，基线 master `0b0458e`（#454 databases-api-honesty 已由 Kimi K3Max 合并）。只做下面这件事，不要扩大范围。

## 背景
`docs/design/migration-plan.md` 测试矩阵「data & network」：失败可重试、不假装成功、状态配文字。规划方核查 `apps/web/app/api/collections/[id]/items/route.ts`（请复核）：

1. **属实**。POST upsert `collection_items` 失败时：`const message = error.code === "23503" ? "来源不存在或不可访问" : error.message`，非 23503 分支 **原样回显** `error.message`（500）。仓库已有 `serverError`（`@/lib/api/error`）；同文件 GET RPC 与 DELETE 已用 `serverError`，只有 POST upsert 这一支漏了。
2. **属实**。POST 校验集合存在时：`const { data: collection } = await supabase.from("collections").select("id").eq("id", id).maybeSingle()`——**忽略 `error`**。DB/网络错误时 `collection` 为 falsy → 一律 404「集合不存在」，把任意错误伪装成不存在。
3. **属实（语义保留）**。DELETE 忽略受影响行数，无 error 一律 `{ success: true }`。客户端 `collections-view.tsx` 的 `removeFrom` 只在 `!res.ok` 时 toast，成功才从列表剔除——**DELETE 0 行保持幂等 `{ success: true }`**（对标 notes-tags：改成 404 会在竞态下误 toast「移出失败」）。不要改成 404。
4. GET 已用 `serverError`；非法 JSON POST 已 400「请求格式无效」。cursor 的 `CollectionCursorError` 文案来自本仓库解码器（非 DB），`cursor 无效：${error.message}` **可保持**（与 `library/items` 一致）；不要扩大到改 library。

调用方：`add-to-collection-dialog.tsx`（POST）、`collections-view.tsx`（GET/DELETE）。多数看 `res.ok` + `data.error` toast。**mock shim 有** `/api/collections*`（`lib/mock/api-shim-collections.ts` + 测试），POST 错误码/文案若变须对齐 shim 与 `api-shim-collections.test.ts`。

## 目标
1. **最小改动**。可在 `apps/web/lib/collections/` 抽小纯函数（如 `items-api.ts`：分类 upsert 错误 / 分类集合存在查询），便于单测；也可直接在 route 内改——选更小的。对照 `lib/notes/note-tags-api.ts`，不要改 notes/databases 那些文件。
2. POST upsert：`23503` 仍 400「来源不存在或不可访问」；其它 error → `serverError(error)`（不泄露 message）。成功仍 `{ added: number }`。
3. POST 集合存在校验：读取 `{ data, error }`；`error` → `serverError`；`!data` → 404「集合不存在」。
4. DELETE：**保持** 0 行仍 `{ success: true }`；仅确保 DB error 继续走 `serverError`（现状已是）。
5. GET / 非法 JSON / sourceType / ids 校验语义不变。
6. **核对调用方**：`rg "/api/collections/.*/items"`；默认零客户端改动（toast 已显示 `data.error`）。
7. **mock shim**：若 POST 非 23503 行为从「回显 message」变为通用 500 文案，确认 shim 是否已模拟该路径；缺则最小补齐，并跑 `api-shim-collections` 相关 vitest。不要为了本任务大改 shim 架构。
8. **单测**：至少覆盖 upsert 错误分类（23503 vs 其它）与集合查询分类（error vs 无行）；不新增依赖。
9. **勿做**：不改 schema/RLS/迁移、`/api/collections` 列表与 `[id]` PATCH/DELETE、digest、library/items、imports、trash、e2e、`globals.css`；不把 DELETE 改成 404；不新增依赖。

## 执行步骤（按顺序）
1. `git checkout master && git pull origin master`（osxkeychain 挂起就用 `git -c 'credential.helper=!gh auth git-credential' pull origin master`），确认 HEAD 为 `0b0458e` 或更新；`git checkout -b fix/collections-items-api-honesty`。**提交时只 add 本任务业务文件与本目录 PROGRESS.md**（可含本目录 TASK.md/PROMPT.md）；其它未跟踪 `docs/handoff/*` 及别的目录未提交的 PROGRESS 改动保持不动。切分支或 `gh pr merge` 切回 master 被本地 dirty handoff 卡住：先 `git stash push -m …`（只 stash 已跟踪改动），最后 stash pop；不要在特性分支上产生本地 merge 提交。
2. 核对背景 1–4 是否属实，写入 PROGRESS.md。若已修好则说明并停止。
3. 按「目标」做最小修改 + 单测（含 shim 对齐若需要）。
4. 本地验证（仓库根目录）：
   - `corepack pnpm -C apps/web exec tsc --noEmit`
   - `corepack pnpm -C apps/web lint`
   - `corepack pnpm -C apps/web exec vitest run`（全量）
   记录退出码与 vitest 数（基线 **2449 passed / 2 skipped**，新增单测相应 +N）。不在本地跑 e2e。
5. 提交 → push → `gh pr create` → 等 CI 五项（verify / db-test / e2e-test / sw-e2e / collab-e2e）全绿 → `gh pr merge --squash --delete-branch` → 本地切回 master 并 pull；确认远端特性分支已删（未删就 `git push origin --delete <分支>`）。不 force push、不直推 master。每步追加 PROGRESS.md（**PR 开出后不要再为 PROGRESS.md 单独推提交，免得重跑 CI**）。CI 失败就看日志修复再普通 push；无关 flake 可 `gh run rerun --failed` 一次。
6. **合并后不要再开只改 PROGRESS.md 的文档 PR**：最终状态写本地 PROGRESS.md（保持未提交），然后**退出进程**。

## 完成定义
- PR 已 squash 合并进 master，本地 master 已同步，远端分支已删，进程已退出。
- collections items POST 不再泄露数据库报错；集合存在校验不再把 DB 错误伪装成 404；DELETE 幂等语义不变；客户端加入/移出集合不受影响。
- tsc / lint / vitest 全绿；CI 五项全绿。

## 额度/限流
若额度剩约 3% 或遇限流/配额报错：写 HANDOFF.md + PROMPT.md（已完成/未完成步骤、确切文件与命令）后退出。

## 后续候选（给规划方，本任务不做）
- `collections/[id]/digest`、`library/items` cursor 文案、`imports`（含 GET history 回显 message）、`trash` affected=0 语义、`scrape` / `oembed` / AI 路由 / push / cron
