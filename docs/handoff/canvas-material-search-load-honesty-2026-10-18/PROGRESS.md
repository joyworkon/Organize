# 进度日志：canvas-material-search-load-honesty-2026-10-18

执行 Agent：ZCode / GLM-5.3。分支 `fix/canvas-material-search-load-honesty`。

## 步骤 1：同步 master、建分支 ✅

- `git pull origin master` → Already up to date，HEAD = `a42e6c3`（#395）。
- `git checkout -b fix/canvas-material-search-load-honesty` 成功。
- 工作区无已跟踪文件改动（仅大量未跟踪 docs/handoff/*，保持不动）。

## 步骤 2：核对背景 1–5 ✅（基线 a42e6c3 全部属实）

核对对象 `apps/web/components/canvas/canvas-material-panel.tsx`（168 行）：

1. **属实**。搜索 effect（41–62 行）：`fetch('/api/library/items?...')` 后 50 行 `if (!res.ok) return;` 静默返回，无错误状态；55–56 行 `catch { /* 网络异常静默；下次输入重试 */ }` 同样静默。
2. **属实**。首次/空结果后失败：`items` 保持 `[]`，89–90 行渲染走 `items.length === 0` → 「没有匹配的资料」，加载失败被伪装成空匹配。
3. **属实**。已有结果后换关键词失败：`items` 保留上一关键词结果，界面无任何提示。
4. **属实**。`if (!res.ok) return;`（50 行）在 `seq !== seqRef.current` 检查（52 行）之前，过期请求的失败同样静默通过。
5. **属实**。无重试入口，只有改输入框文字才会重新搜索。

参考实现已读：`lib/canvas/boards-load.ts`（nextBoardsAfterLoad 纯函数模式）与 `components/library/add-to-canvas-dialog.tsx`（#395 接线：loadError + reloadCount + itemsRef 快照 + role="alert" + 重试按钮）。

结论：未修好，按任务继续。

## 步骤 3：新增纯函数 + 单测，薄改面板 ✅

- 新增 `apps/web/lib/canvas/material-search-load.ts`：
  - `CANVAS_MATERIAL_SEARCH_ERROR_MESSAGE = "资料搜索失败"`；
  - `nextMaterialItemsAfterLoad<T>`：`{ previous; ok: true; items }` → `{ items, loadError: null }`；`{ previous; ok: false }` → `{ items: previous(同引用), loadError: MESSAGE }`。与 boards-load.ts 的 nextBoardsAfterLoad 同构，未改 boards-load.ts / list-load.ts。
- 新增 `apps/web/lib/canvas/material-search-load.test.ts`：5 个用例——成功替换并清错（toBe 同引用）；失败保留 previous（同引用）+ 非空 loadError；previous 空 + 失败 → items 为 [] 但 loadError 非空；成功空结果 loadError 为 null；成功空 vs 失败空仅靠 loadError 区分。
- 薄改 `apps/web/components/canvas/canvas-material-panel.tsx`：
  - 新增 `loadError` / `reloadCount` state、`itemsRef` 上次成功快照；
  - 搜索 effect：`!res.ok` 与 `catch` 都走纯函数失败分支；**seq 检查移到失败分支之前**（过期请求的成功/失败一并丢弃，修复背景 4）；成功走纯函数成功分支并 `setExpandedId(null)`；失败保留快照与展开态；effect 依赖 `[query, reloadCount]`；
  - 渲染：loading 分支不变；`loadError && items.length === 0` → `role="alert"` 错误提示 + `Button size="sm" variant="outline"`「重试」（不再显示「没有匹配的资料」）；`loadError && items.length > 0` → 列表上方 `role="alert"`「资料搜索失败，以下为上次结果」+ 重试，仍显示旧列表；无错维持现状（空结果仍「没有匹配的资料」）；
  - `retrySearch`：清 loadError + `setReloadCount(c => c + 1)`，用当前 query 重搜；无 toast；
  - 样式复用 `canvas-material-empty` + 少量 Tailwind，未改 globals.css。旧 `<ul>` 块缩进未重排（next/core-web-vitals 无缩进规则），保持 diff 薄。
- 未动：canvas-workspace.tsx、插入卡片/摘录/图片逻辑、预览/选区逻辑、/api/library/items、e2e 文件。

## 步骤 4：本地验证 ✅

- `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0。
- `corepack pnpm -C apps/web lint` → exit 0（No ESLint warnings or errors）。
- `corepack pnpm -C apps/web exec vitest run` → exit 0，**2010 passed / 2 skipped**（基线 2005 passed / 2 skipped，+5 = 新单测 5 例）。未本地跑 e2e。

## 步骤 5：提交 / PR / CI / 合并

（进行中）

