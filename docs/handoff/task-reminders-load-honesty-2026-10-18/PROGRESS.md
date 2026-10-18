# PROGRESS — task-reminders-load-honesty-2026-10-18

规划方已派单。基线 master `a35cae9`（#390）。执行 Agent：ZCode（GLM-5.3）。Codex 至约 2026-10-22 前不可用。

## 步骤 1：同步 + 建分支 — 完成

- `git checkout master && git pull origin master`：Already up to date，HEAD = `a35cae9`。
- 工作区仅有其它 handoff 文档改动（3 个旧 PROGRESS.md modified + 若干 untracked），无业务代码改动，直接带过切分支；提交时只 add 本任务 4 个文件。
- 建分支 `fix/task-reminders-load-honesty`。

## 步骤 2：核对背景 1–4 — 全部属实

- 背景 1 属实：`loadReminders`（原 28–39 行）error 分支只 `toast({ title: "读取提醒失败" })` + `return`，不设 loadError；`reminders` 初值 `[]`、无 loading state → 标题恒显 `0/3`、列表区空白，加载失败被伪装成「当前没有提醒」。
- 背景 2 属实：刷新失败时 error 分支碰巧没 `setReminders([])`（保留上次快照），但无行内错误条 / 重试，只有一闪而过的 toast；首屏失败则永远是空白「0/3」。
- 背景 3 属实：toast 无离线门控（无 `isOnline()` 调用，import 也没有）。
- 背景 4 属实：全文件无 `loadError` / `loading` state、无重试入口。
- `rg -n "读取提醒失败" apps/web`：仅命中组件本行，无测试 / e2e 依赖该文案；`rg -l "task_reminders"` 命中的备份 / 通知 / mock 文件均与本组件加载路径无关。**无需停下。**

## 步骤 3–4：最小修改 + 新单测 — 完成

- 新建 `apps/web/lib/tasks/reminders-list-load.ts`：常量 `TASK_REMINDERS_LIST_LOAD_ERROR_MESSAGE = "任务提醒加载失败"` + `nextRemindersAfterLoad({ previous, data, error })`（失败保留 previous 并透传 message / 空白回退常量；成功替换并清错）。未触碰现有 `lib/tasks/reminders.ts`。
- 新建 `apps/web/lib/tasks/reminders-list-load.test.ts`：6 用例覆盖成功替换清错 / 失败保留非空 previous 透传 message / message 空白回退常量 / data null 无 error 按失败 / 首屏失败 previous=[] 仍 [] 且有 loadError / 成功空数组无错。单跑 6 passed。
- 改 `apps/web/components/tasks/task-reminders-editor.tsx`：
  - 新增 `loadError: string | null` state、`loading: boolean`（首屏 true，load 开始 true / 结束 false）、`remindersRef` 上次成功快照。
  - `loadReminders`：走纯函数裁决——失败保留 `remindersRef.current`（**失败路径无 `setReminders([])`**）、set loadError、在线才 destructive toast（`isOnline()` 门控，离线由顶栏角标表达）；成功 `setReminders(data)` 并清错。
  - `retryLoad`：清 loadError 后重新 `loadReminders()`。
  - 渲染三分支：`loading && reminders.length===0` → 「加载中…」text-sm text-muted-foreground；`loadError && reminders.length===0` → `role="alert"` 错误空态（dashed 边框 + destructive 文案 + outline/sm「重试」Button，不呈现正常「0 条」观感）；否则保留提醒列表，`loadError` 时上方行内 `role="alert"` 提示条（destructive/40 边框）+ outline/sm 重试。成功空库（`length===0 && !loadError && !loading`）维持原空白列表 + 添加控件，行为不变。
  - **标题计数决策**：`{reminders.length}/3` 保留原数字逻辑（首屏失败显 0/3 + 错误区），未用「?/3」——取任务说明中的「优先保留数字逻辑简单」选项。
  - `removeReminder` 删除成功后同步过滤 `remindersRef`，防止下次刷新失败时已删提醒从旧快照「复活」；失败回滚路径不变。
  - 添加提醒业务规则（最多 3 条 / 去重 / 需先设日期）、Select 与 section 结构均未改。
- 未改：`lib/tasks/reminders.ts`、`task-attachments-dialog.tsx`、`task-templates-dialog.tsx`、任务详情页其它区块、`globals.css`。

## 步骤 5：本地验证（仓库根目录）— 完成

| 命令 | 退出码 |
| --- | --- |
| `corepack pnpm -C apps/web exec tsc --noEmit` | 0 |
| `corepack pnpm -C apps/web lint` | 0（No ESLint warnings or errors） |
| `corepack pnpm -C apps/web exec vitest run` | 通过：**1981 passed / 2 skipped**（基线 1975+2 → 新增 6 全过，无失败） |

未在本地跑 e2e（遵守任务约束）。

## 步骤 6：提交 / PR / CI — 进行中

（待 PR / CI / 合并后追加。）
