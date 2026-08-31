# Organize 可执行路线图

> 基线：2026-08-31，`master` = `fad9f3e`（PR #196），迁移到 `064`。
> 这不是“一次性做完”的需求清单。执行 Agent 每次只领取一张任务卡，只开一个分支、一个 PR；前一张卡合并后，回到最新 `master` 重新核对基线，再领取下一张。

## 排序原则

路线图按以下顺序裁决冲突：

1. 越权与密钥安全
2. 数据可恢复、数据不丢失
3. 核心链路结果正确
4. 可测试、可监控、可回滚
5. 新功能与多端扩张

“没有外部依赖”不是优先开发的理由。未通过前一阶段门禁，不得提前做后续阶段；发现新的 Critical/High 安全问题时，立即插入 P0。

## 执行 Agent 规约

- 开工固定执行：`git checkout master && git pull origin master && git checkout -b <type>/<短描述>`；禁止直接 push 到 `master`。
- 包管理命令统一使用 `corepack pnpm`，确保遵循根目录锁定的 pnpm 9.10.0；不要使用机器上可能存在的其他全局 pnpm 版本。
- 先读 `AGENTS.md`、本文件、`PROGRESS.md`、`BLOCKED.md`。把当前任务、顺序、最大风险用不超过 10 行写入 `PROGRESS.md`。
- 一张任务卡只允许一个 PR。不得顺手做下一张卡、跨阶段重构或同时维护多条特性分支。
- 每个持久化字段或新表必须同步检查：真实 Supabase、RLS + GRANT、mock、备份/恢复、软删除、共享可见性与测试。
- 新增或修改鉴权/RLS/RPC 必须有双用户越权 pgTAP：自己的资源成功，别人的资源读写失败。
- UI 新增 `/api/*` fetch 能力时必须决定是否补 `lib/mock/api-shim.ts`；不支持时必须返回明确错误，不能假成功。
- 禁止通过 `.skip`/`.todo`、删测试、放宽断言、mock 被测对象、`|| true` 或降低门槛制造绿灯。
- 每个 PR 至少跑：`cd apps/web && npx tsc --noEmit && npx vitest run && npx next build`。涉及迁移时再跑 `supabase test db`；本机无 CLI 时以 PR CI 的 pgTAP 结果为准。
- 当前基线是 120 个 Vitest 文件、875 条用例；pgTAP 为 18 个文件 / 335 条断言（PR #196 CI 实测）+ 本卡 065 新增 94 条 = 预期 19 个文件 / 429 条，以 PR CI 全新库运行为准。合并后数量不得无解释下降，跳过数必须为 0。
- 同一验收连续失败 3 次就停止该方向，把证据写入 `BLOCKED.md`；结果比开工基线差则回滚该尝试并如实报告。

## 当前状态

| 阶段 | 任务 | 状态 | 规模 | 依赖 |
|---|---|---:|---:|---|
| 已完成 | F0-01 速记 M1 | ✅ | — | — |
| 已完成 | F0-02 编辑器嵌入块基础能力 | ✅ | — | — |
| P0 | P0-01 生产依赖安全升级 | ✅ 完成（2026-08-29） | M | — |
| P0 | P0-02 数据库越权热修 | ✅ 完成（2026-08-29） | M | P0-01 |
| P0 | P0-03 AI 地址与密钥安全 | ✅ 完成（2026-08-29） | M | P0-02 |
| P0 | P0-04 备份恢复合同重建 | ✅ 完成（2026-08-29） | L | P0-03 |
| P1 | P1-01 统一稍后读收集链路 | ✅ 完成（2026-08-29） | M | P0 门禁 |
| P1 | P1-02 修正工作台与经验复习 | ✅ 完成（2026-08-29） | M | P0 门禁 |
| P1 | P1-03 任务离线冲突与失败可见 | ✅ 完成（2026-08-29） | L | P0 门禁 |
| P1 | P1-04 速记生命周期补齐 | ✅ 完成（2026-08-29） | S | P0-04 |
| P2 | P2-01 严格 CI 与核心 E2E | ✅ 完成（2026-08-29） | L | P1 门禁 |
| P2 | P2-02 Web 上线前能力 | ✅ 完成（2026-08-30） | L | P2-01 |
| P2 | P2-03 生产部署与恢复演练 | 阻塞：需云账号 | M | P2-02 |
| P3 | P3-01 Web/PWA 提醒闭环 | 待办 | M | P2-03 |
| P3 | P3-02 速记与嵌入增强 | 候选 | M | P2-03 |
| P4 | P4-01 原生端架构决策 | 待办 | S | P2-03 |
| P4 | P4-02 Android 可分发版 | 待办 | L | P4-01 |
| P4 | P4-03 iOS 可分发版 | 阻塞：需开发者账号 | L | P4-02 |
| P5 | P5-01 协作权限模型验证 | ✅ 完成（2026-08-31：ADR 0002 + 063 三表 workspace/membership/resource_acl + `resource_role()` 唯一判定链 + 三身份 85 断言 pgTAP，业务表 RLS 未动） | M | P2-03 |
| P5 | P5-02 邀请共享与编辑 | 🟡 进行中（卡 1/2 已交付：063 原型 + 064 只读可见性接入；卡 3 = 本 PR 065 保存 RPC 分权；卡 4 前端待做） | L | P5-01 |
| P5 | P5-03 实时协同技术验证 | 候选 | L | P5-02 |

