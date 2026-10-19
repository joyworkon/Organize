# PROGRESS

- 2026-10-19 规划写入 TASK.md / PROMPT.md（五狗），派给 Kimi K3Max。
- 2026-10-19 Kimi K3Max 接手：`git pull` 后 HEAD=`7e42e7a`（与基线一致），建分支 `fix/task-list-mutation-honesty`。
- 复核背景 1–4（`apps/web/lib/tasks/repository.ts` 现状）：
  1. **属实**：`deleteList`（238–250）两步写均 `await` 但完全忽略返回 `error`，supabase 不抛异常 → catch 不触发，写失败静默。
  2. **属实**：软删 `task_lists.update({ deleted_at })` 无 `.select`，RLS 0 行（error=null）同样静默。
  3. **属实**：两步非原子，第一步成功第二步失败时无任何提示。
  4. **属实**：`updateList`（225–235）检查了 error 但无 `.select("id")`，RLS 0 行假装成功。
- 修改内容：
  - 新增 `apps/web/lib/tasks/task-list-mutation.ts`：`deleteTaskListRemote`（第一步只看 error，0 行正常；第二步带 `.select("id")`，error / 0 行 / data=null / 抛异常均失败；异常函数内捕获，按阶段返回 `move-tasks` / `delete-list`）与 `updateTaskListRemote`（`.select("id")`，error / 0 行 / 异常 → `{ ok: false }`）。
  - `repository.ts`：`deleteList` 按阶段处理——成功照旧 `fetchAll()`；`move-tasks` 失败回滚 + 「删除清单失败，已回滚」；`delete-list` 失败回滚 + `await fetchAll()` + 「清单未能删除，其中任务已移到未分类，请重试」。`updateList` 改走新函数，失败回滚 + 「更新清单失败，已回滚」。未动 togglePin / softDeleteTask / updateTask / createList / fetchAll / 离线队列 / sidebar.tsx。
  - 新增 `apps/web/lib/tasks/task-list-mutation.test.ts`：12 条用例（全成功、空清单、第一步 error/抛异常且第二步未调用、第二步 error/0 行/data=null/抛异常；updateList 成功/error/0 行/抛异常）。
- 本地验证（2026-10-19）：`tsc --noEmit` exit 0；`next lint` 0 警告；`vitest run` **2266 passed / 2 skipped**（基线 2254+2，+12 条新用例）。
