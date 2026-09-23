# 画布重整 + 资料库融合：进度记录

> 任务启动：2026-09-22。基线 master `9874048`。规格来源：用户任务书（画布 → 页面 → 区块三层、资料库融合、文件导入、联动）。
> 计划文件：会话计划（elektra-phantom-stranger-ravager）。恢复会话时先读本文件。

## 收口任务（2026-09-23 启动，基线 master `57a8f75`）

A–E 已合并基础上的五阶段收口：①文件导入可靠性 ②数据归属与备份恢复 ③主题集合 ④合并整理成文章 ⑤画布体验与最终回归。

### 阶段 1｜文件导入可靠性（feat/import-reliability → PR #332，已合并 master `2eb70d0`）

- **中断恢复（择一记录）**：导入无后台 worker，uploading/parsing 只可能属于一个在途 POST；
  行 `updated_at` 超过 `IMPORT_STALE_THRESHOLD_MS`（10 分钟，预算有界故余量充足）即判请求已死，
  安全规则＝标记 failed（错误明示可重试、不重复）+ 保留已传原件（storage_path 不动）+
  收口所属任务状态。回收是**惰性**的：GET（恢复列表）与 POST（同键重试）读到 stale 行时执行；
  UPDATE 带同一 cutoff 条件防误杀在途行。新增 `lib/imports/stale.ts`、`lib/imports/recovery-server.ts`
  （独立模块因 Next route 只许导出 handler）。
- **重试闭环**：`ImportFileResult` 新增 `retryKey` 并由服务端逐文件回传——客户端按它精确配对
  （删除旧的「文件名配对」，同名文件不再错配）；GET 列表也返回 retryKey。
  FilesView 失败行新增「重试」：File 句柄已随刷新丢失 → 重选文件，**先验身份**（文件名+大小都
  与原记录一致才提交）→ 复用行 retryKey 提交 → 成功后 bump refreshTick 双视图刷新。
  FileImport 网络级失败不再丢队列行，落成 failed 原位可重试。
- **并发幂等**：POST 建行撞 `unique(user_id, retry_key)`（23505）→ 读出赢家行按幂等/重跑处理
  （递归至多一层）；mock shim 在 push 前复查同键行（真实约束的 mock 对齐）。
  阅读条目仍由 URN 内容指纹去重兜底。
- **任务惰性创建**：纯重试批不再产生空任务行；POST 结束/回收后对全部被触碰任务重算状态
  （saved/partial/failed/processing，空任务 failed 且删除）；失败项修好后任务收口（partial→saved）。
  不支持格式且无行失败时也落一行失败记录（历史完整、转换格式后可在列表重试）。
- **分页**：GET /api/imports 支持 `cursor`（`imp1.` 前缀 base64url，`lib/imports/history-cursor.ts`
  纯函数，排序 created_at DESC + id DESC），响应 `{ files, nextCursor }`；FilesView「加载更多」。
- **已验证**：先红后绿——stale/cursor 纯函数 15 例、mock shim 新增 8 例（恢复/重跑/并发同键/
  重试收口/同名不错配/分页）；全量 vitest 197 文件 1568 例；tsc；mock e2e 12/12
  （含新增「一批两个同名文件不错配」）。**未验证（留阶段 2/真机）**：真实后端中断恢复
  （需杀进程制造中断）、pgTAP 双账号（阶段 2 归属约束一并做）。

### 阶段 2｜数据归属与备份恢复（feat/import-ownership-backup → PR #333）

- **迁移 091（`091_import_ownership_backup.sql`）**：
  - 归属约束（跨用户关联在 DB 层不可能）：`import_files (task_id, user_id) → import_tasks (id, user_id)`
    复合外键（cascade）；`import_files (reading_item_id, user_id) → reading_items (id, user_id)`
    复合外键 + **PG15 列级 `ON DELETE SET NULL (reading_item_id)`**（条目删除只置空引用列，
    user_id 保持）。pgTAP 证明：B 知道 A 的 task_id/条目 id 也不能建立关联。
  - 孤儿回收触发器：import_files 行删除（直接删/任务级联）→ security definer 函数经
    **官方逃生门 `set_config('storage.allow_delete_query','true', true)`**（事务局部）直删
    `storage.objects` 中 `{uid}/{taskId}/{rowId}%` 前缀资产（原件+嵌入图）；无关对象不误删。
    storage 有 protect_delete 触发器禁止直删，该设置是正解（直删会报 42501）。
  - `import_files.asset_paths text[]`（新增列）：DOCX 嵌入图上传成功即记录路径，
    成为一等资产（可打包/可回收）；此前嵌入图无行级记录，备份无从扫描。
  - `restore_backup_v2_full` 链式扩展（复制 088 主体——**含 088 的 notes.page_template
    回填步骤，从 087 复制会丢**，本轮 db-test 抓出并修复）+ import 两表落库 + counts。
- **备份格式 v7**：BACKUP_VERSION=7，收录 import_tasks/import_files；row schema 只允许终态
  status（processing/uploading/parsing 不进备份——备份时刻未完成即中断，恢复归一 failed
  可重试，不伪造成功）；v2–v6 老备份缺两表键补空、counts 缺键按 0（严格一致性校验保留）。
- **附件包扩桶**：`import-files` 私有桶入包（PACKAGE_KEY_PATTERN/manifest 校验/wire 校验
  三处白名单扩名）；扫描源 = import_files.storage_path + asset_paths（行内坐标，不参与
  URL 重映射）；恢复重放到 `{new_uid}/{uuid}.{ext}`，行内坐标经 pathMap 跟走。
- **重试孤儿清理**：POST /api/imports 重跑时旧 storage_path ≠ 新路径（如恢复后重试）
  先 remove 旧对象再 upsert 新路径。