---

## P0：安全与数据可信

### P0-01 生产依赖安全升级 ✅（2026-08-29 完成：next/eslint-config-next 15.5.21 + overrides 清零 Critical/High，CI 审计门禁上线，详见 PROGRESS.md）

**目标**：消除生产依赖中的 Critical/High 漏洞，并让以后出现同等级漏洞时 CI 自动失败。

**现状**：使用仓库锁定的 pnpm 9.10.0 执行 `corepack pnpm audit --prod`，返回 50 个漏洞（1 Critical、15 High、28 Moderate、6 Low）；直接依赖包括 Next `14.2.11`、Mermaid `11.16.0`、Readability `0.5.0`。Next 应升级到仍兼容 React 18 且覆盖当前公告的安全版本，当前最低候选为 `15.5.21`，实施时以审计结果为准。

**主要范围**：根目录与 `apps/web` 的 `package.json`、`pnpm-lock.yaml`、必要的 Next 兼容改动、`.github/workflows/ci.yml`、Node 版本声明和对应文档。

**验收**：

- `corepack pnpm audit --prod --audit-level high` 退出码为 0；剩余 Moderate/Low 逐条说明是否可达及后续安排。
- CI 增加生产依赖审计；保留一次升级前失败、升级后通过的红→绿证据。
- TypeScript、Vitest、Next build 全绿，测试数量不下降。
- 不在本任务升级 React、TipTap 或改业务功能，除非 Next 兼容所必需并有回归测试。

### P0-02 数据库越权热修 ✅（2026-08-29 完成：prune 属主校验 + EXECUTE 分层授权 + 七处父子同租户复合外键 + 双用户 pgTAP，详见 PROGRESS.md）

**目标**：已认证用户不能调用 RPC 或伪造父子关系影响、读取其他用户资源。

**范围**：新增顺序迁移与 `supabase/tests/`；优先修复 `prune_note_versions` 的属主校验和 `PUBLIC EXECUTE`，再审计全部 `SECURITY DEFINER` 的 owner 校验、`search_path`、revoke/grant；覆盖 `task_reminders`、`task_attachments`、`task_item_refs` 等父子关系同租户约束。

**验收**：

- 双用户 pgTAP 证明：用户 A 可操作自己的资源，无法向用户 B 的父资源挂子记录，也无法裁剪 B 的版本。
- 每个客户端可调用 RPC 都显式 revoke `public` 并只 grant 所需角色；服务端专用 RPC 只授权 `service_role`。
- `supabase test db` 与现有 96 条断言全绿，无表级 GRANT 回归。

### P0-03 AI 地址与密钥安全 ✅（2026-08-29 完成：safeAIRequest 逐跳校验+地址钉扎、密钥服务端托管掩码展示、057 收回客户端表权限，16 用例 SSRF 覆盖，详见 PROGRESS.md）

**目标**：登录用户不能利用自定义 `base_url` 访问 localhost、私网、云元数据或通过重定向绕过；浏览器不再读回完整 API 密钥。

**方案约束**：保存/读取密钥改走服务端受控接口，设置页只显示掩码；复用抓取模块成熟的协议、DNS/IP、逐跳重定向校验思路。若无法在单 PR 内安全保存密钥，先禁用用户自定义地址，只允许服务端环境变量配置，不能保留不安全回退。

**验收**：覆盖 `localhost`、IPv4/IPv6 私网、DNS 解析到私网、公开地址重定向到私网、非 HTTP(S) 协议；全部拒绝。合法 HTTPS OpenAI 兼容端点仍可用，错误信息不泄漏密钥。

