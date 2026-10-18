# PROGRESS — add-to-canvas-load-honesty-2026-10-18

- 规划方已写好 TASK.md / PROMPT.md，基线 master `e837a3a`，vitest 基线 1996 passed / 2 skipped。
- 执行：ZCode（GLM-5.3）。Codex 至约 2026-10-22 前不可用。

（ZCode 从步骤 1 起追加。）

## 步骤 1：同步 + 建分支（2026-10-18）

- `git pull origin master`：Already up to date，HEAD `e837a3a`（#393 已合并），与基线一致。
- 已建分支 `fix/add-to-canvas-load-honesty`。
- 工作区有其它 handoff 目录的未跟踪/未提交文件，提交时只 add 本任务业务文件 + 本目录 PROGRESS.md。

## 步骤 2：核查背景 1–4（2026-10-18）

全部属实：

1. ✅ `apps/web/components/library/add-to-canvas-dialog.tsx:70-72`：`const list = await listCanvases(); setCanvases(list ?? []);`——失败（null）被写成空数组。
2. ✅ 失败后 UI 仍渲染选择表单，下拉只有固定项「新建画布」（233 行 `<option value={NEW_CANVAS}>新建画布</option>` 之后 canvases 为空），无 loadError / 无 toast / 无重试。
3. ✅ 全文件无 `loadError` state、无 `isOnline` 门控（grep 证实）。
4. ✅ `getCanvas` 失败静默 `setBoards([])`（95–105 行）——确认存在，按 TASK 留给后续，本任务不动。

参考接线已读：

- `apps/web/app/(main)/canvas/page.tsx:43-59`（#386）：`nextCanvasItemsAfterLoad({ previous: itemsRef.current, list })` → ref 同步 + setItems + setLoadError；`loadError && isOnline()` 才 destructive toast；`retry` = 清错 + 重新 refresh；无快照给错误块 + 重试，有快照保留列表 + 行内提示。
- `apps/web/components/collections/add-to-collection-dialog.tsx`（#393）：对话框内同构接线——`collectionsRef` 快照 + `loadError` + `reloadCount` 重试；`loadError && collections.length === 0` 时整块替换为 `role="alert"` 错误态 + outline/sm 重试，有快照时行内 alert 条 + 就地重试。

结论：未修好，按目标实施。测试策略：`lib/canvas/list-load.test.ts`（#386 引入）已覆盖纯函数且 TASK 禁改；#393 同类修法亦未给对话框加组件测试（仅测新增纯函数）。本任务纯函数已存在已测，接线薄，按 TASK 步骤 4「无合适挂点可不加组件测」，不加组件测试，依赖手动推理 + 全量 vitest 回归。

## 步骤 3：改 `add-to-canvas-dialog.tsx`（2026-10-18）

仅动 `apps/web/components/library/add-to-canvas-dialog.tsx`，对齐 #386 + #393 接线：

- imports：新增 `useRef`、`CANVAS_LIST_LOAD_ERROR_MESSAGE` + `nextCanvasItemsAfterLoad`（`@/lib/canvas/list-load`）、`isOnline`（`@/lib/offline/network`）。
- state：新增 `canvasesRef`（上次成功快照，首屏 `[]`）、`loadError: string | null`、`reloadCount`（重试计数）。
- 打开加载 effect（deps `[open, reloadCount]`）：开头 `setLoadError(null)`；`listCanvases()` 结果交给 `nextCanvasItemsAfterLoad({ previous: canvasesRef.current, list })`，不再 `list ?? []`；成功同步 ref + `setCanvases(plan.items ?? [])` + 清错；失败 `loadError && isOnline()` 才 destructive toast（离线不弹）。
- `retryLoadCanvases`：清 loadError + `reloadCount` 自增触发 effect 重新拉取。
- 渲染三分支：`loading` 维持「加载画布列表…」；`loadError && canvases.length === 0` → 整块替换为 `role="alert"` 错误态（`CANVAS_LIST_LOAD_ERROR_MESSAGE`）+ outline/sm 重试，不再伪装「只有新建画布」；否则渲染原表单，且 `canvases.length > 0 && loadError` 时表单顶部加行内 `role="alert"` 条 + 就地重试。真正空库（成功 0 条）表单不变。
- 未动：`getCanvas`/boards/regions 失败路径、提交/新建画布/追加卡片逻辑、`AddToCanvasButton`、`list-load.ts`、`repository.ts`、`canvas/page.tsx`、`globals.css`。

## 步骤 4：组件测试决策（2026-10-18）

不加组件测试（理由见步骤 2 结论）。

## 步骤 5：本地验证（2026-10-18，仓库根目录）

- `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0
- `corepack pnpm -C apps/web lint` → exit 0（No ESLint warnings or errors）
- `corepack pnpm -C apps/web exec vitest run` → **1996 passed / 2 skipped**（262 test files passed | 1 skipped），与基线一致
- 未跑本地 e2e（按 TASK 约定）