- **已验证**：
  - pgTAP **41 文件 / 1098 例全过**（本地 Docker，含 091 新 17 例：跨用户关联负例×2、
    列级 set null、孤儿回收、恢复链 v7 双账号（B 恢复 counts 如实/A 非空拒绝/C 恢复 v6 老载荷）、
    GRANT 口径）。
  - 真实后端备份往返测试 **`lib/backup/real-backend-roundtrip.test.ts` 2/2 过**
    （仓库内可重复运行，`REAL_DB_E2E=1 npx vitest run lib/backup/real-backend-roundtrip.test.ts`，
    需本地栈）：真实 sample.pdf + sample.docx（含嵌入图）+ 画布图片——A 导出附件包 →
    B 恢复（行/坐标/条目关联/任务收口/画布 URL 重映射全对；B 能下载新原件、A 读不到 B 的、
    私有桶对象无签名公开访问失败）；**缺失资产用例**：剥掉包内 import-files 条目 →
    restore 记入 missing 明确报告，行恢复但坐标保留旧路径（下载 404 可查），不假报成功。
  - 私有性：分享链路不触碰 import-files（正文只以文字注明嵌入图，无内容引用），
    pgTAP + 往返测试双重锁定桶私有与 RLS 目录限定。
  - 全量 vitest 199 文件 1577 例（2 skip 为真实后端 gated）；tsc；mock e2e 17/17。
- **未验证**：真机大文件（接近 20MB 上限）的打包耗时；`pnpm audit` 留 CI verify。

### 阶段 3｜主题集合（feat/topic-collections → PR 待开）

> 分支说明：基于 feat/import-ownership-backup 的堆叠分支开发（PR #333 的 CI 遭遇
> ghcr.io 全局限流长时间 pending，为不空等采用堆叠；#333 合并后 rebase 到新 master
> 再开 PR，两段改动文件不相交，无冲突面）。

- **迁移 092（`092_collections.sql`）**：
  - `collections`（name ≤80）+ `collection_items`（引用行，三选一 check：
    reading_item_id / memo_id / import_file_id 恰一个非空）。
  - 同用户归属沿 091 口径：集合与三个来源全部是含 user_id 的复合外键（含
    memos/import_files 的 (id, user_id) 唯一索引）——跨用户挂载在 DB 层不可能。
  - 来源硬删 → cascade 清引用行；软删（回收站）→ 引用行保留，读取时
    available=false 显示「来源不可用」；删除集合只 cascade 引用行，来源绝不 touching。
  - 幂等：三组部分唯一索引 (collection_id, 来源id)，重复加入拒绝/ignore。
  - RPC `collection_items_query`（security invoker）：实时 join 来源标题/摘要，
    created_at DESC + id ASC 游标分页（col1. 前缀，`lib/collections/cursor.ts`）。
  - `restore_backup_v2_full` 链式扩展（复制 091 主体 + 集合两表 + counts）。
- **API（真实/mock 同合同，`lib/collections/types.ts` 共享）**：
  GET/POST /api/collections、PATCH/DELETE /api/collections/[id]、
  GET/POST/DELETE /api/collections/[id]/items（加入幂等 upsert ignoreDuplicates、
  来源不存在 400「来源不存在或不可访问」）。
- **mock**：`lib/mock/api-shim-collections.ts`（工厂注入 mockDb，软删 → available=false、
  游标分页、幂等、404/400 语义对齐）。
- **UI**：library 页新增「集合」tab（?view=collections，详情 ?collection=<id> 深链
  URL 双向同步；旧 view 参数不受影响）；LibraryCard「加入集合」；FilesView 行内
  「加入集合」；FileImport 批次成功后「本批加入集合」（整批 file 来源一次挂载）。
  自动主题建议＝确定性启发式（集合名与来源标题/memo 标签的词元重合，CJK 包含匹配），
  对话框内以「建议」芯片展示、点击确认才采用，绝不自动写入手动分类。
- **备份 v8**：collections/collection_items 进备份（引用行校验「恰好一来源且可解析」；
  导出剪枝剔除来源不在导出集的引用行；恢复重映射集合与来源坐标）；v2–v7 兼容补空。
- **已验证**：pgTAP 42 文件 / 1119 例全过（092 新 21 例：跨用户负例×4、三选一 check、
  幂等、删除语义、RPC 软删状态/分页/RLS、GRANT）；mock shim 测试 3 例 + 建议纯函数 8 例；
  真实后端往返测试扩展集合断言后 2/2 过（B 侧集合引用坐标全部落在 B 的资料上）；
  全量 vitest 201 文件 1587 例；tsc；mock e2e 集合 3/3。
- **未验证**：真实后端浏览器流（UI 全链走真实 DB）留阶段 5 统一回归。

### 阶段 4｜合并整理成文章（feat/digest-articles，堆叠分支）

> 同阶段 3 口径：基于 feat/topic-collections 的堆叠分支；#333 合并后逐级 rebase 再开 PR。

- **整理稿形态（择一记录）**：整理稿 = 独立 reading_item（URN `urn:organize:digest:{key}`）。
  选它的理由：089 统一搜索（标题/正文 ilike）与画布 sourceRef（reading 快照/引用卡片/
  「加入集合」）零成本复用；key = sha256(排序后的 来源:类型:content_hash)。
  可编辑：阅读详情页对 digest URN 项提供「编辑整理稿」（标题 + 迷你标记正文，
  `## 标题`、`- 列表`、`1. 步骤`、`| 表格 |`；双向转换 `lib/collections/digest-editable.ts`
  覆盖 MaterialResult 全部块型，编辑不丢表格；反向全部转义）。
- **溯源（迁移 093）**：`digest_sources`（digest_id 复合外键 (digest_id,user_id) →
  reading_items(id,user_id)，source_type + source_id + content_hash sha256 版本指纹）。
  来源删除 → 溯源行保留（可追溯优先）；整理稿删除 → cascade。
- **生成路由 `POST /api/collections/[id]/digest`**：
  - `preview:true` 只做预算与来源清单校验（生成前预览，不调用 AI 不写库）；
  - 预算明确拒绝不静默截断：单来源 ≤2 万字符、合计 ≤6 万字符（413 列出超限来源）；
  - 幂等：同来源集合同版本重复提交返回既有整理稿（reused:true），内容变 key 变；
  - AI 出网 chatCompletion（底层 safeAIRequest SSRF 防护）+ 错误 redactSecret 脱敏；
    限流 5 次/分钟；
  - 来源是不可信输入：逐份包 `<material>` 隔离标签 + SYSTEM 声明「只基于资料，
    不编造，矛盾保留并注来源」（沿 materials 口径），关键事实标注（来源N）；
  - 无 AI 配置 400 明确提示、mock 501 同文案；失败可重试；来源资料任何情况下不受影响。
