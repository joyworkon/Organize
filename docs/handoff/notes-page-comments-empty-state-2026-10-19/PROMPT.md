你是 Organize 仓库（/Users/k/Documents/ZCode/Organize）的执行 Agent（Codex，模型 gpt-6.1-sol）。严格按 docs/handoff/notes-page-comments-empty-state-2026-10-19/TASK.md 从头做到完成定义，不要停下来问确认。

硬约束：
- 范围只限 TASK.md：笔记页「页面评论」空状态 + textarea aria-label；主要文件 `apps/web/components/notes/note-page-comments.tsx` 与其测试；必要时最小 CSS。不碰 API honesty、不改发送/解决/删除逻辑。
- 先 `git checkout master && git pull`，再从 master 建分支 `fix/notes-page-comments-empty-state`。
- 本地必须跑通：`corepack pnpm -C apps/web exec tsc --noEmit`、`corepack pnpm -C apps/web lint`、`corepack pnpm -C apps/web exec vitest run`（或仓库惯用的 filter 等价命令）。不要本地跑 e2e（会占 3000）。
- 每完成一步追加写 docs/handoff/notes-page-comments-empty-state-2026-10-19/PROGRESS.md。PROGRESS.md 只留本地，不要提交；提交只含本任务业务文件 + 本目录 TASK.md/PROMPT.md；其它 docs/handoff 改动保持未暂存。
- 开 PR 后不要再推只改文档/PROGRESS 的提交（会重跑 CI）。
- CI 五项（verify / db-test / e2e-test / sw-e2e / collab-e2e）全绿后才 `gh pr merge --squash --delete-branch`；要等 CI 就自己轮询（如 `gh pr checks <号> --watch`），不要结束进程留给「通知」。
- 不 force push、不直推 master；不杀 3000/3200 端口进程；不覆盖或重新 clone 仓库。
- 合并后切回 master 若被未提交文件挡住：先 `git stash`（只已跟踪改动），同步后 `git stash pop` 恢复。
- git 认证若 osxkeychain 挂起：`git -c 'credential.helper=!gh auth git-credential' …`
- 遇到额度/限流/配额报错，或额度剩约 3% 时，立即写本目录 HANDOFF.md（进度、分支、未完成步骤）后退出。若任务比预判难（反复失败），也写 HANDOFF.md 说明，建议换更强模型。

实现提示：
- 对齐 `apps/web/components/editor/editor-dialogs.tsx` 里已有的「还没有评论」空态；优先复用 `.editor-dialog-empty`。
- 空态条件：`!loading && threads.length === 0`，且不要在加载失败、仅有错误条时冒充「还没有评论」（若当前失败态仍渲染空列表容器，空态文案应让位给错误 UI）。
- textarea 补 `aria-label`，发送按钮已有 aria-label 勿重复破坏。

最后用中文汇报：用的模型、做了什么（先写用户能感受到的变化）、分支/提交/PR 链接、合并提交、vitest 数、CI 结果、遗留事项。
