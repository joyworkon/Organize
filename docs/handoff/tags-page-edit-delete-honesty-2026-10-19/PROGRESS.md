# PROGRESS：标签管理页重命名/删除写诚实性

执行：Kimi K3Max（kimi-code/k3 + thinking.effort=max），2026-10-19。

## 步骤记录

### 1. 同步与分支（完成）
- `git stash push`（仅已跟踪 dirty handoff）→ `git pull origin master`：Already up to date，HEAD = `c09e539`（#445 已合并，与任务书基线一致）。
- 建分支 `fix/tags-page-edit-delete-honesty`，`git stash pop` 恢复工作区。

### 2. 背景复核（完成，全部属实）
- `apps/web/app/(main)/tags/page.tsx:239-258` `handleEdit`：`update({name,color}).eq("id", ...)` 只有 `if (!error)`——error 时无任何提示（属实 1）；无 `.select("id")`，0 行更新 error 为 null 被当成功（属实 2）；无 catch，抛异常成未处理拒绝。
- `page.tsx:260-276` `handleDelete`：同样只有 `if (!error)`、无 `.select("id")`、无 catch（属实 3）。
- `handleCreate` 已有 `setCreateError` 错误展示，不动。

### 3. 实现
- 新增 `apps/web/lib/tags/tag-manage-mutation.ts`：纯函数把 supabase 写结果（error/data）判定为判别联合（ok / duplicate(23505) / not-found(0 行) / failed），并集中失败 toast 文案。
- `page.tsx` 仅改 `handleEdit`/`handleDelete`：加 `.select("id")` + try/catch/finally，按判定分支 toast；成功路径行为不变。
- 新增 `apps/web/lib/tags/tag-manage-mutation.test.ts`：10 个用例（update 成功 / 23505 / 其它 error / 0 行 / data null；delete 成功 / error / 0 行；两条异常路径文案）。

### 4. 本地验证
- `corepack pnpm -C apps/web exec tsc --noEmit`：exit 0（首跑报 2 个 TS2339：异常函数返回类型是整个联合导致 `.toastTitle` 不可访问，已收窄为 Failure 分支类型后通过）。
- `corepack pnpm -C apps/web lint`：exit 0，无警告。
- `corepack pnpm -C apps/web exec vitest run`：运行中（后台）。
