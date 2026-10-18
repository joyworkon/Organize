# PROGRESS — add-to-canvas-boards-load-honesty（2026-10-18）

执行：ZCode。分支 `fix/add-to-canvas-boards-load-honesty`，基线 master `3c852f9`（#394）。

## 步骤 1：同步 master + 建分支 ✅
- `git pull origin master` → Already up to date，HEAD `3c852f9`。
- `git checkout -b fix/add-to-canvas-boards-load-honesty`。
- 工作树（已跟踪文件）干净；`docs/handoff/*` 其它目录保持未跟踪，不入本 PR。

## 步骤 2：核对背景 ✅（全部属实，未修）
- **背景 1**：`apps/web/components/library/add-to-canvas-dialog.tsx:108-137` boards effect，`res.ok` 时映射，**else 分支（128–131 行）`setBoards([]); setBoardId("");`**——无 `boardsLoadError`、无 toast、无重试。属实。
- **背景 2**：「页面」下拉（289–304 行）仅 `boards.map(...)`；失败后下拉为空，`canSubmit`（166 行）因 `boardId === ""` 禁用，无法区分「0 页」与「加载失败」。属实。
- **背景 3**：成功且 `content.boards.length === 0` 走 `setBoards([])` 且无错——应保持诚实空态。
- **背景 4**：listCanvases 跳（76–99 行）已用 `lib/canvas/list-load.ts` 的 `nextCanvasItemsAfterLoad` + `canvasesRef` + `loadError` + `reloadCount` 修好；regions effect（140–157 行）`!res.ok` 时 early return 不清空。本任务不动这两处。
- `getCanvas` 签名（`lib/canvas/repository.ts:59`）：`{ ok: true; row: CanvasRow } | { ok: false; reason: "not-found" | "unauthorized" | "network" }`。
- 对话框无现成组件测试（`components/library/` 下仅 `add-to-canvas-dialog.tsx`）。

### 实现方案（对齐 #394 的 list-load 同构）
- 新增 `lib/canvas/boards-load.ts`：`CANVAS_BOARDS_LOAD_ERROR_MESSAGE`、泛型 `nextBoardsAfterLoad<T>({ previous, ok, boards? })` → `{ boards, loadError }`；另加 `nextBoardIdAfterLoad(boards, currentBoardId)` 裁决加载后选中页（当前项仍在列表则保留，否则落第一页，空则 `""`）——把 TASK 里「保留原 boardId 或落到 previous[0]」的规则抽成可测纯函数。
- 组件：`boardsRef` 带所属 `canvasId` 标记（换画布时不得把旧画布的页面当快照），`boardsLoadError` 独立于列表 `loadError`，`boardsReloadCount` 驱动重试；失败在线弹 destructive toast；渲染仅改「页面」区域。

## 步骤 3：代码改动 ✅
- **新增** `apps/web/lib/canvas/boards-load.ts`：
  - `CANVAS_BOARDS_LOAD_ERROR_MESSAGE = "画布页面加载失败"`
  - `nextBoardsAfterLoad<T>(input: { previous: T[]; ok: true; boards: T[] } | { previous: T[]; ok: false }) → { boards, loadError }`——失败原样返回 previous（同引用）+ 错误文案；成功替换并清错（成功空列表 = 诚实空态，不带错）。
  - `nextBoardIdAfterLoad<T extends { id }>(boards, currentBoardId) → string`——当前选中仍在列表则保留，否则 `boards[0]?.id ?? ""`。
- **新增** `apps/web/lib/canvas/boards-load.test.ts`：9 用例（失败保留非空快照同引用 / 成功替换清错 / previous 空 + 失败 → `[]` 但 loadError 非空 / 成功空 → `[]` 无错 / 二者仅凭 loadError 区分；boardId 保留 / 换画布回落第一页 / 未选→第一页 / 空列表→`""`）。
- **薄改** `apps/web/components/library/add-to-canvas-dialog.tsx`（仅 boards 这一跳，+84/−28）：
  - import `boards-load`；新增 `boardsRef: { canvasId; boards }`、`boardsLoadError`、`boardsReloadCount`。
  - boards effect deps 增 `boardsReloadCount`；取 `previous = boardsRef.current.canvasId === canvasId ? ... : []`；用 `nextBoardsAfterLoad` 裁决，**删除**原 else 分支的 `setBoards([]); setBoardId("")`；`setBoardId(cur => nextBoardIdAfterLoad(plan.boards, cur))`（纯函数更新器，无副作用）；`plan.loadError && isOnline()` 时 destructive toast（文案用常量）。
  - 首分支（关闭 / 新建画布）同时重置 ref 与 `boardsLoadError`。
  - 新增 `retryLoadBoards()`：清错 + `boardsReloadCount++`。
  - 渲染：`boardsLoadError && boards.length === 0` → `role="alert"` 错误条 + outline/sm 重试，**替代**空下拉；`boards.length > 0 && boardsLoadError` → 行内 `role="alert"` + 重试 + 保留页面下拉（旧快照）；无错 → 原页面下拉不变。区块下拉、画布列表区、`canSubmit` 表达式均未改（`canSubmit` 原式已满足：无 boardId 不可提交，有快照 boardId 可提交）。
- **未改**：`list-load.ts` / `list-load.test.ts` / `repository.ts` / regions effect / 区块下拉 / 提交与新建画布 / `AddToCanvasButton` / `globals.css` / canvas 列表页。

## 步骤 4：本地验证 ✅
| 命令 | 结果 |
| --- | --- |
| `corepack pnpm -C apps/web exec tsc --noEmit` | exit 0 |
| `corepack pnpm -C apps/web lint` | ✔ No ESLint warnings or errors |
| `corepack pnpm -C apps/web exec vitest run lib/canvas/boards-load.test.ts` | 9 passed |
| `corepack pnpm -C apps/web exec vitest run`（全量） | **2005 passed / 2 skipped**，263 files passed / 1 skipped，exit 0（基线 1996 → **+9**） |

全量输出里 `Not implemented: window.focus` 为 `lib/platform/notifications-click.test.ts` 的 jsdom 既有噪音，非失败。未本地跑 e2e。
