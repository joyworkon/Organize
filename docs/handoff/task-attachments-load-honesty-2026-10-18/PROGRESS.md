# PROGRESS — task-attachments-load-honesty-2026-10-18

规划方已派单。基线 master `5df554b`（#389）。执行 Agent：ZCode。

## 步骤 1：同步 master、建分支 — 完成

- `git checkout master && git pull origin master` → Already up to date，HEAD `5df554b`（与基线一致）。
- `git checkout -b fix/task-attachments-load-honesty`。

## 步骤 2：核对背景 1–4 — 全部属实

- 背景 1 属实：`task-attachments-dialog.tsx:46-49` error 分支只 `toast({ title: "读取附件失败", variant: "destructive" })` 后 `return`，不设 loadError；`attachments` 初值 `[]`、`loading` 已 false → 落到 `TaskAttachmentList emptyText={query ? "没有匹配的附件" : "暂无任务附件"}`（100 行），失败被伪装成空库。
- 背景 2 属实：error 分支碰巧没有 `setAttachments([])`，但无行内错误条 / 重试按钮，用户只有一闪而过的 toast。
- 背景 3 属实：toast 无离线门控（未 import `isOnline`）。
- 背景 4 属实：全文件无 `loadError` state、无重试入口。
- `rg -n "暂无任务附件|没有匹配的附件" apps/web` → 仅命中 `task-attachments-dialog.tsx:100` 自身，无测试 / e2e 依赖；本任务不改真正空库时的文案与行为。
- 已读参考实现：`lib/tasks/templates-list-load.ts`（#389 纯函数）、`task-templates-dialog.tsx`（loadError state + ref 快照 + isOnline 门控 toast + role="alert" 错误空态 / 行内提示 + outline/sm 重试）。

## 步骤 3–4：最小修改 + 新单测 — 完成

- 新建 `apps/web/lib/tasks/attachments-list-load.ts`：常量 `TASK_ATTACHMENTS_LIST_LOAD_ERROR_MESSAGE = "任务附件加载失败"` + `nextAttachmentsAfterLoad({ previous, data, error })`（失败保留 previous 并透传 message / 空白回退常量；成功替换并清错）。未触碰现有 `lib/tasks/attachments.ts`。
- 新建 `apps/web/lib/tasks/attachments-list-load.test.ts`：6 用例覆盖成功替换清错 / 失败保留非空 previous 透传 message / message 空白回退常量 / data null 无 error 按失败 / 首屏失败 previous=[] 仍 [] 且有 loadError / 成功空数组无错。单跑 6 passed。
- 改 `apps/web/components/tasks/task-attachments-dialog.tsx`：新增 `loadError` state + `attachmentsRef` 快照；`load` 失败走纯函数保留快照、在线才 destructive toast、失败路径无 `setAttachments([])`；成功 `setAttachments(data)` 并清错；`loading` 行为不变（开始 true 结束 false）。渲染三分支：loading→spinner；`loadError && attachments.length===0`→`role="alert"` 错误空态（Paperclip + destructive 文案 + outline/sm 重试，不显示「暂无任务附件」）；否则（有 loadError 时先出行内 `role="alert"` 提示条 + 重试）`TaskAttachmentList`，真空库文案不变。`onDeleted` 同步过滤 `attachmentsRef`。未改 `TaskAttachmentList` / `lib/tasks/attachments.ts` / 上传流程 / 提醒编辑器 / 模板对话框 / globals.css。

## 步骤 5：本地验证（仓库根目录）— 完成

| 命令 | 退出码 |
| --- | --- |
| `corepack pnpm -C apps/web exec tsc --noEmit` | 0 |
| `corepack pnpm -C apps/web lint` | 0（No ESLint warnings or errors） |
| `corepack pnpm -C apps/web exec vitest run` | 通过：**1975 passed / 2 skipped**（基线 1969+2 → 新增 6 全过，无失败） |

未在本地跑 e2e（遵守任务约束）。