- **备份 v9**：digest_sources 进备份（digest 必填且指向备份内 reading_item；
  source_id 按来源类型校验落在对应表；导出剪枝剔除悬空溯源行；恢复重映射
  digest_id/source_id）；v2–v8 兼容补空。
- **UI**：集合详情多选勾选 → 「生成整理稿」→ 预览对话框（来源清单/字数/预算说明）
  → 确认生成 → 打开整理稿；LibraryCard 对整理稿显示「整理稿」徽标（URN 标签复用）。
- **已验证**：pgTAP 43 文件 / 1129 例全过（093 新 10 例）；digest 服务层 10 例
  （预算/幂等键/隔离标签/HTML↔迷你标记双向 + 往返无损）；真实后端往返扩展溯源断言
  （digest/source 坐标重映射、hash 保真）2/2 过；备份单测 69 例；全量 vitest 203 文件
  1604 例；tsc；mock e2e 集合 4/4（含演示模式 501 明确报错 + 来源不受影响）。
- **未验证**：真实 AI 端到端（无外部 AI 服务；传输层由 materials 链路既有测试与
  safeAIRequest 单测覆盖）；整理稿编辑的真实浏览器全链留阶段 5。

## 基线复测（2026-09-22，master@9874048）

- `pnpm --filter @organize/web exec tsc --noEmit --incremental false`：✅ 通过（无错误输出）。
- `pnpm --filter @organize/web exec vitest run lib/canvas lib/materials lib/reading/collect.test.ts`：✅ 11 文件 / 89 用例全过。
- 全量 vitest / e2e：未在基线跑，各阶段验证时记录。
- 注意：测试输出确认 `lib/canvas/draft.ts` 有 `[canvas-dbg]` console.log 残留（阶段 A 修复项 A8）。

## 任务 0：解析器选型结论（2026-09-22，WebSearch 核实）

| 用途 | 选择 | 依据 |
|---|---|---|
| PDF 文本提取 | `pdfjs-dist` ≥ 6.2.108（Apache-2.0，Mozilla 活跃维护，2026-08 最新 6.3.x） | CVE-2026-16633（XSS）在 6.2.108 修复，必须 ≥ 此版本；Node API route 用 legacy build + 禁用 worker + `serverExternalPackages` 规避 Next.js worker 解析问题（有 Next.js 16/Turbopack 翻车先例，本仓 Next.js 15 + webpack，仍需验证）。加密 PDF 走 password 报错路径 → 提示「加密文件」。 |
| DOCX | `mammoth` ≥ 1.11.0（BSD-2-Clause，最新 1.12.x） | CVE-2025-11849（目录穿越）1.11.0 修复；使用时禁用外部文件访问（不传 convertImage 的外部读取，图片走 buffer 内联回调）。 |
| XLSX/CSV | **首选** SheetJS 官方 CDN tarball `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`（Apache-2.0）；**备选** `exceljs-hardened` ≥ 5.0.0 | npm  registry 的 `xlsx@0.18.5` 停更且有未修复漏洞（CVE-2023-30533 原型污染、CVE-2024-22363 ReDoS），禁止直接 `pnpm add xlsx`；SheetJS 修复版只发自家 CDN。exceljs 主线 4.4.0 在 2026-08 也爆出一串 CVE（78206–78209），其 hardened 分支 ≥5.0.0 才修。CI 有 `pnpm audit`，需在阶段 D 实装时复核 advisory 状态并记录。 |

运行环境：全部在 API route（Node runtime）服务端解析；浏览器端不引入解析器。预算（阶段 D 写代码+fixture 验证后定稿）：PDF ≤200 页、解压后 ≤50MB、工作表 ≤50、单元格 ≤10 万、提取输出 ≤10 万字符。

## 阶段状态

| 阶段 | 分支/PR | 状态 | 证据 |
|---|---|---|---|
| A 画布缺陷修复 | feat/canvas-defect-fixes → **PR #322 已合并**（master `e27ff22`） | ✅ 完成 | tsc 通过；vitest 全量 182 文件/1374 例；lib/canvas 86 例（新增 24 例先红后绿）；canvas e2e 7/7；CI 5 job 全绿（verify/e2e/sw-e2e/collab-e2e/db-test） |
| B1 页面/区块结构 | feat/canvas-regions → **PR #323 已合并**（master `9e3da84`） | ✅ 完成 | tsc 通过；vitest 全量 183 文件/1410 例（lib/canvas 149 例：新增迁移 7 例、命令 21 例、布局 5 例、校验 6 例、store 1 例）；`next build --turbopack` 成功；canvas e2e 14/14；CI 5 job 全绿 |
| B2 插入/图片/属性栏 | feat/canvas-insert-and-props → **PR #324 已合并**（master `5f3d4cf`） | ✅ 完成 | tsc 通过；vitest 全量 185 文件/1458 例（新增 insert-target 14 例、image-insert 12 例、B2 命令 9 例、布局 6 例、校验 7 例、store 3 例）；e2e 26/26；CI 5 job 全绿 |
| C 资料库统一 | feat/library-unified → **PR #325 已合并**（master `71f530a`） | ✅ 完成 | tsc 通过；vitest 全量 188 文件/1495 例；主 e2e 44 过；library-unified 9/9；CI 5 job 全绿（verify/e2e/sw-e2e/collab-e2e/db-test）；089 pgTAP 20 例 |
| D 文件导入 | feat/library-import → **PR #327 已合并** | ✅ 完成 | tsc 通过；vitest 全量 192 文件/1529 例（lib/imports 26 例 + mock shim 8 例 + collect-server）；主 e2e 47 过/20 跳过（真实后端）；library-import 2/2；090 pgTAP 16 例待 CI db-test |
| E 联动+回归 | feat/library-canvas-link → **PR #328** | ✅ 完成（待 CI） | tsc 通过；vitest 全量 1549 例；全量 e2e 49 过 / 20 跳过（真实后端）/ 1 flaky（library-unified 翻页 retry 后过，观察）；canvas-material 3/3；无新迁移（db-test 应直接绿） |

### CI flake 观察（2026-09-22）

