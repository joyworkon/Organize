# PROGRESS — note-page-comments mutation honesty

执行：Kimi K3Max。分支 `fix/note-page-comments-mutation-honesty`。

## 2026-10-19

### 步骤 1–2：同步与背景核实
- master HEAD = `4fd8b5a`（#440 已合并），`git pull origin master` → Already up to date。已建分支 `fix/note-page-comments-mutation-honesty`。
- 背景核实（`apps/web/components/notes/note-page-comments.tsx` 修复前）：
  1. **属实**：`toggleResolved`（168–181 行）/ `deleteThread`（183–196 行）只检查 `error`；RLS 拒绝或行不存在时 PostgREST 返回 0 行且 error=null，UI 当成功并 `loadThreads()`——假装成功。
  2. **属实**：两函数无 try/catch；异常经 `onClick={() => void ...}` 变未处理 rejection。
  3. **属实**：「解决/重新打开」「删除」按钮无进行中态，可连点。
  4. 遗留（本任务不改）：`submit` 新建线程后写评论失败的回滚 `delete` 忽略结果。

### 步骤 3：最小修改 + 单测
- `note-page-comments.tsx`：
  - `toggleResolved` / `deleteThread` 的 `.update/.delete` 链尾加 `.select("id")`；`error` 或返回行数为 0 都判失败，沿用现有文案「评论状态更新失败」/「删除评论失败」；整体 try/catch，异常走同一文案；仍遵守 `isCurrent()`；成功后 `await loadThreads()`。
  - 新增 `pendingThreadIds: ReadonlySet<string>`，写操作期间该线程「解决/删除」两按钮 `disabled`，finally 清除；不阻塞其它线程与发送框。
- `note-page-comments.test.tsx`：fake supabase 增 `update`/`delete` 链与 `updates`/`deletes` 记录；新增 describe「解决/删除写诚实性」4 用例（update 0 行→失败文案+禁用恢复；delete 0 行→失败文案；reject→失败文案无未处理 rejection；成功→触发重新加载并显示「重新打开」）。

### 步骤 4：本地验证（仓库根，特性分支）
- `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0
- `corepack pnpm -C apps/web lint` → exit 0（No ESLint warnings or errors）
- `corepack pnpm -C apps/web exec vitest run` → Test Files 301 passed | 1 skipped；Tests **2251 passed | 2 skipped**（基线 2247+4）