### P0-04 备份恢复合同重建 ✅（2026-08-29 完成：备份升 v4 收录 memos/task_item_refs、taskId 重映射、恢复入口与包含/排除清单、双账号 pgTAP 往返，详见 PROGRESS.md）

**目标**：导出的东西能够恢复；未导出的东西必须明确声明，禁止“成功但丢数据”。

**范围**：以最新迁移为唯一字段清单，建立版本化 canonical schema/RPC；覆盖任务工作台字段、笔记层级与页面设置、同步块、数据库块、依赖、提醒、倒数日、`memos` 等。Storage 二进制若本阶段不打包，UI 与 manifest 必须明确写“不包含附件文件”，只恢复元数据不得称完整备份。

**验收**：固定双账号数据执行“导出 → 新空账号预检 → 恢复 → 逐表逐字段深比较”；层级、外键和数量一致。非空账号恢复要么明确拒绝，要么有经过测试的合并语义。设置页提供恢复入口、失败报告和包含/排除清单。

**P0 门禁**：生产依赖无 Critical/High；已知跨租户路径有反向测试；AI SSRF 被阻断；最新 schema 的备份恢复往返测试通过。未满足时不得上线或继续新增持久化功能。

---

## P1：核心产品可信度

### P1-01 统一稍后读收集链路 ✅（2026-08-29 完成：lib/reading/collect.ts 唯一入口收编五入口（QuickAddBar/命令面板/FAB/批量导入/系统分享），冻结「仅存链接降级、活跃条目按 user_id+规范化 URL 去重、软删除再存=新条目」语义，14 条新用例覆盖真实+mock，详见 PROGRESS.md）

抽出唯一的“规范化 URL → 抓取 → 保存 → 事件通知”服务，阅读库、全局 Quick Add、命令面板、批量导入和系统分享不得各写一套。先明确抓取失败策略与软删除条目再次保存的语义；去重必须限定 `user_id`，不能跨用户。验收固定抓取响应后各入口写入字段完全一致，失败不假成功，重复提交结果符合已冻结语义；真实与 mock 分支都有测试。

### P1-02 修正工作台与经验复习 ✅（2026-08-29 完成：同窗口完成率（4 计划 2 完成=50% 固定时钟）、连续天数改持久化 completed_at、移除 next_review_at 假降级与假成功写入，详见 PROGRESS.md）

完成率必须基于包含已完成项的同一时间窗口；连续天数来自持久化活动而非只读 localStorage。`lessons.next_review_at` 尚无正式 schema 时先移除”查询失败后把最近经验标成待复习”的假降级；是否引入复习算法另做产品决定。固定时钟测试覆盖 4 项计划、2 项完成 = 50%，刷新和换设备结果一致。

### P1-03 任务离线冲突与失败可见 ✅（2026-08-29 完成：059 update_task_atomic 原子协议（expected sync_version + mutation id）收编在线/离线全部任务更新路径，队列 v2 按 user 隔离，非网络失败进 per-user dead-letter 且工作台 UI 可重试/丢弃，Web Locks 跨标签页单实例回放，详见 PROGRESS.md）

在线与离线更新共用原子变更协议，携带 expected `sync_version` 与 mutation ID；队列按用户隔离，持久化失败不可静默忽略，非网络失败进入 dead-letter 并在 UI 可见。验收覆盖双设备冲突、退出后另一账号登录、跨标签页单实例回放、失败重试与人工处理。

### P1-04 速记生命周期补齐 ✅（2026-08-29 完成：060 迁移把 memos 接入 mutate_trash/list_trash（软删/恢复/永久删+双用户隔离 pgTAP），垃圾箱 UI 增速记分组，命令面板全局搜索增速记（真实+mock），备份合同 P0-04 已覆盖核对无缺口，详见 PROGRESS.md）

把 `memos` 接入已完成的备份合同、垃圾箱恢复/永久删除和全局搜索；再决定是否做全局弹窗、移动分享与每日回顾。不得先做 M2 再补数据生命周期。

**P1 门禁**：核心收集、任务、工作台、速记在刷新、离线和换设备后不产生假成功或静默丢失；相关真实/mock 测试齐全。

---

## P2：Web 发布候选

### P2-01 严格 CI 与核心 E2E ✅（2026-08-29 完成：lint 零警告门禁、CLI 钉 v2.116.0、Playwright smoke 五链路（登录/稍后读/笔记/任务/备份恢复 409 语义）入 CI、error boundary 三件套、x-request-id + 结构化错误日志、/api/health、提醒 Cron 缺配置与停摆告警化，详见 PROGRESS.md）

