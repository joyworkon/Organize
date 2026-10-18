# PROGRESS

- 2026-10-18 约 14:45 EDT：规划方（五狗）写好 TASK.md / PROMPT.md。基线 master `26f9549`（#416 sidebar-collab-presence-load-honesty 已由 Kimi K3Max 合并）。本任务派给 **Kimi K3Max**（`kimi-code/k3` + thinking.effort=max）。
- 2026-10-18 14:47 EDT：执行 Agent 已 `pull --ff-only origin master`（Already up to date），确认 HEAD `26f9549ae1284945a2cf861bbc79332ab57d7a77`，创建 `fix/task-repository-load-honesty`。核对背景 1–5：`fetchAll` 丢弃 tasks/task_lists 错误并以空数组兜底，两个消费 UI 因此出现假空；成功 empty 必须保留原空态，次要查询失败不阻塞主列表。
- 2026-10-18 14:50 EDT：新建 `repository-load.ts` 与 `repository-load.test.ts`；纯函数在主查询任一路 error 或 data=null 时同引用保留两份 previous，成功（含空数组）替换并清错。定向 Vitest：1 文件、7 tests 全过（exit 0）。
- 2026-10-18 14:53 EDT：已接线 `useTaskRepository` 并导出 `loadError`；主失败提前保留现有 tasks/lists，主成功才更新 snapshotRef。tags/task_tags/trashed 仍按空 map / 空数组降级，不阻塞主列表。导航菜单在失败时显示提示+重试且不再显示假空，sidebar 在 TaskSidebar 外显示提示+重试；成功 empty 仍显示「还没有清单」。
- 2026-10-18 14:53 EDT：本地验证：`tsc --noEmit` exit 0；`next lint` exit 0（无 warning/error）；全量 Vitest exit 0，281 files passed / 1 skipped，2128 tests passed / 2 skipped（基线 +7）。未运行 e2e。业务文件 scoped `git diff --check` 通过。
