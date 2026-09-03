# 部署与恢复 Runbook（P2-02）

> 上线本身属 P2-03（需云账号授权）。本手册先行落地，供 P2-03 执行时逐步照做。

## 1. 首次部署（staging 先行）

1. **Supabase 云项目**：创建项目 → `supabase link` → `supabase db push` 应用全部迁移（001–062）→ `supabase test db` 在云库跑一遍 pgTAP（应 16 文件 / 177 断言全过）。注意云端池（6543，transaction 模式）会让 `set role` 类测试报 "No plan found"，必须用 5432 直连（`--db-url postgresql://postgres:<db密码>@db.<ref>.supabase.co:5432/postgres`）。
2. **Vercel**：导入仓库，Framework=Next.js，Node 22；按 `.env.production.example` 配置环境变量（`NEXT_PUBLIC_MOCK_BACKEND` 严禁设置）。
   - 注意：`NEXT_PUBLIC_*` 在 edge middleware 里是**构建期内联**的，运行时改环境变量不会翻转已构建产物——必须先在平台配好 env 再触发构建。
   - Monorepo：项目设置 Root Directory=`apps/web`，Install=`pnpm install`，Build=`pnpm --filter @organize/web build`，Output=`.next`；根目录不要放 `vercel.json`（配置已烧进项目设置，两处并存会互相打架）。
   - **部署保护**：团队版默认开 Vercel Authentication（`ssoProtection`），所有请求会被 302 到 `vercel.com/sso-api`，curl / cron / 真实用户全被拦。部署后必须关掉（Dashboard → Settings → Deployment Protection，或 API PATCH `{"ssoProtection":null}`）。
   - `.vercelignore` 用 gitignore 语义：裸写目录名会匹配任意层级（曾误伤 `apps/web/lib/supabase` 导致构建找不到模块），排除根目录一律加前导斜杠。
3. **Auth 回调**：Supabase Auth URL Configuration 填 Vercel 域名；`/auth/callback` 与 `/auth/reset` 加入允许跳转。
4. **启动校验**：部署后 `GET /api/health` 应返回 `{"status":"ok"}` 且 `mock:false`；`envWarnings` 逐项处理。
   - 若返回 307 → `/login`：跑的是未把 `/api/health` 列入鉴权豁免的旧构建（豁免判定见 `middleware.ts` 的 `isAuthExemptPath`）。
   - 若返回 302 → `vercel.com/sso-api`：Vercel 部署保护（见第 2 步），与代码无关。
5. **Cron**：配置 repo variable `TASK_REMINDER_BASE_URL` 与 secret `CRON_SECRET`；手动触发「Task reminder cron」工作流，应 HTTP 200。
   - 307 = `/api/cron/` 未豁免鉴权重定向；401 = `CRON_SECRET` 两边不一致；503 = VAPID 或 service role key 未配（`/api/health` 的 `envWarnings` 不会提示 VAPID，只在此处暴露）；500 = 数据库侧领取 RPC 报错（看 Vercel function logs 的 `Reminder claim failed:`；真实案例：061 修复的 PL/pgSQL 变量歧义 42702）。
6. **验收**：真实后端下按人工清单过一遍——注册/登录（含邮件确认与找回密码）、粘贴 URL 保存并核对抓取正文、笔记编辑后整页刷新回读、完成任务、备份导出→空账号恢复并逐表核对。
   - CI 的 Playwright smoke（`apps/web/e2e/smoke.spec.ts`）是 **mock 专属**：硬编码种子账号、断言 mock 抓取器从 URL slug 生成的标题、依赖内存库整页 reload 即重置的语义，仅改 `playwright.config.ts` 的 env 无法指向真实后端。需要自动化覆盖真实后端时，另写一个用 Supabase admin API 建测试用户的 spec。

## 2. 数据库迁移与回滚

- **迁移**：只允许 `supabase db push`（migration 顺序执行），禁止手工在 Dashboard 改 schema。
- **回滚**：本项目迁移不提供 down。出问题时按「revert 迁移 SQL + 新迁移」原则：
  1. 先在 staging 复现问题与修复；
  2. 写新迁移 revert 变更（或恢复数据），禁止直接改历史迁移文件；
  3. pgTAP 全绿后再上生产。
- **发布前卡点**：任何迁移 PR 必须有对应 pgTAP（AGENTS.md 约定），CI db-test 绿才可合并。RPC 类迁移的测试必须**带数据真实执行函数体**并断言行为，只测权限/存在性不够——039 的领取 RPC 因 PL/pgSQL 变量歧义在云库运行即 500，权限测试全绿也没挡住（061 修复）。

## 3. 备份

