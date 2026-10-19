# PROGRESS — reading-list-mutation-honesty（执行：Kimi K3Max）

## 2026-10-19 步骤 1–2：同步基线 + 背景核对

- 基线：master `92b7e5c`，与 origin/master 同步；分支 `fix/reading-list-mutation-honesty` 已建。
- 背景核对（对照 `apps/web/components/library/reading-view.tsx` 现码）：
  1. **属实** — `updateStatus`（394–410）：`if (!error)` 单分支，失败时 UI 零反馈。
  2. **属实** — `togglePin`（453–467）：乐观改 `is_pinned`，失败回滚但无提示。
  3. **属实** — `batchUpdateStatus`（507–524）：`if (res.ok)` 单分支，`!res.ok`/网络异常静默。
  4. **属实** — `batchTogglePin`（526–541）：`if (!error)` 单分支，失败静默。
  5. **属实** — `batchAddTag`（563–605）：`if (!createRes.ok) return` 裸 return；批量挂标签仅 `if (res.ok)`；无 try/catch。
  6. **属实** — `deleteItem`（412–451）/ `batchDelete`（543–561）已有 destructive toast；列表加载已有 `loadError` + 重试 + `isOnline()` 门控（245/289/299 行）。
- 便利条件：`isOnline` 已在 41 行 import，toast 已在用，惯例可直接对齐。

## 2026-10-19 步骤 3：最小修改（已完成，仅 apps/web/components/library/reading-view.tsx）

- `updateStatus`：`if (!error)` 补 else 分支——在线时 `toast({ title: "更新阅读状态失败", description: error.message, variant: "destructive" })`。
- `togglePin`：保留乐观更新 + 失败回滚，`if (error)` 内补在线 toast「置顶失败 / 取消置顶失败」（description 带 error.message）。
- `batchUpdateStatus`：整体包 try/catch；`!res.ok` → 在线 toast「批量更新状态失败」；catch 网络异常同样 toast（description 带异常 message）。
- `batchTogglePin`：`if (!error)` 补 else——在线 toast「批量置顶失败」。
- `batchAddTag`：整体包 try/catch；`!createRes.ok` → 在线 toast「创建标签失败」后 return（不再裸 return）；`!res.ok` → 在线 toast「批量添加标签失败」；catch 网络异常同样 toast。
- 全部失败提示经 `isOnline()` 门控，对齐同文件加载失败惯例（245/289/299 行）。未拆纯函数（任务书允许直接在组件写清分支）。
- 未触碰：deleteItem / batchDelete / 加载路径 / ReadingCard / /api/reading-items* / e2e / globals.css / handleTagsApplied；无新依赖。

## 2026-10-19 步骤 4：本地验证

- `corepack pnpm -C apps/web exec tsc --noEmit` → 退出码 0
- `corepack pnpm -C apps/web lint` → 退出码 0（No ESLint warnings or errors）
- `corepack pnpm -C apps/web exec vitest run` → 进行中，结果待补
  → 退出码 0，299 文件通过 / 1 skipped，2237 passed / 2 skipped（与基线一致，未新增用例）