- PR #324：`e2e/canvas-insert.spec.ts` 平移用例两轮失败——Linux CI 下合成中键拖拽不生效（本地 macOS 生效），改走滚轮平移路径（与触控板同路径，CI 可靠）后通过；断言未放宽（移出/带回视口语义不变）。
- `e2e/highlight-deep-link.spec.ts`「转为任务」在 PR #324 第三轮 CI 偶发一次 60s 超时（该用例在前两个 PR 与本地均稳定通过，rerun 即绿）。判定为既有 flake，记入观察清单；若再出现需专项加固（程序化选区→菜单出现的等待条件）。
- **已专项加固（2026-09-22，阶段 C）**：根因是程序化选区→高亮菜单出现无等待条件，单次不触发即挂到测试超时。改为「等正文渲染稳定 + 选区重试至多 5 次直至菜单可见」，`--repeat-each=3` 三连过。断言未放宽（菜单可见性仍是硬断言）。同文件顺手完成阶段 C 入口迁移（旧「快速添加链接」输入框已删除 → 改走统一输入框 `资料库统一输入`+回车）。

## 变更决策记录

（随阶段推进追加：旧行为 → 新规则 → 替代覆盖）

### E（2026-09-22，feat/library-canvas-link → PR #328）

- **快照语义（择一记录）**：画布对资料库内容是**引用 + 快照**，不是实时镜像。① 画布上修改卡片/摘录不回写资料库；② 资料库源更新**不自动**覆盖画布快照（用户显式点「更新快照」才刷新）；③ 源被删除时仅标题旁显示「来源不可用」角标，快照内容保留在画布。
- **新块类型 `materialCard`**：`{ type:"materialCard", title, text, sourceRef? }`，标题（15px 粗）+ 摘录（13px，上限 `MATERIAL_CARD_EXCERPT_MAX=500` 字符）+ 来源行（24px）。text/image 块也带可选 `sourceRef`（摘录与来源图片三种形态共用）。
- **sourceRef 模型**：`CanvasSourceRef{ kind:"reading"|"memo", id, title, excerpt?, url?, updatedAt? }`；新增 `lib/canvas/source-ref.ts`（`sourceRefKey`/`blockSourceRef`/`collectSourceRefs` 去重/`validateSourceRefField`），validation 白名单校验 text/image/materialCard 三处。**无新 DB 迁移**（jsonb + 校验白名单，同 B2 决策），服务端/mock 同一份 validation。
- **来源状态探测**：`use-source-status.ts` 用 RLS 可达性探测（reading_items/memos 的 id `.in()`）生成 SourceStatusMap，未探测到的 id 按 ok 处理；`SourceStatusBadge` 渲染「来源不可用」角标。渲染链 canvas-board（RegionBody→SectionBody）→canvas-viewport 三层透传 sourceStatuses。
- **图片来源解耦生命周期**：资料面板插入 reading 图片时复制上传为画布自有资产（同画布上传管线），不直接引用资料库 `/storage/` 路径——源删除/凭据变化不影响画布图片；代价是重复存储（可接受，快照语义一致）。
- **资料面板**：画布添加面板「资料」折叠组，搜索 /api/library/items（稍后读+速记统一接口）→ 预览（可选中文字提取摘录）→ 三种插入：引用卡片（materialCard）/ 插入摘录（选中文字 → text 块带 sourceRef，aria-label「插入选中的文字摘录」）/ 图片（reading，复制上传）。
- **添加到画布对话框（资料库侧）**：library-card 页脚「添加到画布」→ 选画布（含「新建画布」`__new__`）→ 选页面 → 选区块（含「追加新区块」`__new_region__`）→ patchCanvas CAS 提交；成功 toast 带「打开画布查看 →」链接。卡片链接导航用 preventDefault 隔离按钮。
- **属性栏来源区**：materialCard 可编辑标题/摘录；「来源」区提供：打开来源（memo→`/library?view=memos&memo=id`，reading 内部 URL→`/library/[id]`，外部 http(s)→新标签）、更新快照（`updateMaterialSnapshot` 按 sourceRef.kind 分 reading/memo 拉取最新标题/首段/首图原地更新）、非卡片块可「移除引用」（detachSourceRef，materialCard 为 no-op）。
- **命令**：`appendMaterialCardToRegion`（regionId 缺省=追加新区块，勿改语义）、`updateMaterialCard`、`updateMaterialSnapshot`（card/text/image 三分支）、`detachSourceRef`。
- **e2e 经验**：卡片标题在 title div 与摘录里各出现一次，断言用 `.canvas-material-card-title` 的 toHaveText 避免 strict mode；mock 数据在内存，**禁止 page.goto 整页刷新**（数据清空），用侧栏 nav 的「资料库」「构思画布」链接做 SPA 导航。
- **mock 翻页 flake 观察**：library-unified 翻页用例 retry 后过（阶段 C 起偶发，与 E 改动无关），记入观察清单。

### D（2026-09-22，feat/library-import → PR #327）

