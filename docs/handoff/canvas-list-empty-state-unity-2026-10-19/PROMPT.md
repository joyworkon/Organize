你是 Organize 仓库（/Users/k/Documents/ZCode/Organize）的执行 Agent（Codex，模型 gpt-6-luna）。严格按 docs/handoff/canvas-list-empty-state-unity-2026-10-19/TASK.md 从头做到完成定义，不要停下来问确认。

立刻开始执行（本进程已是 `codex exec --full-auto`）。

硬约束：
- 范围只限 TASK.md：构思画布列表页空态/无快照失败态改用共享 `EmptyState`；主要文件 `apps/web/app/(main)/canvas/page.tsx`；可选清理未用 `.canvas-list-empty` CSS。不碰 API honesty、不改 list-load 语义、不改画布编辑器。
- 先处理工作区：已跟踪改动多为其它 handoff PROGRESS——checkout 前必要时 `git stash push -u` 仅当挡分支时；优先 `git stash` 已跟踪，再 `git checkout master && git pull --ff-only origin master`，从 master 建分支 `fix/canvas-list-empty-state-unity`，再 `git stash pop` 恢复原有本地手改（本任务新文件另写）。
- 本地必须跑通：`corepack pnpm -C apps/web exec tsc --noEmit`、`corepack pnpm -C apps/web lint`、`corepack pnpm -C apps/web exec vitest run`（或仓库惯用的 filter 等价命令）。不要本地跑 e2e（会占 3000）。
- 每完成一步追加写 docs/handoff/canvas-list-empty-state-unity-2026-10-19/PROGRESS.md。PROGRESS.md 只留本地，不要提交；提交只含本任务业务文件 + 本目录 TASK.md/PROMPT.md；其它 docs/handoff 改动保持未暂存。
- 开 PR 后不要再推只改文档/PROGRESS 的提交（会重跑 CI）。
- CI 五项（verify / db-test / e2e-test / sw-e2e / collab-e2e）全绿后才 `gh pr merge --squash --delete-branch`；要等 CI 就自己轮询（如 `gh pr checks <号> --watch`），不要结束进程留给「通知」。
- 不 force push、不直推 master；不杀 3000/3200 端口进程；不覆盖或重新 clone 仓库。
- 合并后切回 master 若被未提交文件挡住：先 `git stash`（只已跟踪改动），同步后 `git stash pop` 恢复。
- git 认证若 osxkeychain 挂起：`git -c 'credential.helper=!gh auth git-credential' …`
- 遇到额度/限流/配额报错，或额度剩约 3% 时，立即写本目录 HANDOFF.md（进度、分支、未完成步骤）后退出。若任务比预判难（反复失败），也写 HANDOFF.md 说明，建议换更强模型（如 gpt-6.1-sol）。

实现提示：
- 对齐 `apps/web/app/(main)/tasks/countdown/page.tsx` / `favorites/page.tsx` / `notes/page.tsx` 的 EmptyState 用法。
- 空态 title 保持「还没有画布」；CTA 文案必须含「新建构思画布」（e2e 用 getByRole button name）。
- 失败无快照用 EmptyState + 重试；有快照失败保留现有行内 alert，不要改成整页 EmptyState 盖住列表。
- icon 用 `@/components/icons` 的 `LayoutTemplate`（已在 canvas-add-panel 使用）。

最后用中文汇报：用的模型、做了什么（先写用户能感受到的变化）、分支/提交/PR 链接、合并提交、vitest 数、CI 结果、遗留事项。
