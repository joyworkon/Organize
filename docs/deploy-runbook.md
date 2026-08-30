# 部署与恢复 Runbook（P2-02）

> 上线本身属 P2-03（需云账号授权）。本手册先行落地，供 P2-03 执行时逐步照做。

## 1. 首次部署（staging 先行）

1. **Supabase 云项目**：创建项目 → `supabase link` → `supabase db push` 应用全部迁移（001–060）→ `supabase test db` 在云库跑一遍 pgTAP（应 13 文件全过）。
2. **Vercel**：导入仓库，Framework=Next.js，Node 22；按 `.env.production.example` 配置环境变量（`NEXT_PUBLIC_MOCK_BACKEND` 严禁设置）。
3. **Auth 回调**：Supabase Auth URL Configuration 填 Vercel 域名；`/auth/callback` 与 `/auth/reset` 加入允许跳转。
4. **启动校验**：部署后 `GET /api/health` 应返回 `{"status":"ok"}` 且 `mock:false`；`envWarnings` 逐项处理。
5. **Cron**：配置 repo variable `TASK_REMINDER_BASE_URL` 与 secret `CRON_SECRET`；手动触发「Task reminder cron」工作流，应 HTTP 200。
6. **验收**：跑 CI 同款 Playwright smoke 需指向真实后端时改 env（见 apps/web/playwright.config.ts）；人工过一遍登录/保存/备份导出。

## 2. 数据库迁移与回滚

- **迁移**：只允许 `supabase db push`（migration 顺序执行），禁止手工在 Dashboard 改 schema。
- **回滚**：本项目迁移不提供 down。出问题时按「revert 迁移 SQL + 新迁移」原则：
  1. 先在 staging 复现问题与修复；
  2. 写新迁移 revert 变更（或恢复数据），禁止直接改历史迁移文件；
  3. pgTAP 全绿后再上生产。
- **发布前卡点**：任何迁移 PR 必须有对应 pgTAP（AGENTS.md 约定），CI db-test 绿才可合并。

## 3. 备份

- **自动**：Supabase Cloud 按套餐含每日数据库备份（Dashboard → Database → Backups），保留策略以套餐为准；升级到付费套餐后确认 PITR 开启。
- **用户级导出**：应用内「设置 → 导出数据 (JSON)」生成 v4 合同备份（28 表）。
- **恢复演练（上线前必做一次，之后每季度一次）**：
  1. staging 用测试账号造数据（条目/笔记/任务/速记各若干，含层级与双链）；
  2. 导出 JSON；
  3. 新建第二个空测试账号；
  4. 「设置 → 从备份恢复」选文件 → 预检 → 确认；
  5. 逐表核对数量与层级/链接完整性（恢复 RPC 已内置 ID 重映射与链接重建，pgTAP 058 覆盖）；
  6. 记录演练日期与结果到本文件末尾的演练日志。

## 4. 已知边界

- **附件/图片文件本体不在用户级 JSON 备份内**（仅元数据）；文件级备份依赖 Supabase Storage 层（Dashboard 手动导出或升级方案），P2-03 演练时确认套餐能力。
- **非空账户恢复被拒绝**（409）：整体替换语义，恢复前必须先清空（或新账号）。
- 生产 `NEXT_PUBLIC_MOCK_BACKEND=true` 会被启动校验拒绝（instrumentation）。

## 5. 演练日志

| 日期 | 环境 | 范围 | 结果 | 执行人 |
|---|---|---|---|---|
| （待 P2-03 执行） | staging | 全量恢复往返 | — | — |
