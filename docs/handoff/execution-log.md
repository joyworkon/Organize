# Organize 重构执行日志

执行开始：2026-09-05。本文件是跨上下文恢复的唯一进度真相源：每次恢复先读本文件再继续，不重新开始。

## 环境与能力基线（R00 盘点）

- 基线提交：`d9ec06e`（交接包评审基线）；计划文档合并后 master = `3df63c9`。
- 本机：macOS arm64（darwin 25.6.0），Node v22.22.2，pnpm 9.10.0，系统时区 EDT（测试已验证 EDT/UTC/Asia/Shanghai 三进程）。
- Docker：可用（29.7.2，运行中）。
- Supabase CLI：2.116.0；本地后端运行中（`supabase status` 正常）；另链接远程项目 organize-staging——**只做本地验证，绝不触碰远程/生产库**。
- Playwright Chromium：已安装，E2E 可本地运行。
- `.env.local`：存在，`NEXT_PUBLIC_MOCK_BACKEND=false`（真实本地后端模式）。**不修改用户 .env.local**。
- AGENTS.md 部分计数已过时（迁移实际到 072；CI 含 audit/lint/typecheck/vitest/build/E2E/pgTAP 六门禁），一切以实际文件为准。

## 基线验证记录（R00 步骤 1）

- `tsc --noEmit`：通过（exit 0）。
- `vitest run`：132 文件 / 951 测试全部通过（EDT 时区）。
- 交接文档所述 notch.test.ts 2 个失败：已在 `TZ=Asia/Shanghai` 下复现（固定 UTC 时刻跨日导致），非已修复项。

## 每卡交付记录

### R00 基线记录与时区稳定测试 — ✅ 已完成（PR #224，master df9f88d）

- 基线提交：3df63c9
- 原问题与复现：`notch.test.ts` 的 `selectPanelTasks` 两个用例用固定 UTC 时刻（`2026-09-01T18:00:00.000Z` 等）表达"今天到期"，在东八区跨到本地次日被排除；`TZ=Asia/Shanghai npx vitest run lib/desktop/notch.test.ts` 复现 2 failed。
- 修改文件与职责：`apps/web/lib/desktop/notch.test.ts` 仅测试——"本地今天"样本改为 `localMoment()` 本地日历显式构造（与生产 `startOfDay` 语义一致）；新增两条 UTC 跨日样本（本地 23:30 仍算今天；本地次日凌晨不算今天），防实现退化成 UTC 字符串截取。
- 行为变化：无（纯测试稳定化，未改 `notch.ts` 任何判定逻辑）。
- 测试命令及退出结果：`npx vitest run lib/desktop/notch.test.ts` 在 TZ=EDT / UTC / Asia/Shanghai 三进程下均 10 passed；全量 `vitest run` 132/951 通过；`tsc --noEmit` 通过。
- 未覆盖场景：负偏移时区（如 America/Los_Angeles）未单列进程，但 EDT（UTC-4）本机进程已覆盖 UTC 西侧跨日路径。
- 回退办法：revert 本 PR 即恢复旧样本。
- 下一张可执行卡：R01。

### R01 Markdown 导出正文完整性 — ✅ 已完成（PR #225）

