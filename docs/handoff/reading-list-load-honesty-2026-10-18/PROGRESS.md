# PROGRESS — reading-list-load-honesty-2026-10-18

- 规划方已写好 TASK.md / PROMPT.md，基线 master `8081b66`，vitest 基线 1948 passed / 2 skipped。
- 待 ZCode 从步骤 1 开始执行。

## 步骤 1：同步 master + 建分支 ✅
- `git checkout master && git -c 'credential.helper=!gh auth git-credential' pull origin master` → Already up to date，HEAD = `8081b66`（与任务基线一致）
- `git checkout -b fix/reading-list-load-honesty`
- 工作区有历史会话遗留的 untracked docs/handoff/*，提交时只显式 add 本任务文件

## 步骤 2：核实背景 1–4 ✅（全部属实）
对 `apps/web/components/library/reading-view.tsx` 逐条核对：
1. 属实：`fetchItems` 中 `const { data, count, error } = await query;` 后 `if (error)` 只 `setLoading(false)` / `setLoadingMore(false)` 然后 return（约 247–253 行），无 loadError state → 失败落到 EmptyState「还没有保存的内容」（677 行）。
2. 属实：`item_tags` 前置查询 `const { data: tagRows } = await supabase...`（209–212 行）不读 error；`!tagRows || tagRows.length === 0` → `setItems([])`（215 行），失败伪装成「没有找到匹配的内容」。
3. 属实：error 分支未改 items（碰巧保留快照），但无错误条 / 重试 / toast。
4. 属实：无 destructive toast，无 `isOnline()` 门控。

依赖检查：`rg -n "还没有保存的内容|没有找到匹配的内容" apps/web` 仅命中 `reading-view.tsx:677` 与 `unified-view.tsx:154`（后者属其它 tab，不动）；无测试 / e2e 依赖这两个文案。成功空列表行为不变，不受影响。

参考实现已读：`memos-view.tsx`（loadError + 首屏错误 EmptyState + 行内提示「刷新失败，当前显示的是上次内容」+ 重试 + loadMore 失败 toast「加载更多失败」）、`lib/canvas/list-load.ts`（纯函数 + 常量）、`app/(main)/canvas/page.tsx`（`loadError: string | null` + `isOnline()` 才 toast + 首屏错误块 / `role="alert"` 行内提示）。

## 步骤 3：实现 ✅
新增 `apps/web/lib/reading/list-load.ts`（与 #386 canvas list-load 同构）：
- `READING_LIST_LOAD_ERROR_MESSAGE = "稍后读列表加载失败"`、`READING_TAG_FILTER_ERROR_MESSAGE = "标签筛选加载失败"`
- `nextReadingItemsAfterLoad({ previous, data, error })`：error 非空或 data 为 null → `{ items: previous（同引用）, loadError: error.message trim 非空 || 常量 }`；成功 → `{ items: data, loadError: null }`
- `nextReadingItemsAfterTagScope({ previous, tagRows, tagError })` 判别联合：`error`（tagError 非空或 tagRows 为 null → 保留 previous + loadError）/ `empty`（真空列表）/ `scoped`（item_id 去重、滤 null）

新增 `apps/web/lib/reading/list-load.test.ts`：9 个用例（成功替换清错、失败保留非空 previous、error.message 空白回退常量、首屏失败 previous=[]、成功空数组真空、标签查询失败不清 previous、tagRows null 无 error 按失败、真空标签、scoped 去重滤 null）。

改 `apps/web/components/library/reading-view.tsx`：
- 新增 `loadError: string | null` state 与 `itemsRef`（fetchItems 闭包读 previous，不加 deps）
- `item_tags` 前置查询读 `tagError`，走 `nextReadingItemsAfterTagScope`：error → setLoadError + 保留 items + 在线才 destructive toast（`isOnline()` 门控），不再 `setItems([])`；empty → 真空列表（清 loadError）；scoped → 继续 reading_items 主查询
- `reading_items` 主查询失败：非 append 走 `nextReadingItemsAfterLoad`（保留快照 + loadError + 在线 toast）；append 失败在线 toast「加载更多失败」（对齐 memos），不静默；非 append 成功清 loadError（append 成功不清，行内提示保留提醒列表是旧的）
- 渲染：`loading && items.length === 0` → 骨架屏（刷新已有列表不再闪骨架）；`loadError && items.length === 0` → 错误 EmptyState（title=loadError + outline 重试）；其余维持原空态/列表；`loadError && items.length > 0` → 列表上方 `role="alert"` 行内提示 + outline/sm 重试
- `retry`：清 loadError 后 `fetchItems(false)`
- 未动：其它 tab / 详情页 / collect.ts / API / DB / mock shim / 排序多选批量置顶 / globals.css / VirtualList

## 步骤 4–5：测试与本地验证 ✅
- 新用例：`vitest run lib/reading/list-load.test.ts` → 9 passed（中途修一处：`item_id: null` 未过滤，纯函数补 `.filter(id != null)` 后全过）
- 全量验证（仓库根目录跑，apps/web 下）：
  - `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0
  - `corepack pnpm -C apps/web lint` → exit 0（No ESLint warnings or errors）
  - `corepack pnpm -C apps/web exec vitest run` → **1957 passed / 2 skipped**（基线 1948 passed / 2 skipped + 新增 9，只多不少，无失败）
- 按任务要求未在本地跑 e2e

## 步骤 6：提交 / PR / CI
（进行中）
