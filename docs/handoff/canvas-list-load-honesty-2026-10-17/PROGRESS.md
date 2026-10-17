# PROGRESS — canvas-list-load-honesty-2026-10-17

执行者：ZCode（branch `fix/canvas-list-load-honesty`）

## 步骤 1：同步 master、建分支 ✅

- `git checkout master && git pull origin master` → Already up to date
- HEAD = `baf925e`（与 TASK 基线一致）
- `git checkout -b fix/canvas-list-load-honesty` ✅

## 步骤 2：核对背景 1–4 ✅

逐条核对 `apps/web/app/(main)/canvas/page.tsx` @ baf925e 与 `lib/canvas/repository.ts`：

1. **属实**。`page.tsx:37-40` `refresh`：`const list = await listCanvases(); setItems(list ?? []);`。`listCanvases()`（`repository.ts:54-57`）在 `requestJson` 失败（含网络错误 status 0）时返回 `null`，于是失败被写成空数组。
2. **属实**。首屏失败 → `items = []` → 走 `page.tsx:123-131` 分支渲染 `canvas-list-empty`（「还没有画布」+「双击画布空白处…」+ 新建按钮），把加载失败伪装成从没建过画布；无任何错误提示与重试。
3. **属实**。`rename`（page.tsx:69 `if (res.ok) void refresh()`）、`duplicate`（:82）、`remove`（:98）成功后 `void refresh()`；refresh 失败 → `setItems([])` 把已有列表清空成「还没有画布」，丢掉上次成功快照。
4. **属实**。失败路径没有任何 toast，也没有 `isOnline()` 离线门控（页面未导入 `@/lib/offline/network`）。

e2e 依赖检查：`rg -n "还没有画布|canvas-list-empty" apps/web/e2e` 无匹配（exit 1）。`e2e/canvas.spec.ts` 只通过 `getByRole("button", { name: "新建构思画布" }).first()` 操作（:29、:296），该按钮在页头恒在，成功空列表行为不变，现有 e2e 不受影响。

参考写法已读：`app/(main)/tasks/countdown/page.tsx`（#385：`daysRef` + `loadError` + EmptyState 错误块 + outline 重试 + `role="alert"` 行内提示 + `isOnline()` 门控 toast）、`lib/tasks/countdown.ts` 的 `nextCountdownDaysAfterLoad`。

结论：与 TASK 描述一致，未被修过，继续执行。

## 步骤 3：目标 1–2 最小修改 ✅

新建 `apps/web/lib/canvas/list-load.ts`（与 #385 `nextCountdownDaysAfterLoad` 同构）：

- `CANVAS_LIST_LOAD_ERROR_MESSAGE = "画布列表加载失败"`
- `nextCanvasItemsAfterLoad({ previous, list })`：`list === null` → `{ items: previous, loadError: 常量 }`（首屏 previous=null 时 items 保持 null）；成功 → `{ items: list, loadError: null }`。

新建 `apps/web/lib/canvas/list-load.test.ts`（4 用例）：成功替换并清错；失败保留非空 previous（同引用）；首屏失败 items 仍 null 且有 loadError；成功空数组 → `[]` 且 loadError null。

改 `apps/web/app/(main)/canvas/page.tsx`：

- 新增 `itemsRef`（读 previous，不把 items 加进 refresh deps）+ `loadError` state；
- `refresh` 用纯函数裁决：失败保留快照并置 loadError，`isOnline()` 时弹 destructive toast（离线不弹）；
- 新增 `retry`（清 loadError 后 refresh）；
- 渲染改为嵌套三元：`items===null && loadError` → 居中错误块（destructive 文案 + outline 重试），不显示「还没有画布」；`items===null && !loadError` → 原加载中；`items.length===0`：有 loadError → 错误块（上次快照为空时刷新失败也不是空态），无错 → 原空态不变；非空列表 + loadError → 保留列表 + `role="alert"` 行内提示（与 countdown 页同款样式）+ outline sm 重试。
- 未动：`listCanvases`/repository、空态 `canvas-list-empty` 样式、新建/重命名/复制/删除逻辑与 toast、mock shim、globals.css。

## 步骤 4–5：测试与本地验证 ✅

- 新用例：`corepack pnpm -C apps/web exec vitest run lib/canvas/list-load.test.ts` → **1 file / 4 tests passed**，exit 0。
- 全量验证（仓库根目录，均 exit 0）：
  - `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0
  - `corepack pnpm -C apps/web lint` → `✔ No ESLint warnings or errors`，exit 0
  - `corepack pnpm -C apps/web exec vitest run` → **Test Files 255 passed | 1 skipped (256)；Tests 1948 passed | 2 skipped (1950)**，exit 0。基线 1944 passed / 2 skipped → 只多不少（+4 即新用例），无失败。（输出中 notifications-click.test.ts:87 一行 stderr 为既有未处理 rejection 日志噪音，不影响结果，全绿。）
- 未在本地跑 e2e（遵守任务要求，避免占用 3000 端口服务）。

## 步骤 6：提交 / PR / CI / 合并

（进行中）
