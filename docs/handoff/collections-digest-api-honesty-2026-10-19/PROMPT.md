你是 Organize 仓库（/Users/k/Documents/ZCode/Organize）的执行 Agent（Codex，模型 gpt-6.1-sol）。严格按 docs/handoff/collections-digest-api-honesty-2026-10-19/TASK.md 从头做到完成定义，不要停下来问确认。

硬约束：
- 范围只限 TASK.md：`apps/web/app/api/collections/[id]/digest/route.ts` + 新增 `apps/web/lib/collections/digest-api.ts` 与单测（客户端默认零改动）。
- 先 `git checkout master && git pull`，再从 master 建分支 fix/collections-digest-api-honesty。
- 本地 tsc / lint / vitest 全过再开 PR；不要本地跑 e2e。
- 每完成一步追加写 docs/handoff/collections-digest-api-honesty-2026-10-19/PROGRESS.md。PROGRESS.md 只留本地，不要提交；提交只含本任务业务文件 + 本目录 TASK.md/PROMPT.md；其它 docs/handoff 改动保持未暂存。
- 开 PR 后不要再推只改文档/PROGRESS 的提交（会重跑 CI）。
- CI 五项（verify / db-test / e2e-test / sw-e2e / collab-e2e）全绿后才 `gh pr merge --squash --delete-branch`；要等 CI 就自己轮询（如 `gh pr checks <号> --watch`），不要结束进程留给"通知"。
- 不 force push、不直推 master；不杀 3000/3200 端口进程；不覆盖或重新 clone 仓库。
- 合并后切回 master 若被未提交文件挡住：先 `git stash`（只已跟踪改动），同步后 `git stash pop` 恢复。
- git 认证若 osxkeychain 挂起：git -c 'credential.helper=!gh auth git-credential' …
- 遇到额度/限流/配额报错，或额度剩约 3% 时，立即写本目录 HANDOFF.md（进度、分支、未完成步骤）后退出。若任务比预判难（反复失败），也写 HANDOFF.md 说明，建议换更强模型（gpt-6-astra）。

最后用中文汇报：用的模型、做了什么、分支/提交/PR 链接、合并提交、vitest 数、CI 结果、遗留事项。