- **存储**：新增 090 迁移——私有桶 `import-files`（三条对象策略限定本人 `{uid}/` 目录）+ `import_tasks`/`import_files` 两表（RLS + GRANT authenticated、status check、`unique(user_id, retry_key)` 幂等键、`reading_item_id references reading_items on delete set null`、task 删除级联 files）。原件与解析产物分离：原件进桶，正文提取后进 reading_items（8 字段映射，`collectImportItem` 服务端收集入口，URN `urn:organize:import:{sha256}` 去重，语义与 `collectReadingItem` 对齐）。
- **幂等语义（择一记录）**：客户端每次选择生成 `retry_key`（crypto.randomUUID）；同键已有**非 failed** 记录 → 服务端直接返回既有结果（不重复建条目）；failed → 原地重跑覆盖原行（唯一约束保一条）。重试复用原 retryKey，不产生重复资料；无 File 句柄的重试（刷新后）引导重新选择，结果并入原记录。
- **解析全部在服务端**（API route Node runtime，浏览器零解析器）：PDF `pdfjs-dist`（legacy build、禁 worker、`serverExternalPackages`）、DOCX `mammoth`（convertToHtml + imgElement 单遍收集嵌入图，HTML 白名单消毒：剥全部属性、单元格内 p 解包）、XLSX SheetJS CDN tarball 0.20.3（raw:false 按缓存值展示，不并表逐 sheet 出 h2）。zip 中央目录扫描防 zip bomb（解压 ≤50MB）。
- **错误分类入合同**（`ImportError` code）：unsupported/empty/not-utf8/encrypted/corrupted/scanned（PDF 总文本 <30 字符）/too-large/too-many-pages/too-many-sheets/too-many-cells/parse-failed。逐文件隔离失败，任务末态 saved/partial/failed；不支持格式不入库存直接 failed。
- **预算**（`validateImportBatch`，服务端与客户端同一实现）：≤6 文件/批、合计 ≤20MB、文本 ≤200KB、PDF ≤200 页、解压 ≤50MB、≤50 工作表、≤10 万单元格、提取输出 ≤10 万字符。
- **mock 诚实边界（任务书 §九）**：文本路径（txt/md/csv/json）真解析（与服务端同一 extract-text 实现）真建条目，幂等/去重同语义；PDF/DOCX/XLSX 与 image/audio **明确失败不伪造**（「mock 后端不支持解析」「mock 后端不支持原件存储」）。`MockHandler.rawBody` 支持 async + multipart 透传；jsdom Blob 无 `arrayBuffer()`，shim 内 FileReader 兜底（浏览器两条路都可用）。
- **image/audio 只存原件不进正文**（真实后端）：存桶后 saved 无 reading_item_id，UI 显示「原件已存档」+ 下载链接；DOCX 嵌入图传 import-files 桶并在正文追加存档说明。DOCX 标题用文件名（mammoth 不产标题）。
- **e2e 边界**：mock 数据在浏览器内存，刷新即清空 → 刷新恢复（import_files 落库）无法 mock e2e，由 mock 单测 GET 形状覆盖，真实后端恢复待 Docker。文档级 e2e 只用文本文件（内存 buffer setInputFiles，不落盘）。
- **统一输入框文件分流**：unified-capture 改发 `organize:import-files` 事件，FileImport 面板三视图共用挂载（tabs 上方），原 MATERIAL_FILES_EVENT 已删；material-import.tsx 移除事件监听（保留显式 AI 整理入口）。
- **内部 URN 收口**：`lib/reading/source.ts` 增 `isInternalUrn`（material + import 都算内部 URN），五处 `isMaterialUrl(` 调用统一替换（material+import 共享「无外部链接」UI 分支），library-card 来源标签改读 `readingSourceLabel`。

### C（2026-09-22，feat/library-unified → PR #325）

- **不并表**：reading_items 与 memos 仍是各自内容真源；统一的是产品入口与查询接口。新增 089 `library_items` RPC（security invoker + UNION ALL），execute 仅授 authenticated（anon 显式 revoke，pgTAP 负例锁定 42501）。
- **排序与游标（择一记录）**：`created_at DESC, source_type ASC, id ASC`。同刻度时 source_type 升序 ⇒ `'memo' < 'reading'`，**memo 在前**（pgTAP 用例 4、mock shim、RPC 三处一致；首轮 pgTAP 曾把期望写成 reading 在前，与升序语义矛盾，已按实现修正用例而非改实现）。
- **统一输入框分流**（`lib/library/classify-capture.ts` 纯函数 + 测试）：单 URL→稍后读收集链路（复用 `collectReadingItem`）；多 URL（空白分隔）→逐项收集、toast 逐项结果；文字夹带 URL→完整文字存速记 + toast「另存其中链接」（不静默丢上下文）；>5000 字→文本物料（`lib/materials/text-material.ts`，不截断）；文件→阶段 D 导入流程。速记原有 #标签/IME 防误提交/草稿/离线队列/转笔记全部保留（memos-view 内联）。
- **旧入口兼容**：`/memos`（compose=1 → 聚焦统一输入；`?memo=<id>` → 速记视图高亮目标）、`/inbox`、`/library` 旧链接与 `?view=`/`?tags=` 筛选参数保留；命令面板（G M→资料库）、全局快捷键、移动导航、工作台今日视图、批量导入全部改接新入口。
- **移除** quick-add-bar.tsx；五个收集入口统一为 `collectReadingItem` 薄壳，UI 不再直插 reading_items。
- **e2e 适配与加固**：smoke/highlight-deep-link/sw-update 改走「资料库统一输入」入口；highlight-deep-link 程序化选区 flake 专项加固（等正文渲染 + 选区重试≤5 次直至菜单可见，断言未放宽）。

### B2（2026-09-22，feat/canvas-insert-and-props）

