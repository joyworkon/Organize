# PROGRESS — editor-dialog 评论/建议写操作诚实性

执行：Kimi K3Max。基线 master `dc75116`。

## 2026-10-19

- [x] 同步 master（Already up to date，HEAD = dc75116）；stash 本地 dirty handoff（38 个已跟踪 PROGRESS.md 改动）→ 建分支 `fix/editor-dialog-mutation-honesty` → stash pop 恢复。
- [x] 背景复核（属实）：
  1. `CommentDialog.mutate`（editor-dialogs.tsx:211-214）——`!response.ok` 零反馈、无 try/catch，网络异常成未处理 rejection。调用处：解决/重开线程（:233）、删线程（:233）、删评论（:234）、`editComment`（:216-221）。**属实**。
  2. `SuggestionDialog.decide`（:283-296）——PATCH 失败静默、无 try/catch；`accepted` 时已先把建议写入编辑器（:292），失败用户无从知晓。**属实**。
  3. `CommentDialog.submit`（:191-209）与 `SuggestionDialog.create`（:268-281）已有 `setError` + catch 兜底；加载路径已有 loadError + 重试。对照成立，不改。
- [x] 代码修改（最小范围）：
  - 新增 `apps/web/lib/editor/dialog-mutation-error.ts`：`dialogMutationErrorMessage({ serverMessage?, networkError?, fallback })` → 展示文案（网络异常加「网络异常，」前缀；否则服务端 message 去空白后优先，空/非字符串回退 fallback）。配 `.test.ts` 5 例。
  - `editor-dialogs.tsx` `CommentDialog.mutate`：新增 `failureLabel` 参数；fetch 包 try/catch（网络异常→`setError("网络异常，…")`）；`!ok` 时 `response.json().catch(() => null)` 兜底读 `data.error` 并 `setError`；开始 `setError("")`；成功仍 `await reload()`，但 `.catch(() => undefined)` 吞掉 rethrow（reload 失败归已有 loadError + 重试机制，不重复报错，也不再产生未处理 rejection）。
  - 调用处文案：解决→「解决评论失败」/重开→「重新打开评论失败」（按 `thread.resolved_at` 动态选）、删线程→「删除评论线程失败」、删评论→「删除评论失败」、`editComment`→「编辑评论失败」。
  - `SuggestionDialog.decide`：accepted 快照校验与编辑器写入逻辑原样保留；PATCH 包 try/catch；`!ok`/网络异常均 `setError`（优先服务端 message）；accepted 失败 fallback：「建议内容已写入编辑器，但标记为已接受失败，请重试或手动撤销」（不回滚编辑器）；rejected：「拒绝建议失败」；成功后 `await reload().catch(() => undefined)`（保持 reload 静默加载语义，仅吞 rejection）。
  - 错误展示复用已有 `{error && <p className="editor-dialog-error">}`，未新增 UI；未改 submit/create、加载路径、API 路由、note-page-comments.tsx、e2e、globals.css；未新增依赖。
- [x] 本地验证（仓库根目录）：
  - `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0
  - `corepack pnpm -C apps/web lint` → exit 0（No ESLint warnings or errors）
  - `corepack pnpm -C apps/web exec vitest run` → exit 0；Test Files 300 passed | 1 skipped (301)；Tests **2242 passed | 2 skipped**（基线 2237+2，新增 5 例全过；stderr 里 jsdom `window.focus` not-implemented 为 notifications-click.test.ts 既有噪音，非失败）
