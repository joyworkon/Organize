# PROGRESS

- 2026-10-18 17:45 规划方（五狗）写好 TASK.md / PROMPT.md，派给 ZCode（GLM-5.3）。基线 master `eb33c9e`（#404 已合并）。
- 2026-10-18 ZCode 开始执行。步骤 1 完成：master 已是 `eb33c9e`（pull 确认 up to date），建分支 `fix/lesson-detail-link-options-load-honesty`。
- 步骤 2 背景核实（基线 eb33c9e，page.tsx 实读）：(1) 编辑态 fetchLesson L129–139：Promise.all 只解构 tagsError，tasks/readings/notes 只取 data，失败即 `(data||[])` 置空 → 三个关联 Select 只剩「无」，属实；(2) 新建态 loadOptions L196–205 同样四路只取 data，属实；(3) linkedTask/linkedReading/linkedNote `.single()` 补取在 L158–169，按任务要求不动。结论：问题均在，按 TASK 修。
- 步骤 3 完成：新增 `apps/web/lib/lessons/detail-link-options.ts`（常量 + `nextLinkOptionsAfterLoad`：失败路保留 previous、成功路替换、任一失败 loadError 取首个非空 message/空白回退常量、三路成功清错）+ `detail-link-options.test.ts`（8 用例，覆盖 TASK 列的 6 个 + null-data-无-error 也算失败 + 失败路间首个非空 message 顺序）。页面改动：新增 `linkOptionsLoadError` state 与 `lastLinkOptionsRef`（上次完整成功快照）；`fetchLesson` 与新建态 `loadNewOptions`（从 effect 内提取为 useCallback，供重试按钮调用）三路都走纯函数；编辑表单三个关联 Select grid 之后加 role="alert" 错误行 + 重试按钮（新建态调 loadNewOptions、编辑态调 fetchLesson）；未动 tags/setAllTags 写法、未动 detail-tags/标签保存/关联补取/missing/列表页/e2e/globals.css。
- 步骤 4 完成：`tsc --noEmit` 退出码 0；`pnpm lint` 无警告无错误；`vitest run` 全量 **2055 passed / 2 skipped**（基线 2047，+8 为本任务新增 detail-link-options.test.ts 用例）。未跑 e2e（按约定）。
