# PROGRESS

- 2026-10-18 约 23:05 Asia/Taipei（11:05 EDT）：规划方（五狗）写好 TASK.md / PROMPT.md，派给 ZCode（GLM-5.3）。基线 master `6c4cdcf`（#411 task-note-checklist-load-honesty 已合并）。本任务：收藏按钮读取收藏状态失败不再伪装成「未收藏」。
- 同日约 23:06：`git pull origin master` 已是最新（HEAD `6c4cdcf`），建分支 `fix/favorite-button-check-load-honesty`。
- 同日约 23:07：背景核实 1–3 属实——① `favorite-button.tsx` 的 `checkFavorite` 只解构 `{ data }`，查询失败时 `setIsFavorited(!!data)` 显示成未收藏且可点；② 所有调用方（notes/tasks/library 详情页 ×2、task-card，另有规划未列的 `reading-card.tsx`）均不传 `initialFavorited`，全走查询路径；③ `maybeSingle()` 无行时 `{ data: null, error: null }` 为真未收藏，仅 `error` 非空算失败。
- 同日约 23:09：新建 `lib/favorites/favorite-check.ts`（`FAVORITE_CHECK_ERROR_TITLE` 常量 + `resolveFavoriteCheck` 纯函数）与 `favorite-check.test.ts`（4 用例）；改 `components/favorite-button.tsx`：`checkFailed` state + `loadFavorite` useCallback（mountedRef 卸载保护），失败不改 `isFavorited`、title/aria-label 显示错误文字、点击只重试读取不 insert/delete、重试仍失败 toast destructive。
- 同日约 23:10：本地验证全绿——tsc exit 0；lint 无警告；vitest **2094 passed / 2 skipped**（基线 2090 +4）。
