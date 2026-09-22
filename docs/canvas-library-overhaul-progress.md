# 画布重整 + 资料库融合：进度记录

> 任务启动：2026-09-22。基线 master `9874048`。规格来源：用户任务书（画布 → 页面 → 区块三层、资料库融合、文件导入、联动）。
> 计划文件：会话计划（elektra-phantom-stranger-ravager）。恢复会话时先读本文件。

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
| B1 页面/区块结构 | feat/canvas-regions（本分支，未 push） | ✅ 完成 | tsc 通过；vitest 全量 183 文件/1410 例（lib/canvas 149 例：新增迁移 7 例、命令 21 例、布局 5 例、校验 6 例、store 1 例）；`next build --turbopack` 成功；canvas e2e 14/14（新增骨架入口、结构面板 2 例） |
| B2 插入/图片/属性栏 | — | 未开始 | — |
| C 资料库统一 | — | 未开始 | — |
| D 文件导入 | — | 未开始 | — |
| E 联动+回归 | — | 未开始 | — |

## 变更决策记录

（随阶段推进追加：旧行为 → 新规则 → 替代覆盖）

### B1（2026-09-22，feat/canvas-regions）

- **数据模型 v1→v2**：Board→Section 直挂 → Board(页面)→Region(区块)→Section(行)→Column→Block。
  Section 字段结构不变、仅语义改为「区块内的行」，代码类型名保留 `CanvasSection`（控改动面）；对外 UI 文案用「页面」「区块」。保存永远写 v2（命令的 edit() 统一钉 schemaVersion）。
- **迁移 ID 方案**：Region id 由 `r-<boardId>` 确定性派生（不用外部 id 生成器，同输入同输出、天然唯一）；name「内容」；region.style 留空。
- **padding/rowGap 继承方案（择一记录）**：`region.style.padding ?? 0`（缺省 0，不吃版面宽度——**保证 v1 迁移后渲染几何逐像素不变**，e2e A02 的 592 内容宽断言原样通过）；`region.style.rowGap ?? board.gap`（行距缺省继承版面 gap，v1 行距语义延续）。区块内列距/块距同行距（同一 gap 语义，公式不变）。
- **服务端/mock 收到 v1 的处理策略（择一记录）**：推荐方案——`validateCanvasContent` 入口先 `ensureCanvasDocV2` 自动迁移（v1→校验→返回 v2 doc），服务端 POST/PATCH 与 mock shim 以 `validation.doc` 落库，防旧客户端写入丢 Region 层级；未知更高版本原样保留、由校验拒绝保存（沿用未知块保留语义）。读取侧（repository.getCanvas、workspace 草稿恢复、mock GET）统一 ensure。
- **Enter 语义**：splitTextToSection 插行限定在当前 Region 内（原实现按 board.sections 插，改为 region.sections）。
- **appendImageSection 落点**：版面最后一个区块末尾（v1 等价行为：原 sections 全在一个区块内）。
- **模板插入**：applyCanvasTemplate 作为新区块追加到目标页面末尾；无选中页面时工作区先建 blank 骨架再插模板（两次可撤销事务）。
- **store 焦点语义修正**：焦点转移到 region/board/free（非块编辑）时同步退出块编辑态（旧实现残留 editingBlockId）；B1 顺带修复并补测。
- **e2e/单测 v1 fixture 处置**：canvas.spec 草稿 fixture **有意保留 v1**（加载路径 ensure 迁移的端到端验证，原因已注释）；backup/schema.test fixture 升 v2（备份层不校验 schemaVersion，v1 迁移链路由 migration.test.ts 覆盖）；其余单测全部机械迁移 `.sections` → `.regions[0].sections`（sed + 人工核对断言）。

## B1 变更清单（文件:符号）

- `lib/canvas/model.ts`：`CANVAS_SCHEMA_VERSION=2`、`CanvasRegion/CanvasRegionStyle`、Board.regions/name、`migrateCanvasDocV1toV2`、`ensureCanvasDocV2`、findRegion/findSection/findColumn/findBlockLocation 增加 region 层、normalizeBoardAfterDeletion 扩展到区块层、collectAllIds/countNodes 计 region。
- `lib/canvas/layout.ts`：`SceneRegion`、computeScene 区块层、regionPadding/regionGap/regionInnerWidth、computeColumnWidthsForContent/canAddColumnAt（区块内宽判定）。
- `lib/canvas/commands.ts`：全部结构命令适配 region 路径；新增 createBoardSkeleton/pickAutoPlacePosition、renameRegion/renameBoard/moveRegion/duplicateRegion/deleteRegion/updateRegionStyle、attachFreeItemToRegion、duplicateBlock/moveBlock、applyCanvasTemplate；focusBlock 统一带 regionId。
- `lib/canvas/validation.ts`：CANVAS_LIMITS 增 maxRegionsPerBoard=20/maxNameLength=100；region 校验（name/style）；入口 ensure 迁移。
- `lib/canvas/repository.ts`：getCanvas 读取 ensure；`app/api/canvases/route.ts`、`[id]/route.ts`：v1 迁移后落库；`lib/mock/api-shim.ts`：同构 + 默认 v2 + GET ensure。
- 组件：`canvas-store.ts`（selection/focus region 语义）、`canvas-board.tsx`（RegionBody/RegionNameLabel，编辑态轻量边框、预览隐藏编辑框）、`canvas-viewport.tsx`（双击走 blank 骨架、空态两入口）、`canvas-workspace.tsx`（isTypingTarget 屏蔽、工具条两入口+结构面板开关、reveal/applyTemplate 编排）、`canvas-property-bar.tsx`（页面名、移入区块对话框、块级复制/上移/下移、智能比例区块内宽）、`canvas-outline-panel.tsx`（新增：结构树+模板分组）、`use-canvas-scene.ts`（测量走区块内宽）、`lib/hooks/use-hotkey.ts`（导出 isTypingTarget）。
- 样式：`app/globals.css` 区块外框/名称/标题、结构面板、模板列表、空态入口。
- 测试：`lib/canvas/migration.test.ts`（新增）；`commands/layout/validation/canvas-store` 测试迁移 + 新增 40 例；`e2e/canvas.spec.ts` 新增 2 例、草稿 fixture 保留 v1；`e2e/visual-canvas.spec.ts` 骨架流程与 IME 计数适配；`lib/backup/schema.test.ts` fixture 升 v2。

## 遗留与未验证

- 本机无 Docker：所有新迁移的 RLS/CAS/存储权限只能 mock + pgTAP/SQL 层面验证，真实库验证待补。
- B1 无需新迁移（085 RPC 只存 jsonb）；服务端 v1→v2 落库路径仅有单测/mock 验证，真实路由同码待真实后端补验。
- 区块 style.background/border 的装饰效果、区块名标题化的预览视觉走查排入阶段 E。