- **统一插入解析**：新增 `lib/canvas/insert-target.ts` 纯函数 `resolveInsertTarget(doc, selection, explicit?, lastActive?)`，七条优先级（explicit＋ → 选中块 → [列选中态跳过] → 选中区块 → 选中页面 → lastActiveTarget → create:"page"）。explicit 锚点失效降级走后续规则；lastActive 失效但文档有页面时退化为最后页面最后区块（仍属「最近有效」语义），完全空白才 create:"page"。所有添加入口（面板六项/三类加号/图片三入口/模板）统一走它；`planImageInsertTarget`/`appendImageSection`（A9 最小版）删除。
- **lastActiveTarget（择一记录）**：store 内存字段（不落盘），由 apply 焦点 / select / startEdit 自动维护；选中自由容器不改变页面/区块记忆。
- **待重新放置方案（择一记录）**：图片在途期间占位块被删除或撤销 → 迟到的上传完成**绝不插回任何区块**；上传成功资产转「待重新放置」自由图片（落点 = 当前视口中心，属性栏既有「移入区块…」可归位）+ toast 说明；上传失败则随占位一起丢弃。依据：不自动插进其他区块（任务书硬约束）；自由图片是用户已熟悉的显式形态，归位入口现成。
- **图片统一流程**：`lib/canvas/image-insert.ts`（store 最小接口 + 可注入 upload，纯 vitest 覆盖状态机）。占位资产 = `uploadStatus:"pending"` 且 url 空且无 localKey（组件据此显示「上传中」，与 A6 待上传/失败语义共存）；多图按选择顺序同列追加（后者锚定前者）；替换 = 先上传成功再原地 setImageAsset（保留位置/ratio/fit/alt/样式，硬失败不动旧图；真实模式软失败沿用 A6 本机预览+重试语义）。
- **默认不创建自由内容**：添加面板「图片」与拖入/粘贴默认进页面区块；「自由放置」折叠区（自由文本/自由图片，标注「自由定位，不随页面排版」）是唯一自由入口。
- **目标提示**：面板顶部「添加到：{区块名}」，空白「添加到：新页面」，随 selection/lastActive/doc 变化实时更新。
- **新建带回视口**：插入/图片落点不在可视区时自动平移带入（与视口有重叠则不跳动，避免编辑可见内容时视口跳动）。
- **新块类型**：`divider`（固定线盒高，align 左/中/右控制线宽与位置）、`button`（label/href/align/variant；href 仅 http(s)——validation 白名单 + `isSafeButtonHref` 渲染双把关，编辑态点击=选中，预览/只读态才是 `<a target=_blank rel=noopener>`，非法/空渲染禁用态）、text 角色 `list`（逐行项目符号，Enter 语义同正文，角色切换沿用 updateTextRole 重置逻辑）。仅 v2 文档；未知块保留语义不变。
- **行级布局扩展**：`section.gap`（行内列/块间距覆盖，缺省继承区块行距）与 `section.verticalAlign`（stretch 缺省=v1 等高拉伸几何不变 / top / middle / bottom——非拉伸时块保持自然高按列对齐）。版面图片块 `ratio` 锁高（与 A5 自由图片同公式）；属性栏 auto 时隐藏 fit（cover 视觉等价 contain，避免「看起来没作用」）。
- **属性栏补全**：页面加内边距；区块独立分支（名称/背景/内边距/行间距/边框）；块级「所在行」组（加列/减列——减列仅空列、列宽等分/1:2/2:1/智能比例/两列自定义滑杆 coalesce 合并事务、行内间距滑杆、垂直对齐四档）；图片（比例/fit 条件显示/替换/alt）；按钮（文案/链接/对齐/主次）；分隔线（对齐）。每个属性进历史事务（滑杆 coalesce），当前值回显。
- **键盘复核**：⌘Z/⇧⌘Z 对普通输入框（页面名/属性栏/搜索）让位走原生编辑；画布块内受控 textarea 仍由画布统一接管（防与文档撤销打架）。Esc 在弹层打开时让位给弹层关闭（hasOpenDialog）。isTypingTarget 屏蔽链复核无缺口。
- **坐标收敛**：新增 `lib/canvas/coords.ts`（screenToWorld/worldToScreen/worldViewportRect/worldCenter），viewport 双击/缩放/落点与 workspace 全部改走它；画布内偏移保持「场景几何 − 容器锚点」的显式推导式，无魔数。
- **mock 测试钩子**：`uploadCanvasImage` mock 路径支持 `window.__canvasMockUploadDelayMs`（E2E 模拟在途上传；生产无行为变化）。
- **移除**：A9 的 `planImageInsertTarget`/`appendImageSection`、孤立图标工具条（canvas-toolbar）、独立开关的结构面板（折进添加面板「结构」折叠分组）。

### B1（2026-09-22，feat/canvas-regions）

- **数据模型 v1→v2**：Board→Section 直挂 → Board(页面)→Region(区块)→Section(行)→Column→Block。
  Section 字段结构不变、仅语义改为「区块内的行」，代码类型名保留 `CanvasSection`（控改动面）；对外 UI 文案用「页面」「区块」。保存永远写 v2（命令的 edit() 统一钉 schemaVersion）。
- **迁移 ID 方案**：Region id 由 `r-<boardId>` 确定性派生（不用外部 id 生成器，同输入同输出、天然唯一）；name「内容」；region.style 留空。
- **padding/rowGap 继承方案（择一记录）**：`region.style.padding ?? 0`（缺省 0，不吃版面宽度——**保证 v1 迁移后渲染几何逐像素不变**，e2e A02 的 592 内容宽断言原样通过）；`region.style.rowGap ?? board.gap`（行距缺省继承版面 gap，v1 行距语义延续）。区块内列距/块距同行距（同一 gap 语义，公式不变）。
- **服务端/mock 收到 v1 的处理策略（择一记录）**：推荐方案——`validateCanvasContent` 入口先 `ensureCanvasDocV2` 自动迁移（v1→校验→返回 v2 doc），服务端 POST/PATCH 与 mock shim 以 `validation.doc` 落库，防旧客户端写入丢 Region 层级；未知更高版本原样保留、由校验拒绝保存（沿用未知块保留语义）。读取侧（repository.getCanvas、workspace 草稿恢复、mock GET）统一 ensure。
- **Enter 语义**：splitTextToSection 插行限定在当前 Region 内（原实现按 board.sections 插，改为 region.sections）。
- **appendImageSection 落点**：版面最后一个区块末尾（v1 等价行为：原 sections 全在一个区块内）。〔B2 起该命令已删除，图片插入统一走 image-insert.ts〕
- **模板插入**：applyCanvasTemplate 作为新区块追加到目标页面末尾；无选中页面时工作区先建 blank 骨架再插模板（两次可撤销事务）。
- **store 焦点语义修正**：焦点转移到 region/board/free（非块编辑）时同步退出块编辑态（旧实现残留 editingBlockId）；B1 顺带修复并补测。
- **e2e/单测 v1 fixture 处置**：canvas.spec 草稿 fixture **有意保留 v1**（加载路径 ensure 迁移的端到端验证，原因已注释）；backup/schema.test fixture 升 v2（备份层不校验 schemaVersion，v1 迁移链路由 migration.test.ts 覆盖）；其余单测全部机械迁移 `.sections` → `.regions[0].sections`（sed + 人工核对断言）。

## E 变更清单（文件:符号）