修复现有 lint 警告并设置零警告门禁；固定 Node 与 Supabase CLI 版本；加入 Chromium Playwright smoke，至少覆盖登录、稍后读保存、笔记保存后刷新、任务完成、备份恢复。补全 App Router error boundary、请求 ID、结构化错误记录和健康检查；提醒 Cron 缺配置或长期不运行必须告警，不能静默跳过。

### P2-02 Web 上线前能力 ✅（2026-08-30 完成：env 启动校验（生产禁 mock 拒绝启动）+ instrumentation、忘记密码/重置密码页、账号删除 API（会话校验+级联删除+UI 二次确认与隐私说明）、.env.production.example 与部署/恢复 runbook，详见 PROGRESS.md）

补忘记密码、账号删除、隐私说明和环境变量启动校验；准备 staging/production 配置、部署手册、数据库迁移/回滚步骤、备份恢复 runbook。生产环境禁止 `NEXT_PUBLIC_MOCK_BACKEND=true`，应用启动时应直接拒绝错误配置。

### P2-03 生产部署与恢复演练

用户提供 Supabase Cloud、Vercel 和域名授权后执行。先部署 staging，通过核心 E2E、双用户隔离和完整恢复演练，再切生产；上线后验证 HTTPS、认证回调、Storage、分享链接、Cron 与告警。错误监控、备份和回滚不是“上线后再补”，而是上线门禁。

---

## P3：已上线产品增强

### P3-01 Web/PWA 提醒闭环

先定义通知策略：默认“每个已订阅设备对同一提醒最多一次”，不做随机选择最佳设备。浏览器前台、本地调度和 Web Push 共用同一幂等键。Cron 的 service-role 接口不得给桌面/App 客户端轮询；客户端需要独立的、按当前用户鉴权的 due-reminder API。验收真实前台/后台/PWA 点击深链、失败重试和重复抑制。

### P3-02 速记与嵌入增强

速记候选：全局快捷弹窗、移动分享、每日回顾。编辑器嵌入块基础能力已在 PR #29 完成并在 PR #51 做过安全加固，不再重复新建；只根据真实缺口补高度调整、刷新/复制、provider 兼容和桌面浏览器面板。第三方站点能否 iframe 嵌入不可承诺“永远可用”。

---

## P4：原生端

### P4-01 原生端架构决策

先做有时限的技术验证，对比“直连线上站的薄壳”和“本地打包 Web 资源”：认证回调、离线、版本更新、深链、文件/分享、推送、商店审核与回滚。结论写成 ADR，未通过真机验证不得把倾向写成定案。

### P4-02 Android 可分发版

基于 ADR 完成登录、分享、速记、阅读、笔记、任务、本地/远程通知和返回键；增加 Android build/test CI、签名与发布 runbook，先内部测试再生成 AAB。

### P4-03 iOS 可分发版

复用已验证架构，补 APNs、Universal Links、账号删除入口、隐私清单与 TestFlight。Apple 开发者账号和证书由用户提供。

---

## P5：多人协作

### P5-01 协作权限模型验证 ✅（2026-08-31 完成：063 三表原型 + `resource_role()` 唯一判定链 + ADR 0002 + 三身份/双空间 85 断言 pgTAP，业务表未改，详见 PROGRESS.md）

禁止使用“`visible_user_ids` 让某用户的资源整体可见”的模型。先以 `workspace_id + membership + resource ACL` 建最小原型，验证 owner/editor/viewer、退出空间、移除成员、资源转移和两个互不相关 workspace 的隔离。只提交 ADR、最小迁移原型和双用户/双空间 pgTAP，不改全部业务表。

两点必须留档的裁决：

1. **与 `docs/collaboration-plan.md` 分叉 1-A 的冲突按本卡口径裁决**：`shares` 上的点对点 `share_members` 不作为权限事实源，公开链接只是表现层语法糖（064 刻意未动 `shares`，收敛时机见 ADR 0002「064 落地时追加的三条边界」）。
2. **“资源转移”在本原型只实现控制面转移**（`transfer_resource_acl` / `reclaim_resource`）。改写业务行属主 `notes.user_id` 本身就是动业务表，且会连带 056 的 `(id, user_id)` 复合外键、`task_item_refs` 同租户约束与备份合同 v4，因此归入 P5-02 逐域迁移，不在本卡范围内。