- **自动**：Supabase Cloud 按套餐含每日数据库备份（Dashboard → Database → Backups），保留策略以套餐为准；升级到付费套餐后确认 PITR 开启。
- **用户级导出**：应用内「设置 → 导出数据 (JSON)」生成 v4 合同备份（28 表）。
- **恢复演练（上线前必做一次，之后每季度一次）**：
  1. staging 用测试账号造数据（条目/笔记/任务/速记各若干，含层级与双链）；
  2. 导出 JSON；
  3. 新建第二个空测试账号；
  4. 「设置 → 从备份恢复」选文件 → 预检 → 确认；
  5. 逐表核对数量与层级/链接完整性（恢复 RPC 已内置 ID 重映射与链接重建，pgTAP 058/062 覆盖；062 专门覆盖笔记层级/图标/封面、同步区块与数据库块——这些在纯数量核对中不可见）；
  6. 记录演练日期与结果到本文件末尾的演练日志。

## 4. 已知边界

- **附件/图片文件本体不在用户级 JSON 备份内**（仅元数据）；文件级备份依赖 Supabase Storage 层（Dashboard 手动导出或升级方案），P2-03 演练时确认套餐能力。
- **非空账户恢复被拒绝**（409）：整体替换语义，恢复前必须先清空（或新账号）。
- 生产 `NEXT_PUBLIC_MOCK_BACKEND=true` 会被启动校验拒绝（instrumentation）。

## 5. 演练日志

| 日期 | 环境 | 范围 | 结果 | 执行人 |
|---|---|---|---|---|
| 2026-08-30 | staging | 全量恢复往返（两轮、13 类数据、含层级/图标/同步区块/数据库块） | 通过（过程中发现并修复 2 处数据缺陷：PR #188、#189） | agent |

### 上云前预检（零云依赖，2026-08-30）

本地 Docker Supabase + 生产构建，已完成：pgTAP 14 文件 / 156 断言全过；`next build` exit 0；生产环境 `NEXT_PUBLIC_MOCK_BACKEND=true` 被启动校验拒绝（fatal + 端口不绑定）；正常配置 Ready 且 `envWarnings` 精确指向缺失项。

同轮发现并已修复：`/api/health` 与 `/api/cron/*` 未列入鉴权豁免，真实后端下被 307 到 `/login`（提醒链路在生产环境完全不可用，CI 因 mock 跳过鉴权而测不到）。

仍待云环境验证：~~真实 Supabase Cloud 上的迁移与 pgTAP~~、Auth 回调与邮件送达、~~Vercel 上的 env 与探活~~、Storage 层文件备份能力（见第 4 节）。

### staging 上云（2026-08-30）

Supabase Cloud（ref `sgkviverpercklxsjbcv`）001–061 迁移全部应用，5432 直连跑 pgTAP 15 文件 / 162 断言全过。Vercel 项目 `organize-staging-web`（monorepo Root Directory=`apps/web`）：`/api/health` 返回 `{"status":"ok","mock":false,"envWarnings":[]}`；`/api/cron/task-reminders` 正确密钥 200、错误密钥 401；部署保护（ssoProtection）已关闭。

同轮发现并已修复：
- `.vercelignore` 裸写 `supabase` 误伤 `apps/web/lib/supabase`（gitignore 任意层级匹配），构建报模块缺失 → 改前导斜杠锚定根目录。
- 团队版默认开 Vercel Authentication，所有请求 302 → `vercel.com/sso-api` → API 置 `ssoProtection` 为 null。
- `claim_due_task_reminder_deliveries` 的 RETURNS TABLE OUT 参数与函数体 ON CONFLICT 列名歧义（42702），云库运行即 500 → 迁移 061 加 `#variable_conflict use_column`，并补带数据的执行型 pgTAP（tests/061）。

仍待办：~~GitHub Actions 的 `TASK_REMINDER_BASE_URL` / `CRON_SECRET` 配置与手动触发验证~~（已配平、手动触发 200）、Auth 回调与邮件、~~恢复演练（第 3 节）~~（已完成，见下）、第 6 步人工验收清单。

### 恢复演练（2026-08-30，staging）

按第 3 节流程执行：账号 A 造种子（阅读条目×2、笔记×3 含父子层级与图标、标签×2、任务×2 含子任务与笔记链接、速记×2、清单×2、note_tags/task_tags 各 1），导出 v4 JSON → 空账号 B「从备份恢复」→ 云库 5432 直连逐表核对。共两轮。

**第一轮发现两处真实数据缺陷（均已修复）：**

1. **导出被自校验拦截**（PR #188）：迁移 044 给 `reading_items` 加 `full_width` 后，`lib/backup/schema.ts` 白名单未同步，任何含阅读条目的导出都报「包含未授权字段」。补 `full_width: optional(isBoolean)`（保持旧备份可导入）。
2. **恢复静默丢数据**（PR #189）：逐表核对发现笔记父子层级断裂、图标丢失；代码审查进一步确认 `synced_blocks`、`db_databases`/`db_rows` 也被丢弃。根因：033 重写 `restore_backup_v2_with_pages` 时丢掉了 024–027 一直携带的笔记页面字段回填与 `synced_blocks` 插入；db 两表自 028 建表后从未接入恢复链。迁移 062 重定义该函数补回三处（+ counts 报告），新增 pgTAP 062（15 断言）。

