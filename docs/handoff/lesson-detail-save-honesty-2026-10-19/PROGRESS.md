# PROGRESS — lesson-detail-save-honesty

## 2026-10-19 步骤记录

1. 基线确认：master HEAD `bb14e1c`（#444 已合并），`git pull origin master` → Already up to date。建分支 `fix/lesson-detail-save-honesty`。
2. 背景复核（对照 `apps/web/app/(main)/lessons/[id]/page.tsx` 现状，全部属实）：
   - 属实①：`handleSave` 只有 `try/finally`，无 `catch`；insert/update `error` 时 `throw error` 成为未处理 Promise 拒绝，无任何 toast，按钮恢复可点、假装保存成功。
   - 属实②：新建分支 `lessons` 插入成功后 `await supabase.from("lesson_tags").insert(links)` 完全不检查返回 error，标签关联失败静默，跳转后标签消失。
   - 属实③：编辑分支 `update(payload).eq("id", lessonId)` 不带 `.select("id")`，RLS/已删除导致 0 行更新时 error 为 null，照样跳转、假装保存成功。
   - 属实④：`if (!user) return;` 静默返回，无「登录已过期」提示。
3. 最小修改完成：
   - 新增 `apps/web/lib/lessons/detail-save.ts`：`resolveLessonSaveUser`（未登录→「登录已过期，请重新登录」）、`resolveLessonInsertResult`（insert error/无 data→「保存复盘失败，请重试」）、`resolveLessonUpdateResult`（update error→通用文案；0 行/null data→「复盘不存在或无权限编辑」）、`resolveLessonTagLinkResult`（lesson_tags error→「标签保存失败」）。
   - 新增 `apps/web/lib/lessons/detail-save.test.ts`（9 例，覆盖 TASK 要求的 7 场景 + null-data 防御）。
   - `page.tsx` handleSave：加 catch+toast 不跳转；update 加 `.select("id")` 判 0 行；新建分支 lesson_tags insert 检查 error 并 toast（照常跳转）；未登录 toast；成功路径与 handleDelete/加载逻辑/planLessonTagSave 均未动。
4. 本地验证（仓库根目录，分支 fix/lesson-detail-save-honesty）：
   - `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0
   - `corepack pnpm -C apps/web lint` → exit 0（No ESLint warnings or errors）
   - `corepack pnpm -C apps/web exec vitest run` → exit 0，304 passed | 1 skipped 文件，**2288 passed | 2 skipped** 用例（基线 2277+2，新增 11 例 detail-save.test.ts；输出中的 jsdom window.focus 报错为 notifications-click 既有噪音，非失败）
