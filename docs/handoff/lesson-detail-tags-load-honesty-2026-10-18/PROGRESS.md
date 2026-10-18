# PROGRESS

- 2026-10-18 16:50 规划方（五狗）写好 TASK.md / PROMPT.md，派给 ZCode（GLM-5.3）。
- 2026-10-18 ZCode：基于 master `13336da` 建分支 `fix/lesson-detail-tags-load-honesty`。
- 2026-10-18 ZCode：背景核查（`apps/web/app/(main)/lessons/[id]/page.tsx` @ 13336da）三处均属实：
  1. 第 164 行 `lesson_tags` 查询解构丢掉 `error`，`(tagLinks || [])` → 失败时 selectedTags/loadedTags 被置空，伪装成「没有标签」；顶部 Promise.all（122–127 行）的 `tags` 查询同样只取 `data`，失败时 tagsData=null → allTags/lessonTags 全空。
  2. 第 263 行非新建保存无条件 `delete().eq("lesson_id", lessonId)`，error 被忽略；第 266–269 行 insert 的 error 也被忽略——加载失败置空 selectedTags 后保存会删光该复盘全部标签。
  3. 关联条目补取（151–162 行）、`lessonError → setMissing`、新建 loadOptions 均按任务要求不动。
- 2026-10-18 ZCode：实现完成——
  - 新增 `apps/web/lib/lessons/detail-tags.ts`：`LESSON_TAGS_LOAD_ERROR_MESSAGE` / `resolveLessonTagsAfterLoad`（任一 error 或 data=null → tags=[] + loadError；否则按 links 过滤 allTags 保序） / `planLessonTagSave`（有错 → skip；无错 → replace 含 tagIds）。
  - 新增 `apps/web/lib/lessons/detail-tags.test.ts`：10 个用例（正常过滤 / 忽略悬空 link / links 空为真空态 / allTagsError / linksError / 空白 message 回退常量 / null data 无 error 也算失败 / plan skip / plan replace / plan replace 空数组）。
  - 改 `apps/web/app/(main)/lessons/[id]/page.tsx`：新增 `tagsLoadError` state；Promise.all 接住 `tags` 查询 error、`lesson_tags` 查询接住 error，两者交给 `resolveLessonTagsAfterLoad` 落 selectedTags/loadedTags/tagsLoadError；编辑与查看两处标签区在 `tagsLoadError` 非空时显示 `role="alert"` 的 `text-xs text-destructive` 错误行 + 重试按钮（调 `fetchLesson`）；`handleSave` 非新建用 `planLessonTagSave`（skip 不碰 lesson_tags；replace 照旧 delete+insert，任一 error toast「标签保存失败」不阻断跳转），新建分支行为不变。
- 2026-10-18 ZCode：本地验证（apps/web 内执行）——`tsc --noEmit` exit 0；`pnpm lint` exit 0（No ESLint warnings or errors）；`vitest run` exit 0，**2047 passed / 2 skipped**（基线 2037，+10，全部来自 detail-tags.test.ts；stderr 的 `window.focus` Not implemented 为既有 jsdom 噪音）。