**第二轮（修复后）全部通过：** A 补种子（同步区块×1、数据库块×1 挂父页、数据行×2、父页正文含两处块引用、note_versions×1），导出 13 类数据，预检与恢复成功；数据库级核对确认——各表数量齐全、子页→父页层级与图标（🗂/📊）保留、`synced_blocks`/`db_databases`/`db_rows` 以全新 ID 落库、正文内 `syncedId`/`databaseId` 已重映射且可解析、清单状态与标签关联一致、账号 A 数据不受影响。云库 pgTAP 16 文件 / 177 断言全绿。

经验：演练种子必须覆盖**自引用层级、页面元数据、正文内块引用**，否则这类丢失在数量核对中不可见；恢复链每新增一层包装函数，回归测试要断言「旧层负责写入的表仍然落库」。

## 6. Windows 桌面发布 runbook（desktop-release.yml）

> 链路：tag `desktop-v*` → `.github/workflows/desktop-release.yml`（windows-latest，
> tauri-action 出 NSIS + updater 产物）→ publish 作业分发门判定 → GitHub Release。
> 架构前提见 ADR 0004 与 multi-platform-plan §3：壳加载远程 Web，生产域名未落地前
> 产物一律 draft，不得对外分发。

### 6.1 打 tag 前置清单

1. master 上 `desktop/src-tauri/tauri.conf.json` 的 `version` 与 `desktop/package.json`
   已同步升版（updater 以 conf 版本判定新旧，两处不一致会让更新语义混乱）。
2. 该版本改动已全部合并进 master，且 CI（tsc + vitest + desktop.yml 双平台 cargo
   check）全绿。
3. 确认 `tauri.conf.json` 的 `bundle.createUpdaterArtifacts`（仓库内默认关闭，仅在
   签名密钥存在时由发布工作流经 `--config` 覆盖开启）。

### 6.2 签名密钥（updater ed25519，一次性配置）

- 公钥：已写入 `tauri.conf.json` 的 `plugins.updater.pubkey`（入库）。
- 私钥：`desktop/src-tauri/keys/tauri.key`（**gitignored，永不出库**；当前口令为空）。
  丢失 = 无法给既有安装用户发更新，请离线备份（密码管理器/加密盘）。
- 人工配置 CI secret（仓库 owner 执行一次）：

  ```bash
  gh secret set TAURI_SIGNING_PRIVATE_KEY < desktop/src-tauri/keys/tauri.key
  gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body ""
  ```

- 未配置 secret 时发布流水线**跳过签名**（只警告，构建不失败），Release 无
  latest.json，端内 updater 不可用；补配 secret 后重打 tag 即恢复。

### 6.3 发布与分发门

```bash
git checkout master && git pull origin master
git tag desktop-v0.2.0 && git push origin desktop-v0.2.0
```

publish 作业判定三个条件：repo variable `WEB_PROD_URL` 已设置、frontendDist 非
占位域名（`https://organize-web.vercel.app` 已被无关第三方占用）、两者一致。
任一不满足 → Release 为 **draft + prerelease**（带警告说明），只可内测下载；
三个条件同时满足 → 公开 Release 并挂 latest.json（updater 端点固定拉
`releases/latest/download/latest.json`，即最新公开 Release）。

### 6.4 上线前人工待办（把 Release 从 draft 翻 public 的唯一前置）

1. **生产 Web 部署 + 真实域名**（multi-platform-plan M0）：Vercel 部署 `apps/web`，
   绑定自有域名；`GET /api/health` 返回 ok。
2. 配 repo variable：`gh variable set WEB_PROD_URL --body "https://<真实域名>"`。
3. 三处同步切真实域名（缺一不可，见 ADR 0004 已知坑 2）：
   `tauri.conf.json` 的 `build.frontendDist`、`capabilities/default.json` 的
   `remote.urls`、（Auth 回调白名单）。
4. 重打 tag（如 `desktop-v0.2.1`）走一遍发布，确认 publish 门转绿、Release 公开。

### 6.5 SmartScreen / 代码签名（人工采购项）

- 当前产物**未做 Authenticode 签名**：Windows 首装会弹 SmartScreen「更多信息 →
  仍要运行」，Edge/Chrome 下载也可能标记。这是无证书分发的预期体验，需在下载页
  说明，不视为缺陷。
- 消除提示需采购 OV（或 EV）代码签名证书：OV 证书签名后 SmartScreen 仍需积累
  信誉，EV 立即通过。拿到证书后在 desktop-release.yml 的 build 作业插入签名步骤
  （`signtool sign /fd SHA256 /tr <TSA> /td SHA256`，证书私钥走
  `WINDOWS_PFX_BASE64` / `WINDOWS_PFX_PASSWORD` secret，管线预留位）。
- NSIS 安装包签名后需重跑打包让 uninstaller 同步签名（tauri windows 签名钩子
  `windows-certificate-thumbprint` 等 env 可用，届时按官方文档接）。