### P5-02 邀请共享与编辑 🟡（进行中：卡 1/2 已合并，卡 3 = 本 PR 065）

权限原型通过后，再逐域迁移资源归属与 RLS；第一期只做单篇笔记邀请编辑和审计字段，不做实时光标。每次只迁移一个资源域并保持单用户行为不变，备份/恢复合同同步升级。

拆成四张卡、每卡一个 PR（顺序即依赖）：

1. **卡 1 = 063**（已合并 PR #195）：workspace + membership + resource ACL 原型与 `resource_role()` 唯一判定链。
2. **卡 2 = 064**（已合并 PR #196）：三条协作者 `SELECT` 策略接入 `resource_role()`，加 `user_profiles`（只放姓名/头像）与 `find_user_by_email`。**写权一条策略都没放开**，协作者此刻只能读、且共享笔记的版本/标签/反链为空。
3. **卡 3 = 065**（本 PR）：`save_note_with_tasks_v2` 按 `resource_role()` 分 owner/editor，任务侧写入以属主为 scope（056 复合外键），并修 `save_note_version` 触发器（056 的 prune 属主校验会把协作保存炸掉）。**归属列 `last_edit_by` 不在本卡**（要同时动备份合同 v4 + mock seed + 原子保存测试，独立成卡，见待办第 2 条）；「按角色的版本/共享列表 RPC」也暂缓——协作者的历史版本本就为空、共享笔记经 064 RLS 已可直读，是否需要专门列表 RPC 由卡 4 的真实前端需求决定，不预先造。
4. **卡 4 = 前端**：分享面板（成员搜索 + 角色 + 公开链接）、`/shared` 列表页、保存管线按角色切换与冲突对话框里的协作者名字，并决定是否补 `lib/mock/api-shim.ts`（不支持必须返回明确错误，不能假成功）。

P5-01 已登记的待办（开工前先读 ADR 0002）：

- 业务表 RLS 接入协作（064）与保存 RPC 按角色分权（065）**必须复用 `public.resource_role()`**，不得重写等价判定 SQL。064 已按此落地（三条协作者 `SELECT` 策略的谓词里就是这个函数，pgTAP 有结构断言防后来者另写一份）；065 沿用同一口径（`save_note_with_tasks_v2` 的权限闸只调 `resource_role()`，pgTAP 用 `prosrc` 断言它没有另写 `resource_acl` / `workspace_members` 判定）。
- **协作者归属列需要新建**：`docs/collaboration-plan.md` 声称「038 预留了 `notes.last_edit_by` 列位」，实测为假 —— 本机 `notes` 列为 `id / user_id / title / content / reading_item_id / created_at / updated_at / is_pinned / deleted_at / icon / cover_url / cover_position / parent_note_id / full_width / font_family / small_font / content_revision / search_text`，无 `last_edit_by`，且全部迁移文本里没有这个名字。**065 按 ADR 0002 刻意未加此列**（`hasnt_column` 断言钉住）：要写「谁改了这篇笔记」必须先加列并同步升级备份合同 v4、mock seed 与相关测试，独立成卡，不能「顺便写一下」。
- 三张新表（`workspaces` / `workspace_members` / `resource_acl`）不在备份合同 v4 白名单内：恢复后授权会丢，需先定义 remap 语义（授权目标是空间，而空间本身也不在白名单），并在 manifest 的排除清单显式声明。
- 逐域迁移业务行属主（含 056 复合外键与 `task_item_refs` 的同步改法），一次一个资源域。

### P5-03 实时协同技术验证

以两浏览器断网重连、并发输入不丢字、版本历史可恢复为学习目标，对 Yjs + Supabase Realtime 与其他方案做限时验证；验证通过后才决定生产架构。任务协作继续使用乐观锁，不因笔记采用 CRDT 而强行统一。

---

## 完成定义

一张任务卡只有同时满足以下条件才可标记完成：

1. 用户结果达到该卡验收标准，且有自动化测试或可复跑证据。
2. TypeScript、Vitest、Next build、适用的 pgTAP 全绿，测试数量无未说明下降、跳过数为 0。
3. 真实后端与 mock 行为已对齐或明确声明不支持；数据字段已检查备份、删除、共享与 RLS。
4. PR 已通过 CI 并 squash merge；分支已删除；本文件状态与下一任务基线已更新。
5. `BLOCKED.md` 随交付说明“无”或列出尚未解决的问题；只说“做完了”不算完成。
