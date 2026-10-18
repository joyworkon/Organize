# 执行进度（ZCode）

## 步骤 1：同步 master、建分支 ✅

- `git checkout master` + `git -c 'credential.helper=!gh auth git-credential' pull origin master`：Already up to date，HEAD = `a2644e1`（#387），与任务基线一致。
- `git checkout -b fix/lessons-list-load-honesty` 成功。

## 步骤 2：核对背景 1–4 ✅（全部属实，未被修过）

逐条核对 `apps/web/components/lessons/lessons-list.tsx`：

1. **属实**。`fetchLessons`（49–101 行）中 `const { data: lessonsData } = await supabase.from("lessons")...`（55–59 行）不读 `error`；61 行 `(lessonsData || [])` 把查询失败（data 为 null）吞成空列表；`finally` 里 `setLoading(false)`（99 行）后落到 211–217 行 EmptyState，标题 `hasFilter ? "没有匹配的复盘" : "还没有复盘"`——加载失败被伪装成空库/假「没有匹配」。
2. **属实**。63–67 行同一次 `Promise.all` 的 `lesson_tags`（两查）/ `tags` 三查同样不检查 error，`(tagsData || [])` / `(tagLinks || [])` / `(lessonTagLinks || [])`（69/72/83 行）在失败时静默降级为空 tag 映射，不提示。
3. **属实**。已有列表时刷新失败：`lessonsData` 为 null → `lessonsList = []` → 97 行 `setLessons([])` 冲掉上次成功快照（比 canvas/reading 更糟的场景成立）。
4. **属实**。全文件无 `loadError` state、无重试、无 destructive toast、无 `isOnline` 门控（未 import `@/lib/offline/network`）。

`rg -n "还没有复盘|没有匹配的复盘" apps/web` 结果：仅命中 `components/lessons/lessons-list.tsx:217` 一处，无测试 / e2e / 其他组件依赖该文案；成功空列表行为不变则不受影响。

参考实现已读：`lib/canvas/list-load.ts`（#386）、`lib/reading/list-load.ts`（#387，`nextReadingItemsAfterLoad` 带 `error.message` trim 回退逻辑，与任务签名一致，直接对齐该版）、`reading-view.tsx` 的 loadError UI（错误 EmptyState + 行内 `role="alert"` + outline 重试 + isOnline 门控 toast）。类型 `LessonWithTags`（`packages/shared/src/index.ts:386`）确认。`apps/web/lib/lessons/` 目录不存在，需新建。

结论：与任务描述一致，继续步骤 3。

## 步骤 3：最小修改 ✅

- 新建 `apps/web/lib/lessons/list-load.ts`：`LESSONS_LIST_LOAD_ERROR_MESSAGE = "复盘列表加载失败"` + `nextLessonsAfterLoad({ previous, data, error })`（对齐 `lib/reading/list-load.ts`：`error || data === null` 即失败 → lessons 保留 previous + `error.message` trim 非空否则常量；成功 → `data` + 清错）。
- 新建 `apps/web/lib/lessons/list-load.test.ts`（6 用例）：成功替换并清错 / 失败保留非空 previous 且透传 message / message 空白回退常量 / data 为 null 且无 error 亦按失败 / 首屏失败 previous=[] → lessons 仍 [] 且有 loadError / 成功空数组 → [] 且 loadError null。
- 改 `apps/web/components/lessons/lessons-list.tsx`：
  - 新增 `loadError` state 与 `lessonsRef`（上次成功快照，fetchLessons deps 里读不到 state）；
  - `fetchLessons`：lessons 主查询读 `error`，失败走纯函数（保留快照 + setLoadError + `isOnline()` 才 destructive toast）后 return；标签三查改从完整响应对象取 `data`，任一 error 时 `isOnline()` 才 toast「标签信息加载失败」，主列表仍以 lessons 结果为准、tag 映射按空降级不冲掉 lessons；成功路径 `lessonsRef.current` 同步 + `setLoadError(null)`；`if (!user) return` 未动；
  - 渲染：新增 `loadError && lessons.length > 0` 行内 `role="alert"` + outline/sm 重试；骨架屏条件改为 `loading && lessons.length === 0 && !loadError`；`loadError && lessons.length === 0` → 错误 EmptyState（标题=失败文案、描述「网络或服务暂时不可用，请重试」）+ outline 重试；`filtered.length === 0 && !loadError` → 维持原空态文案；其余照旧；
  - 新增 `retry`（清 loadError 后 `void fetchLessons()`）。
- 勿做清单核对：未动 LessonCard、删除/垃圾箱流程、路由、标签筛选客户端逻辑、类型配置、globals.css，未抽新 hook、未重构布局；真空库/真无匹配文案不变。

## 步骤 4–5：验证 ✅

新用例 `vitest run lib/lessons`：6 passed (6)。全量验证（仓库根目录，退出码）：

| 命令 | 退出码 |
| --- | --- |
| `corepack pnpm -C apps/web exec tsc --noEmit` | 0 |
| `corepack pnpm -C apps/web lint` | 0（No ESLint warnings or errors） |
| `corepack pnpm -C apps/web exec vitest run` | 0，**1963 passed / 2 skipped**（基线 1957 passed / 2 skipped，净增 6，无失败） |

e2e 未在本地跑（遵守任务约束，交由 CI）。
