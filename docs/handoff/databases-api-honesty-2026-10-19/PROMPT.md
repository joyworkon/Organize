立刻 ExitPlanMode，直接执行任务，不要停在计划模式。不要只写计划或问确认——马上改代码、跑验证、开 PR、等 CI 绿、squash 合并后退出。

你是执行 Agent（Kimi / kimi-code/k3 / K3Max）。模型已由 CLI `-m kimi-code/k3` 与 config `[thinking].effort=max` 指定。在 /Users/k/Documents/ZCode/Organize 按 docs/handoff/databases-api-honesty-2026-10-19/TASK.md 从头做到完成定义。

硬约束：
- 只做四个路由的诚实性：`apps/web/app/api/databases/route.ts`、`databases/[id]/route.ts`、`databases/[id]/rows/route.ts`、`databases/[id]/rows/[rowId]/route.ts`。DB/RPC 错误用 serverError，不泄露 error.message；非法 JSON/非对象 → 400「请求格式错误」（替换 json().catch(()=>({}))）；PATCH .single() 0 行 → 404；DELETE mutate_trash 读 affected，0 → 404，>0 仍 { ok: true }。建议抽 apps/web/lib/databases/api-mutation.ts（或同目录等价名）并补单测。
- mock api-shim 无 /api/databases* handler，不要改 shim。先 rg 调用方（database-block / table-view / database-block-client）；默认不改客户端，确有必要时最小调整。
- 不改 schema/RLS/迁移/RPC、其它 API、e2e、globals.css；不新增依赖。
- 先 `git checkout master && git pull`，再从 master 建分支 fix/databases-api-honesty。
- 每步追加 docs/handoff/databases-api-honesty-2026-10-19/PROGRESS.md；PR 开出后不要为 PROGRESS.md 单独推提交（避免重跑 CI）。
- 提交只含本任务业务文件 + 本目录 PROGRESS.md/TASK.md/PROMPT.md；其它 docs/handoff 保持未跟踪/未暂存。
- CI 全绿后 gh pr merge --squash --delete-branch；确认远端分支已删；不 force push、不直推 master。gh pr merge 切回 master 若被 dirty 文件卡住，先 stash（只已跟踪改动），不要在特性分支产生本地 merge。
- 合并后不要再开只改 PROGRESS.md 的文档 PR；最终状态只写本地 PROGRESS.md，然后退出进程。
- git 认证若 osxkeychain 挂起：git -c 'credential.helper=!gh auth git-credential' …
- 不要本地跑 e2e。额度约 3% 或限流则写 HANDOFF.md + PROMPT.md 后退出。

做完后在日志简要汇报：PR 号、合并提交、vitest 数、CI 结果。
