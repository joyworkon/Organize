# PROGRESS

- 2026-10-18 约 21:25 Asia/Taipei：规划方（五狗）写好 TASK.md / PROMPT.md，派给 ZCode（GLM-5.3）。基线 master `56640fe`（#409 lesson-detail-linked-titles-load-honesty 已合并）。下一任务：新建复盘态 tags 全量加载失败诚实处理（#404 留下的 follow-up；#405 已修同函数里的关联下拉）。
- 2026-10-18 21:4x：ZCode 开工。`git pull` 确认 master = `56640fe`，建分支 `fix/lesson-detail-new-tags-load-honesty`。
- 核查背景 1–3（`apps/web/app/(main)/lessons/[id]/page.tsx` @ `56640fe`）：
  1. **属实**。`loadNewOptions`（267–283 行）tags 路只解构 `{ data: tagsData }`，随即 `setAllTags((tagsData || []) as Tag[])`——失败 → allTags=[] → TagSelector 伪装成「一个标签都没有」。
  2. **属实**。同函数 tasks/readings/notes 三路走 `applyLinkOptions(nextLinkOptionsAfterLoad(...))`（#405），有 `linkOptionsLoadError` + 按 `isNew` 分支的重试（638 行）；tags 无对等处理。
  3. **属实**。编辑表单 tags 错误行（567–576 行）重试按钮写死 `fetchLesson()`；若新建态置了 `tagsLoadError`，重试会走 `fetchLesson` 的 isNew 早退（不重拉选项）。只读态错误行在 677–684 行。
- 三项均属实，未发现已被修好，继续实施。
- 实施改动（3 个业务文件）：
  - `apps/web/lib/lessons/detail-tags.ts`：新增 `nextAllTagsAfterLoad({ previous, data, error }) → LessonTagsLoadPlan`（失败/`data===null` → 保留 previous + loadError（message trim 空回退常量）；成功 → data 替换（允许空数组）+ 清错）；复用既有 `LessonTagsLoadPlan` 返回类型（注释泛化到两个函数）；文件头注释补新建态一行。未动 `resolveLessonTagsAfterLoad` / `planLessonTagSave`。
  - `apps/web/lib/lessons/detail-tags.test.ts`：`nextAllTagsAfterLoad` 新增 5 个用例（成功替换并清错（含真空数组）；失败保留 previous + loadError；message 空白回退常量；`data:null` 无 error 也算失败；首屏 previous 空数组失败不伪造列表）。
  - `apps/web/app/(main)/lessons/[id]/page.tsx`：`loadNewOptions` tags 路解构 `error: tagsError`，经 `nextAllTagsAfterLoad({ previous: lastAllTagsRef.current, ... })` 落 `setAllTags` + `setTagsLoadError`，无错时同步 `lastAllTagsRef`（新增 ref，与 lastLinkOptionsRef 同款）；编辑表单 tags 错误行文案按 `isNew` 分支（新建「，请重试后再选标签」，编辑保持「，保存时不会改动已有标签」）+ 重试按钮 `isNew ? loadNewOptions() : fetchLesson()`；只读态 tags 错误行与重试不动（新建不进只读）；编辑态 `fetchLesson` 标签主路径未动；新建 `handleSave` insert lesson_tags 行为保持。
- 本地验证：
  - `corepack pnpm -C apps/web exec tsc --noEmit` → exit 0。
  - `corepack pnpm -C apps/web lint` → exit 0，No ESLint warnings or errors。
  - `corepack pnpm -C apps/web exec vitest run` → exit 0，**2085 passed | 2 skipped**（基线 2080 passed / 2 skipped，+5，满足「至少 +4」）。
- 提交（只含 3 个业务文件 + 本 PROGRESS.md）→ push → `gh pr create`：进行中。