- `lib/canvas/model.ts`：`CanvasSourceRef`/`CanvasMaterialCardBlock`/`createMaterialCardBlock`/`MATERIAL_CARD_EXCERPT_MAX`；text/image 块可选 `sourceRef`。
- `lib/canvas/source-ref.ts`（新增）：`sourceRefKey`/`blockSourceRef`/`collectSourceRefs`/`validateSourceRefField`。
- `lib/canvas/commands.ts`：`appendMaterialCardToRegion`/`updateMaterialCard`/`updateMaterialSnapshot`/`detachSourceRef`。
- `lib/canvas/validation.ts`：text/image 的 sourceRef + materialCard 白名单。
- `lib/library/material-source.ts`（新增）：`sourceRefFromLibraryItem`/`firstLine`/`excerptSnapshot`/`firstImageSrcFromHtml`/`stripHtml`/`fetchReadingSnapshot`/`fetchMemoSnapshot`/`fetchSourceSnapshot`/`fetchImageBlob`。
- `components/canvas/use-canvas-scene.ts`：measure 加 materialCard 分支；`use-source-status.ts`（新增）：RLS 可达性 → SourceStatusMap。
- 组件：`canvas-block.tsx`（`CanvasMaterialCardBlockView`/`SourceStatusBadge`）、`canvas-board.tsx`（RegionBody→SectionBody 透传 sourceStatuses）、`canvas-viewport.tsx`（prop 透传）、`canvas-material-panel.tsx`（新增：搜索/预览/三插入）、`canvas-add-panel.tsx`（`material?: ReactNode` prop →「资料」折叠组）、`canvas-workspace.tsx`（insertMaterialCard/insertMaterialExcerpt/insertMaterialImage/refreshMaterialSnapshot 四回调 + useSourceStatus + 属性栏接线）、`canvas-property-bar.tsx`（materialCard 编辑 + 「来源」区 + `isInternalSourceUrl`）。
- 资料库侧：`components/library/add-to-canvas-dialog.tsx`（新增：画布→页面→区块三级选择 + patchCanvas CAS）、`library-card.tsx`（页脚 `AddToCanvasButton`，preventDefault 防链接导航）。
- 样式：`app/globals.css` 加 `.canvas-material-*`/`.canvas-material-card-*`/`.canvas-source-missing-*`/`.canvas-prop-textarea/note` 等。
- 测试：`lib/canvas/source-ref.test.ts`（新增）、`lib/canvas/material-snapshot.test.ts`（新增）、`lib/library/material-source.test.ts`（新增）、`e2e/canvas-material.spec.ts`（新增 3 例：搜索插入卡片/摘录/属性栏来源区）。

## B2 变更清单（文件:符号）

- `lib/canvas/insert-target.ts`（新增）：`resolveInsertTarget`/`describeInsertTarget`/`InsertTarget`/`ExplicitInsertPosition`/`LastActiveTarget`——七条优先级统一插入解析。
- `lib/canvas/image-insert.ts`（新增）：`startImageInsert`（占位→上传→原地成功/失败；锚点消失转「待重新放置」自由图片；多图顺序追加）、`replaceImage`（保留块设置）、`isUploadingAsset`、`ImageInsertStore` 最小接口（upload 可注入）。
- `lib/canvas/coords.ts`（新增）：screenToWorld/worldToScreen/worldViewportRect/worldCenter——viewport↔world 唯一换算入口。
- `lib/canvas/model.ts`：`CanvasTextRole` 增 `list`；`CanvasDividerBlock`/`CanvasButtonBlock`/`CanvasButtonVariant`/`DIVIDER_CONTENT_HEIGHT`/`BUTTON_DEFAULT_LABEL`；`CanvasImageBlock.alt`；`CanvasSection.gap`/`verticalAlign`/`CanvasSectionVerticalAlign`；`createDividerBlock`/`createButtonBlock`；`isSafeButtonHref`。
- `lib/canvas/layout.ts`：`blockContentNaturalHeight`（divider/button/版面图片 ratio 锁高）；layoutSection 支持行级 gap 与 verticalAlign（stretch 缺省几何不变）。
- `lib/canvas/commands.ts`：新增 `insertBlockAtTarget`/`insertRegionAfter`/`removeColumn`/`updateSectionLayout`/`setColumnWeights`/`updateButtonBlock`/`updateImageBlock`/`updateBoardPadding`；删除 `appendImageSection`/`planImageInsertTarget`（A9 由统一流程取代）。
- `lib/canvas/validation.ts`：divider/button/list 白名单与字段校验（button.href 仅 http(s)）；image.alt；section.gap/verticalAlign；未知块保留语义不变。
- `lib/canvas/assets.ts`：mock 路径 `__canvasMockUploadDelayMs` E2E 钩子。
- 组件：`canvas-add-panel.tsx`（新增：添加/页面/自由放置/模板/结构分组 + 目标提示）、`canvas-outline-panel.tsx`（拆出 `CanvasOutlineTree`/`CanvasTemplateList` 复用）、`canvas-workspace.tsx`（统一解析编排、图片三入口、拖放/粘贴、lastActive 订阅、revealIfNeeded、undo typing 屏蔽、Esc 弹层让位、双文件选择器）、`canvas-board.tsx`（divider/button 渲染、区块间隙「＋」与预览、行级 gap 透传、onReplaceImage 透传）、`canvas-block.tsx`（list 渲染、CanvasDividerBlockView/CanvasButtonBlockView、上传中视觉、alt、替换入口）、`canvas-viewport.tsx`（coords 接入、拖放/粘贴/指针世界坐标、onReplaceImage 透传）、`canvas-property-bar.tsx`（页面内边距、区块分支、所在行组、图片比例/fit/替换/alt、按钮/分隔线属性）、`use-canvas-scene.ts`（按钮测量）、`canvas-hit-test.ts`（新增：指针命中列/区块）。
- 样式：`app/globals.css` 添加面板、列表符号、分隔线/行动按钮块、上传中占位、区块间隙热区与预览、prop 副标题/禁用态。
- 测试：`lib/canvas/insert-target.test.ts`（14 例）、`lib/canvas/image-insert.test.ts`（12 例）、`commands.test.ts`（B2 命令 9 例，A9 两例移除）、`layout.test.ts`（+6）、`validation.test.ts`（+7）、`canvas-store.test.ts`（+3 lastActiveTarget）；`e2e/canvas-insert.spec.ts`（新增 12 例）；`e2e/canvas.spec.ts` 结构面板用例适配面板折叠分组；`e2e/visual-canvas.spec.ts` 双击落点避开添加面板/属性栏（骨架截图用例视口加宽至 1440）。

