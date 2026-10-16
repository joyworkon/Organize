# 资料库逐功能检查交接 · 2026-10-16

## 触发与当前状态

用户要求额度剩约 3% 时交接。最新实查五小时窗口已使用 98%（剩 2%），周窗口使用 79%（剩 21%）。因此本轮收拢成果，停止新增修复和耗时测试。长期规则已写入 `/Users/k/.codex/AGENTS.md`；这是阶段性查询规则，没有安装额度事件 Hook。

仓库 `/Users/k/Documents/ZCode/Organize`；当前分支 `fix/library-interaction-audit`；HEAD `70cdb390af58e1464f2abe103904120037b40644`。本轮开始前已同步 master，然后建立此分支。交接前产品代码仍是该 HEAD，候选补丁尚未应用；交接目录本身是新增未提交文件。当前资料库工作没有 PR，也没有本轮 CI 结果。

## 用户目标与边界

继续按功能逐个检查、修复，并统一手机/PC/Web 的中性灰 Codex 风格。正式 UI 已接入，不再只是预览稿；`127.0.0.1:3200/#home` 是旧静态提案，不能拿它当当前产品。先读根 DESIGN.md、docs/design/page-specs.md、migration-plan.md、adoption-report.md。保留用户内容色板、显式笔记模板和构思画布的布局/交互合同。

用户多次要求按难度使用对应模型，并告知实际使用的模型：简单界面修补 GPT-6 Luna；实现与集成 GPT-6.1 Sol；复杂审查 GPT-6 Astra。此前已经授权这些模型协作。本轮 Luna 给出 tabs/search 补丁，Sol 检查账号和保存链路；Astra 本轮资料库尚未启用。不要声称主线程模型已自动切换；说明具体子任务用了哪个模型。

按 AGENTS.md 使用 pnpm、单条特性分支、PR、CI 通过后 squash merge；禁止直接 push master/force push。接手现有分支，先检查是否有人更新，别直接切 master 丢掉交接成果。不要扩展到全站 Auth 重构、后端迁移或整页重写。

## 已完成并合并的前置工作

- PR #342：全站正式 UI 接入，master 提交 `9d3ea7f`。设计规范、tokens、页面规格、接入记录均在仓库。
- PR #343：https://github.com/joyworkon/Organize/pull/343 ，已合并到当前 HEAD `70cdb39`：工作台账号边界、全天任务日期、任务链接/完成按钮、手机日期布局与触控尺寸。
- 上轮验证：1690 单测通过、2 个既有跳过；tsc/lint/mock 构建通过；26 浏览器回归通过；全部 CI 最终通过。协作 E2E 首轮 15/16，一项可编辑断言失败，同 HEAD 重跑 16/16；根因未证明，未修改断言。
- `docs/design/workbench-audit-2026-10-16.md` 有证据。UI-03 仍标待验证，是因为真实双账号跨标签、移动真机和原生窗口未验证，不代表本轮要重做已合并修复。

## 本轮资料库确认的问题

入口：`apps/web/app/(main)/library/page.tsx`，五视图 all / reading / memos / files / collections。

1. **文件/集合页顶部搜索框不生效**：Page 没把 search 传给 FilesView / CollectionsView。集合详情另有内部搜索框，体验重复。
2. **五视图 tab 键盘语义不全**：缺单一 tab stop、左右/Home/End、tab 与 panel 关联。手机已有横向滚动 CSS 和 44px 规则，复用即可。
3. **资料库缺账号边界**：页面和统一输入框可能保留旧账号状态。应参考上轮 Hub 的 subscribe-first、getSession 竞态守卫、按 userId keyed remount；同账号事件保持输入和搜索。
4. **统一输入保存失败仍清稿**：`components/library/unified-capture.tsx` 的批量 URL 提交结束总是 clear；部分失败会丢原始输入。memo 返回 queued / persisted=false 也清稿并报成功。URL/长文本未传 expectedUserId；旧 toast 动作及批量后续项在账号变化后可能继续。
5. **列表请求失败呈现成空库**：UnifiedView / FilesView / CollectionList 首屏失败最终类似“没有内容”，缺明确错误和重试。
6. **异步结果竞争待处理**：UnifiedView 在 await json 后缺请求版本复检，参数防抖等待期间旧请求仍可写入；Collections items 也缺请求序号保护。FilesView 轮询重置分页等是额外观察，本轮不要无边界扩大。

这些主要是代码审计结论；当前只用浏览器打开了正式资料库，没有宣称完成上述问题的浏览器复现/修复验收。

## 已收拢候选补丁（全部未应用）

`artifacts/organize-library-luna-tabs.patch`：只修改 library/page.tsx；roving tabIndex、左右/Home/End、type button、ARIA、手机44/桌面32。已通过 `git apply --check`，没有功能测试。**集成时调整**：补丁每个 view 分别包 panel，inactive panel 不存在。推荐一个始终挂载的 `id="library-panel" role="tabpanel" aria-labelledby={当前tabID}` 容器包住条件内容，全部 tab 的 aria-controls 指向它；保持 Capture/FileImport 在外。