- 基线提交：df9f88d
- 原问题与复现：旧 `lib/export/tiptap-to-md.ts` 对未知节点默认 `renderInline` 返回空、`renderListItem` 把所有子块拍平——直接执行复现：callout/分栏正文丢失、表格多段落单元格为空、嵌套列表子项丢失、任务列表缺 `- ` 前缀、有序列表不尊重 start、代码围栏被内容内 ``` 截断、tabs/mermaid/嵌入/按钮/数据库块全部输出空。回归测试 21 个用例在旧实现上失败（已确认复现后才改实现）。
- 修改文件与职责：`lib/export/tiptap-to-md.ts`——块级递归与行内渲染分离；新增 `renderMarkdownExport() -> { markdown, warnings }` 类型化降级结果（unknown-node / database-rows-excluded / table-merged-cells / render-failed，同类去重），`tiptapJsonToMarkdown` 保留纯字符串 API 共用一次渲染；复杂块降级矩阵：callout→引用（emoji 前缀）、columns 依次展开、details 摘要加粗+正文、tabs 各页标题+正文、mermaid/htmlEmbed 代码围栏、embed 源链接（仅 http/https/站内安全目标）、buttonBlock 标签+安全目标（javascript: 等不导出）、目录/面包屑可读说明、syncedBlock 导出已有快照、databaseBlock 引用说明+警告（不读取行数据）；表格单元格多段落 `<br>` 连接、竖线防双转义、合并单元格平铺+警告；嵌套列表按标记宽度缩进；任务列表 `- [ ]`/`- [x]`；有序列表尊重 start；代码围栏避开内容内连续反引号。
- 行为变化：导出内容更完整（修复丢失）；`tiptapJsonToMarkdown` 字符串 API 与空笔记/标题行为不变；调用方（settings 页、export-button）无需改动。
- 测试命令及退出结果：`npx vitest run lib/export/tiptap-to-md.test.ts` 27 passed（旧实现上 21 failed）；全量 `vitest run` 132 文件 / 975 测试通过；`tsc --noEmit` 通过；`next lint --max-warnings 0` 通过；代表性语法用已有 marked@12 解析验证（列表/表格/引用块）。
- 未覆盖场景：真实大型笔记（千块级）的导出耗时未测；Y.Doc 内容进入 JSON 后的形状由保存层保证。
- 回退办法：revert 本 PR。
- 下一张可执行卡：R02。

### R02 导出当前编辑快照 — ✅ 已完成（PR #226）

- 基线提交：3be3c6b
- 原问题与复现：编辑页 `exportMarkdown` 先 `await flushSave()` 再让 `exportNoteToMarkdown` 重新从数据库拉数据——离线/保存失败时导出的是服务器旧内容甚至直接失败；异步间隙读共享 refs，快速切页可能导出错笔记。卡片路径 `note-card.tsx` 菜单调用 `exportNoteToMarkdown` 无 catch，失败产生未处理 rejection 且无用户反馈；`ExportButton` 的 handleExport 也无 catch。
- 修改文件与职责：新增 `lib/export/note-export.ts`——`renderNoteExport()`（纯函数：快照→markdown+清洗文件名+warnings）与 `downloadNoteExport()`（触发下载），核心库不依赖 React/网络；`components/share/export-button.tsx`——服务端路径改用 note-export 渲染（保持权限读库），`exportNoteToMarkdown` 改为返回 boolean、内部 catch+toast 反馈，不再抛未处理异常；`app/(main)/notes/[id]/page.tsx`——`exportMarkdown` 改为同步捕获点击瞬间快照（editor.getJSON 优先）后立即渲染下载，移除 `await flushSave()`，dirty 时提示"已导出当前内容，云端仍待同步"，不清 dirty/草稿/冲突状态，数据库块降级有简短提示。
- 行为变化：编辑页导出=本地最新快照（离线/冲突也含本地最新字，不落库）；卡片导出仍=服务器已保存版本；失败有 toast 反馈。
- 测试命令及退出结果：新增 `lib/export/note-export.test.ts` 7 passed（离线快照、冲突快照、快照不可变、中文/非法文件名、标题回退、warnings 分离、下载触发）；全量 `vitest run` 133 文件 / 982 测试通过；`tsc --noEmit`、`next lint --max-warnings 0` 通过；PR 上 CI E2E（浏览器层含笔记页保存链路）通过。
- 未覆盖场景：真实浏览器中"编辑后立即离线导出"的手动点击验证安排在最终跨模块 E2E（避免每卡起生产构建）。
- 回退办法：revert 本 PR。
- 下一张可执行卡：R03。

## 待办队列

R03 → R04 → R05 → R06 → R07 → R08 → R09 → D00/D01 → D02 → D03 → D04 → D05 → R10 → R11 → R12 → D06 → 跨模块端到端检查。

## 遗留问题

（暂无）
