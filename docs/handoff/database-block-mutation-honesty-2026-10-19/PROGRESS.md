# PROGRESS: database-block 写操作诚实性

执行 Agent: Kimi K3Max。任务书: TASK.md。

## 2026-10-19 Step 1: 同步 master + 复核背景

- master HEAD = `b2a706f`（#436），与任务书基线一致；已建分支 `fix/database-block-mutation-honesty`。
- 工作区存在其它 handoff 目录的 PROGRESS.md 未暂存改动，保持不动；提交只 add 本任务文件。

### 背景复核（对照 apps/web/components/editor/extensions/database-block.tsx 现状）

1. **属实**。`handleAddRow`（130–141 行）：`if (!res.ok) throw new Error("添加行失败")`，但 `catch { /* ignore */ }`——失败时 UI 零反馈，用户点「加行」像没点。
2. **属实**。`patchViews`（91–101 行）：先 `setRecord({ ...record, views: newViews })` 乐观更新，再 `fetch PATCH`；`catch { /* 静默失败，本地已更新 */ }`——未检查 `res.ok`（4xx/5xx 不进 catch），本地已当保存成功。
3. **属实**。`handleDeleteRow`（143–149）/ `handleUpdateCell`（151–163）/ `handleUpdateRowSort`（165–183）：乐观改本地后 `fetch`，`catch { void load(); }`；未检查 `res.ok`。HTTP 失败时既不 reload 也不提示，乐观态留在错误结果上。
4. **属实**。加载路径已有 `error` state + 「重试」按钮（331–337 行，重试调 `load()`）——写失败复用同一 `setError` 通道。
5. **属实**。`case "table"` 走独立 `TableView`（自带 fetch/error），本任务不改 `table-view.tsx`；只修 board/list/gallery/calendar/chart/admin 共用的写回调与 `patchViews`。

结论：需要修。按 TASK.md「目标」做最小修改。

## 2026-10-19 Step 2: 实现

- 新增 `apps/web/lib/databases/block-mutation-result.ts`（放在既有 `lib/databases/` 目录，对齐 `linked-list-load.ts` 惯例）：
  - `resolveBlockMutationResult({ ok, bodyError?, fallback })` → `{ ok: true } | { ok: false; message }`；bodyError 为非空白字符串时优先用服务端文案，否则 fallback。
  - `readMutationError(res)`：读响应 json 的 `error` 字段，解析失败返回 undefined（API 错误形状已确认为 `{ error: string }`）。
  - 配 `block-mutation-result.test.ts` 5 个用例。
- 改 `apps/web/components/editor/extensions/database-block.tsx`（仅此一个组件文件）：
  - 新增 `notifyMutationFailure(message)`：在线才弹 `toast({ variant: "destructive" })`（离线由顶栏离线角标表达，对齐 reading-view 惯例）；复用 `@/hooks/use-toast` + `@/lib/offline/network` 现有设施。
  - `patchViews`：检查 `res.ok`；失败回滚 `setRecord` views 到调用前快照 + toast。
  - `handleAddRow`：失败不改 rows（维持现状）+ toast；不再 `catch { /* ignore */ }`。
  - `handleDeleteRow` / `handleUpdateCell` / `handleUpdateRowSort`：检查 `res.ok`；失败精确回滚乐观更新（删行按原索引插回 / 单元格还原 values / 排序还原 sort+values）+ toast；不再只 `catch { void load(); }`。
  - 固定兜底文案：保存视图失败 / 添加行失败 / 删除行失败 / 保存单元格失败 / 保存排序失败。
- 未改 table-view.tsx、各 *-view.tsx、/api/databases*、e2e、globals.css；未新增依赖；加载失败路径（error 条 + 重试）保持现状。

## 2026-10-19 Step 3: 本地验证

- `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0
- `corepack pnpm -C apps/web lint` → exit 0（No ESLint warnings or errors）
- `corepack pnpm -C apps/web exec vitest run` → exit 0，**2237 passed / 2 skipped**（基线 2232 + 新增 5 用例；299 文件 passed / 1 skipped）