`artifacts/organize-library-luna-search.patch`：只修改 `components/library/files-view.tsx` 和 `components/collections/collections-view.tsx`。文件用现有 filterByPageSearch 按已加载文件名过滤；集合列表按已加载名称过滤；集合详情接入顶部 search，300ms 防抖走现有服务端 q，删除内部重复搜索框。已通过 `git apply --check`，没有功能测试。

**Page 尚需手工连线**：`FilesView search={search}`、`CollectionsView search={search}`；placeholder 分别明确“搜索已加载文件（文件名）”“搜索已加载集合（名称）”，集合详情“搜索集合内容”。文件接口仅 cursor/limit，没服务端 q，当前每页50；集合列表最多500。因此不要把客户端过滤称作全库搜索，保留加载更多入口。

Sol 的审计与在制补丁另见 artifacts 中实际收拢的文件和 `SOL-STATUS.md`。没有最终 patch 就按未完成处理，不直接运行 build.py 或将半成品当最终实现。Sol 原计划只输出 /tmp，不修改共享 checkout。

## Sol 原定最小实现

- 新增 LibraryAccountBoundary，整个五视图/搜索/导入队列/输入框随身份重建；复用 Hub 守卫方式，不抽象全站 Auth。
- UnifiedCapture 自身 auth + generation + 同步 pending ref；逐 URL 和长文本传 expectedUserId；账号改变/卸载停止剩余批量和旧 toast 动作。
- 只有所有 URL 均 saved/link-only/duplicate 才清当前同一原稿；部分失败保留完整原稿，重试依赖 collectReadingItem 去重。queued persisted=false 保留输入，不回调成功。
- 稍后读收集必须继续走 `lib/reading/collect.ts` 的 collectReadingItem，不能直接写 reading_items。
- 针对身份变化、慢请求、部分失败、持久化失败增加有意义的回归测试。新增错误态/重试由接手者按预算决定；未做则明确登记后续项。

## 接手实施与验证顺序

1. 查额度、git status、现有 agent 状态，读本交接与 artifacts；比较当前 HEAD 与交接 HEAD。当前尚无产品 diff，可先基于此版本写会失败的关键回归。
2. 审查并整合 Luna 两补丁，完成 Page props、搜索范围文案和稳定 panel。审查 Sol 产物后继续账号/保存修复；不要覆盖双方对 Page 的改动。
3. 浏览器回归：tab 左右/Home/End、query 参数保持；文件导入两个不同文件后搜索/空结果/清除；集合列表及详情顶部搜索；手机320/390无页面横向溢出、触控44px；失败保稿、换号隔离做组件集成测试。搜索测“下载原件”链接数量更可靠，文件导入结果区也有“打开条目”。
4. `apps/web` 下 `corepack pnpm exec tsc --noEmit`、`corepack pnpm lint`、`corepack pnpm test`；确认必要回归后做隔离 mock build。补丁没有跑过这些，不能复用上轮1690结果当作本轮通过。
5. 跑相关 e2e：现有 library-unified、library-collections、library-import，以及新的 interactions、UI/axe 相关用例。必要时让 Astra 审查账号/异步边界。保存 mock 前后截图和实际命令结果到本轮资料库检查报告。
6. 更新工作板与检查报告，push 当前分支开 PR，attach_artifact，等待所有必需 CI 通过后 squash 合并/清理/同步 master。到此才报告已完成。

## 本地运行环境与保留现场

- 用户原始开发服务3000、静态提案3200不要结束或覆盖。
- 我们自己的隔离 mock 生产服务3100，exec session `82895`。产物仍是交接 HEAD，不含任何候选 patch。进程是否仍活着接手时核实。
- 隔离目录：`/var/folders/7f/l7mqmrx13yb1c9d16px7bs7c0000gn/T/organize-codex-ui-mziod3fu`，指针 `/tmp/organize-codex-ui-current`。root package.json / pnpm-workspace.yaml 已复制，web node_modules 指向真实安装；未复制 .env*。
- 同步 web 源码时排除 node_modules、.next、.env*、*.tsbuildinfo、test-results、playwright-report。在 temp/apps/web 用 `NEXT_PUBLIC_MOCK_BACKEND=true ORGANIZE_E2E=true NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=ui-adoption-placeholder corepack pnpm build`，再 `corepack pnpm exec next start -p 3100`（保留相同环境）。不要修改真实 .env 或构建覆盖用户开发 .next。
- Playwright 配置 baseURL3100，可复用服务器。mock 的真实 AI/外部上传/原生真机能力不代表已经验证。
- Chrome 浏览器 id3，自用 tab `711190242` 当前3100/library；无关 Apple tab `711189932` 不碰。IAB tab1 是3200/#home提案。
- 继续 CUA 时先 `await cua.rewriteDocumentation()` 再按返回 API 读取状态；旧变量 libraryBrowser/libraryTab 可能还在，但以实际为准。没有设置本轮 viewport override。原生 Codex 截图权限曾被拒绝，不绕过。
- 原用户分支 feat/ui-ux-polish 仍保留，无关旧 stash `794d59...` 未触碰；不要清理用户分支/stash。

## 交接完成标准

重要 /tmp 成果已复制到本目录；每项实际状态如实记录；最终回复链接 HANDOFF.md 和 PROMPT.md。没有启动另一个任务或自动转交执行。用户会选择接手 Agent。
