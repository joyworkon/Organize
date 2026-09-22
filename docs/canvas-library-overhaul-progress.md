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
| A 画布缺陷修复 | feat/canvas-defect-fixes | 进行中 | — |
| B1 页面/区块结构 | — | 未开始 | — |
| B2 插入/图片/属性栏 | — | 未开始 | — |
| C 资料库统一 | — | 未开始 | — |
| D 文件导入 | — | 未开始 | — |
| E 联动+回归 | — | 未开始 | — |

## 变更决策记录

（随阶段推进追加：旧行为 → 新规则 → 替代覆盖）

## 遗留与未验证

- 本机无 Docker：所有新迁移的 RLS/CAS/存储权限只能 mock + pgTAP/SQL 层面验证，真实库验证待补。