## B1 变更清单（文件:符号）
- `lib/canvas/model.ts`：`CANVAS_SCHEMA_VERSION=2`、`CanvasRegion/CanvasRegionStyle`、Board.regions/name、`migrateCanvasDocV1toV2`、`ensureCanvasDocV2`、findRegion/findSection/findColumn/findBlockLocation 增加 region 层、normalizeBoardAfterDeletion 扩展到区块层、collectAllIds/countNodes 计 region。
- `lib/canvas/layout.ts`：`SceneRegion`、computeScene 区块层、regionPadding/regionGap/regionInnerWidth、computeColumnWidthsForContent/canAddColumnAt（区块内宽判定）。
- `lib/canvas/commands.ts`：全部结构命令适配 region 路径；新增 createBoardSkeleton/pickAutoPlacePosition、renameRegion/renameBoard/moveRegion/duplicateRegion/deleteRegion/updateRegionStyle、attachFreeItemToRegion、duplicateBlock/moveBlock、applyCanvasTemplate；focusBlock 统一带 regionId。
- `lib/canvas/validation.ts`：CANVAS_LIMITS 增 maxRegionsPerBoard=20/maxNameLength=100；region 校验（name/style）；入口 ensure 迁移。
- `lib/canvas/repository.ts`：getCanvas 读取 ensure；`app/api/canvases/route.ts`、`[id]/route.ts`：v1 迁移后落库；`lib/mock/api-shim.ts`：同构 + 默认 v2 + GET ensure。
- 组件：`canvas-store.ts`（selection/focus region 语义）、`canvas-board.tsx`（RegionBody/RegionNameLabel，编辑态轻量边框、预览隐藏编辑框）、`canvas-viewport.tsx`（双击走 blank 骨架、空态两入口）、`canvas-workspace.tsx`（isTypingTarget 屏蔽、工具条两入口+结构面板开关、reveal/applyTemplate 编排）、`canvas-property-bar.tsx`（页面名、移入区块对话框、块级复制/上移/下移、智能比例区块内宽）、`canvas-outline-panel.tsx`（新增：结构树+模板分组）、`use-canvas-scene.ts`（测量走区块内宽）、`lib/hooks/use-hotkey.ts`（导出 isTypingTarget）。
- 样式：`app/globals.css` 区块外框/名称/标题、结构面板、模板列表、空态入口。
- 测试：`lib/canvas/migration.test.ts`（新增）；`commands/layout/validation/canvas-store` 测试迁移 + 新增 40 例；`e2e/canvas.spec.ts` 新增 2 例、草稿 fixture 保留 v1；`e2e/visual-canvas.spec.ts` 骨架流程与 IME 计数适配；`lib/backup/schema.test.ts` fixture 升 v2。

## 真实后端验证（2026-09-22，Docker 本地栈）

用户拉起 Docker 后完成全量真实后端验证，全部通过：

- **pgTAP**：40 文件 / 1081 例全过（含 089 library RPC、090 import_files）。
- **门禁 e2e**（`playwright.collab.config.ts`，COLLAB_E2E=1 + REAL_DB_E2E=1）：**14/14 全过**——双账号协作 1、撤权/降级 3、同步块 7、反链 v2 1、匿名协作 2。
- **D 导入真实链路**（真实 PDF/文本/加密/扫描四件 + 刷新 + 下载）：真实 PDF 真解析入稍后读 ✅、文本导入 ✅、加密 PDF 分类报错 ✅、扫描型 PDF 提示 OCR ✅、**刷新恢复**（import_files 落库，FilesView 持久列表整页刷新后仍在）✅、**原件下载**（/api/imports/file 鉴权路由返回 %PDF 原件）✅。
- **E 联动真实链路**：图片存储凭据（/api/upload → 公开 URL 匿名回读 200）✅、资料面板搜索 → 引用卡片 ✅、插入摘录（text 块 + sourceRef）✅、**资料图片插入复制上传为画布自有资产**（新 /storage 对象，源图 URL 不同，匿名回读 200）✅、属性栏来源区 + 更新快照（真实拉取）✅、**源删除 → 来源不可用角标**（产品删除路径 mutate_trash RPC 软删 → RLS 不可见 → 角标出现）✅。
- 验证脚本：`apps/web/.tmp-e2e/real-backend-verify.mjs`（gitignored，一次性，18 项断言）；PDF 固件经 reportlab/pypdf 生成（真实文本/加密/纯图扫描三类）。

## 遗留与未验证

- ~~E 待办：来源状态探测与「更新快照」真实后端待验~~ ✅ 已验（2026-09-22，见上节）。
- ~~D 待办：090 真实库验证（刷新恢复、原件下载、加密/扫描 PDF 真实路径）~~ ✅ 已验（2026-09-22，见上节）。
- E：图片插入 reading 图片来源为复制上传（画布自有资产），源删除不影响画布图片；重复存储为已知取舍。
- E：library-unified 翻页用例偶发 flake（retry 后过，阶段 C 起存在），再出现需专项加固。
- D：`pnpm audit` 复核留在 CI verify（pdfjs-dist ≥6.2.108 修 CVE-2026-16633；mammoth ≥1.11.0 修 CVE-2025-11849；SheetJS 走 CDN tarball 0.20.3 避开 npm 停更的 0.18.5）。
- B2 无新迁移（新块类型/行级字段全部在既有 jsonb content 内，validation 白名单同步即可）；服务端/mock 校验同一份 validation，契约不变。
- 行/列的独立选中态未做（规格允许跳过该档）：「所在行」属性经由选中块 contextual 呈现。
- 「减列」仅允许删除空列（非空列按钮禁用并提示），避免静默丢块；如需并块语义后续单独立项。
- B2 生效范围仅桌面编辑态：手机只读隐藏添加面板与加号（既有 interactive 门控）。

- ~~本机无 Docker~~（2026-09-22 起本机有 Docker，D/E/089/090 真实链路已验，见上节）；B1 的 v1→v2 服务端迁移落库路径仍仅单测/mock 验证（旧 v1 客户端写入场景，低优先级）。
- B1 无需新迁移（085 RPC 只存 jsonb）。
- 区块 style.background/border 的装饰效果、区块名标题化的预览视觉走查未做（阶段 E 开发收尾时未含视觉走查），如需打磨单独立项。
