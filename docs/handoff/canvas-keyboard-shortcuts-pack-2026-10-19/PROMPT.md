你是 Organize 仓库（/Users/k/Documents/ZCode/Organize）的执行 Agent（Codex ChatGPT App CLI 0.163，模型 **gpt-6.1-sol**）。严格按 docs/handoff/canvas-keyboard-shortcuts-pack-2026-10-19/TASK.md 从头做到完成定义，不要停下来问确认。

立刻开始执行（本进程已是 `codex exec` + `-s danger-full-access` 全权限）。

## 验证与合并规则（必须遵守）

1. **本地验证**：改完后必须跑通
   - `corepack pnpm -C apps/web exec tsc --noEmit`
   - `corepack pnpm -C apps/web lint`
   - `corepack pnpm -C apps/web exec vitest run`
   不要本地跑 e2e（会占 3000）。
2. **开 PR**：本地验证通过后 push 分支并 `gh pr create`（写清用户可感知变化：新增哪些快捷键、速查面板入口、缩放按钮围绕中心）。
3. **合并**：仅当 CI **五项全绿**（verify / db-test / e2e-test / sw-e2e / collab-e2e）后才 `gh pr merge --squash --delete-branch`。用 `gh pr checks <号> --watch` 或轮询等 CI，不要结束进程指望通知。CI 失败就修好再推（同一分支普通 push）。
4. **禁止**：force push；直接 push 到 master；杀掉占用 3000/3200 端口的进程；覆盖或重新 clone 仓库。
5. **开 PR 之后**：不要再推只改文档 / PROGRESS 的提交（会重跑 CI）。`PROGRESS.md` **只留本地、不提交**。
6. **合并后回 master**：若未提交文件挡住 checkout，先 `git stash`（必要时 `-u` 仅当挡路），`git checkout master && git pull --ff-only origin master`，再 `git stash pop` 恢复。
7. **额度**：能查额度则约 ≤5% 准备交接，≤3% 或额度/限流报错时立刻停新工作，写本目录 `HANDOFF.md`（目标、分支、HEAD、已完成、未完成、验证、下一步）后退出。若任务比预判难（键盘守卫与编辑态冲突反复失败），也写 HANDOFF，建议换 **gpt-6-astra**。
8. **git 认证**：若 osxkeychain 挂起，用 `git -c 'credential.helper=!gh auth git-credential' …`。

## 工作区与分支

- 其它 handoff 目录的本地 PROGRESS/未跟踪文件可能挡路：checkout 前必要时 `git stash push`（优先已跟踪；挡路再考虑 `-u`）。
- `git checkout master && git pull --ff-only origin master`，确认含 #462（`150af52`）或更新。
- `git checkout -b feat/canvas-keyboard-shortcuts-pack`
- 需要时 `git stash pop` 恢复无关本地改动。
- 提交只含本任务业务文件 + 本目录 `TASK.md`/`PROMPT.md`；**不要**提交 `PROGRESS.md`；其它 `docs/handoff/**` 改动保持未暂存。

## 实现顺序

1. 先读 `TASK.md`，再读 `apps/web/components/canvas/canvas-workspace.tsx`（键盘 effect 约 L390–460、缩放控件约 L1206–1255）、`canvas-viewport.tsx`（`zoomAt` / `clampZoom` / `zoomToFit`）、`use-canvas-pointer.ts`（`selectIds` / blocks 多选规则）、`canvas-store.ts`（selection / lastActiveTarget / apply）、`lib/canvas/commands.ts`（`duplicateBlock` / `duplicateRegion`）、`e2e/canvas*.spec.ts`（确认依赖的 aria-label/文案）。把发现记入本目录 `PROGRESS.md`。
2. 抽纯函数 + 单测（快捷键匹配、平台修饰键标签、围绕中心缩放）。
3. 接入 keydown 分支、让缩放按钮复用围绕中心函数、抽「适合全部」函数共用。
4. 速查对话框（共享 Dialog）+ 缩放组「键盘快捷键」按钮 + 按钮 title 快捷键提示（aria-label 不变）。
5. 本地 tsc / lint / vitest 全绿 → commit（如 `feat(canvas): add keyboard shortcuts pack and shortcuts dialog`）→ push → PR → 等 CI 五项绿 → squash 合并 → 同步 master。
6. 每完成一步追加 `PROGRESS.md`（本地 only）。

## 禁止范围

见 TASK.md「禁止范围」：不改文档 JSON/revision/CAS/autosave/坐标与命中；不在画布祖先加 transform/contain；不引入新依赖；不改 wheel/手势/空格平移；不做系统剪贴板复制粘贴、对齐吸附；不碰笔记/日历；不动 `.env`、不写密钥。

## 结束汇报（中文）

先写**用户能感受到的变化**，再写：模型、分支/提交/PR 链接、合并 commit、vitest 概况、CI 结果、遗留事项。
