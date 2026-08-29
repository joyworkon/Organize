# PROGRESS

## P0-03 AI 地址与密钥安全（2026-08-29）

- 分支 `chore/p0-03-ai-url-key-security`（基于 P0-02 合并后的 master = e42a58d）

### 实现

1. **SSRF 安全请求层 `lib/ai/safe-request.ts`**：safeAIRequest 复用抓取模块的
   validatePublicUrl（协议白名单 http(s)/无凭据/主机名黑名单/全部解析地址须公网），
   连接钉扎在已校验地址（防 DNS 重绑定 TOCTOU），逐跳重定向重新校验（上限 8 跳），
   超时控制；AIRequestError 分类（INVALID_URL/URL_BLOCKED/DNS_FAILED/TIMEOUT/
   TOO_MANY_REDIRECTS/REQUEST_FAILED/HTTP_ERROR）
2. **密钥不出服务端**：`lib/ai/server.ts` getAIConfig/getAISettingsView——真实后端经
   service_role 读 user_ai_settings（057 已收回客户端 SELECT），展示态只回
   maskApiKey 掩码；ask/tags/notes 三个使用方路由全部经 getAIConfig → safeAIRequest
3. **受控配置接口 `/api/ai/settings`**：GET 掩码展示态；PUT 保存时即 SSRF 校验
   base_url + api_key 留空保持不变；DELETE 清除
4. **设置 UI 重写 `components/settings/ai-settings.tsx`**：读写一律走 /api/ai/settings，
   页面只见掩码，输入新密钥即更换
5. **迁移 057_lock_ai_settings**：authenticated/anon 对 user_ai_settings 全部表权限
   收回，仅 service_role（RLS policy 保留作为第二层）
6. 错误脱敏：server.ts request() 包装 + redactSecret——错误消息中回显的
   Authorization（含裸密钥）一律替换 ***（恶意端点可能在响应里回显）
7. mock：user_ai_settings 显式空表声明；settings API 的 isMockBackend 分支走
   supabase client（内存态）

### 测试（+1 文件 / +15 用例，全量 112 文件 / 818 用例）

- `lib/ai/safe-request.test.ts`：SSRF 全场景——非 HTTP(S)/localhost/IPv4 私网环回
  云元数据/IPv6 环回链路本地 ULA/带凭据 URL/DNS 解析私网/混合记录/公网放行+
  地址钉扎（断言 transport 收到的 address）/重定向到私网拒绝/公网重定向链走通/
  跳数上限/redactSecret 三态
- 本地门禁：tsc exit 0、vitest 112/818 全过、next build exit 0
- 测试修正记录：首个版本误把 HTTP_ERROR 断言放在 safeAIRequest 层——分层契约是
  safeAIRequest 返回响应对象、上层 request() 抛错并脱敏；按实现语义修正测试并
  为 redactSecret 补单测（安全语义未削弱，覆盖面增加）

# PROGRESS

## P0-02 数据库越权热修（2026-08-29）

- 分支 `chore/p0-02-db-authorization`（master = 519bead，P0-01 之后）
- 盘点：28 个迁移文件含 SECURITY DEFINER；逐函数核对 security/search_path/属主校验/调用方

### 修复内容（迁移 056_db_authorization.sql）

1. **prune_note_versions 属主校验**（核心洞）：它是 DEFINER 且 EXECUTE 默认 PUBLIC——
   任意认证（甚至匿名）用户可直接调用裁剪**他人**笔记的历史版本。修复：函数体开头
   校验 `notes.user_id = auth.uid()`，非属主抛 'Note not found or access denied'
2. **save_note_version 触发器适配**：prune 加校验后，无 JWT 的笔记写入（服务端/
   管理上下文，auth.uid() 为 NULL）会被触发器链炸掉——触发器内改为仅在用户上下文
   执行裁剪（`auth.uid() is not null`），时间分级由下一次用户编辑补做（纯维护操作，
   无正确性影响）。存量 036 测试验证：line74 的 UPDATE 触发的裁剪原本就是 no-op
   （不同小时桶），断言不受影响
3. **search_path 补齐**：save_note_version（并入 1b 重写）、update_updated_at_column、
   extract_task_items 统一 `set search_path = public`（只动盘点出的未设置函数，
   不误伤引用 extensions schema 的函数）
4. **EXECUTE 分层授权**（消除 PostgreSQL 默认 PUBLIC EXECUTE）：全 public 函数
   revoke PUBLIC + anon 后分层——cron 三函数（claim_due_task_reminder_deliveries/
   reset_task_reminder_delivery/reset_task_reminders_after_schedule_change）仅
   service_role（/api/cron 经 service_role 客户端调用，已核实应用侧唯一调用点）；
   get_public_share 与 tiptap_extract_text 另授 anon（匿名分享页/生成列求值）；
   其余 authenticated + service_role（函数内部已有属主校验或由 RLS 兜底）
5. **父子同租户复合外键**（八处）：task_reminders→tasks、task_attachments→tasks、
   task_item_refs→tasks/notes、task_dependencies→tasks(双向)、
   note_comment_threads→notes、note_comments→threads、tasks→tasks(自引用子任务)。
   外键升级为 (parent_id, user_id) → parent(id, user_id)，DB 层拒绝跨租户挂靠
  （含跨租户级联删除/置空向量——原 040 自引用 `on delete set null` 会连 user_id
   一起置空违反 NOT NULL，改用 PG15 列清单语法 `on delete set null (parent_task_id)`）。
   无 user_id 的 note_versions/task_checklists 由既有 RLS WITH CHECK(EXISTS 父) 覆盖

### 存量测试适配（断言零改动）
- 036 测试 line79 的 prune 直调：补 `set role authenticated + jwt sub`（以属主身份
  调用，语义更真实）+ 调用后 `reset role`；12 条断言与预期不变

### 新增测试
- supabase/tests/056_db_authorization.test.sql：18 断言——prune 跨用户拒绝/数量
  不变/自己可裁剪/时间分级与命名版本保留；七处复合外键 23503 + 正常路径 lives_ok；
  EXECUTE 分层 has_function_privilege ×6（anon/authenticated/service_role ×
  prune/claim/get_public_share）

### 验证方式说明
本机无 Docker/Supabase CLI，pgTAP（含新 18 断言与存量 96 断言）由 PR 的 CI
db-test job（supabase db start + test db）实跑验证；应用侧 tsc/vitest/build 本地跑。

# PROGRESS

## P0-01 生产依赖安全升级（进行中，2026-08-29 开工）

- master = `66283ea`（PR #175 已合并，与任务书基线一致），分支 `chore/security-dependencies`
- `corepack pnpm --version` → `9.10.0` ✓；`pnpm install --frozen-lockfile` exit 0（363ms，锁文件有效）
- 审计红证据：`corepack pnpm audit --prod --audit-level high` → **exit 1**，`50 vulnerabilities found — 6 low | 28 moderate | 15 high | 1 critical`（完整输出存 `/tmp/audit-before.txt`，与任务书 50=1C+15H+28M+6L 一致）
- Critical = `next@14.2.11`（Middleware 授权绕过，修复 ≥14.2.25/15.5.21）；High 还有 nanoid<3.3.18、postcss≤8.5.17（next 内置）、undici 7.28.0（cheerio 传入）
- 基线门禁：tsc exit 0；vitest **111 文件 / 803 用例** 全过；`next build` exit 0（next@14.2.11）
- 计划：next+eslint-config-next → 15.5.21（peerDeps 接受 react ^18.2.0，React 18.3.1 不动）；readability → 0.6.0；mermaid → 11.17.2；nanoid/postcss/undici 随锁文件更新，必要时 pnpm.overrides
- 关键决策：next 大版本 14→15 会触发 App Router 路由参数异步化的类型检查；仅改 build 错误点名文件并逐个附原始报错

### 升级后状态（2026-08-29）

- `corepack pnpm audit --prod --audit-level high` → **exit 0**；全量 `--prod` 审计仅剩 **1 moderate**：`uuid <11.1.1`（路径 `@tiptap/extension-unique-id@2.27.2`，TipTap 被 P0-01 禁令锚定在 2.27.2 不可升级）。**可达性评估：不可达**——已核实其 dist 仅 `import { v4 } from 'uuid'`（3 处），公告 GHSA-w5hq-g745-h8pq 只影响 v3/v5/v6 携带 buf 参数的用法；后续随 P2-01（TipTap 升级决策）一并处理
- 基线的 6 个 low 已随 postcss/nanoid/next 升级自然清零，无遗留
- 手段：直接依赖 next/eslint-config-next → 15.5.21、readability → 0.6.0、mermaid → 11.17.2、@types/node → ^22；根 `pnpm.overrides` 收敛传递依赖（postcss ≥8.5.23、nanoid ^3.3.18、sharp ≥0.35.0、undici ^7.29.0、dompurify ≥3.4.13）——override 全部按「补丁下限」收敛，避免跨大版本（曾出现 nanoid 6/undici 8 解析，已收紧）
- 兼容改动共 8 个文件、全部由错误点名（见上节）；React 18.3.1 / TipTap 2.27.2 未动
- Node：engines `>=22.12.0`、`.nvmrc`=22.12.0、CI node-version 22、README/AGENTS 同步；本机 Node v22.22.2 满足
- 待办：push 后 CI 绿 → 故意回归 next@14.2.11 造红 → 还原造绿 → squash 合并

### 升级触发的兼容错误（原始报错 + 修复）

1. **readability 0.5→0.6 类型收紧**（`npx tsc --noEmit` 点名，共 3 条）：
   - `lib/scraper/index.ts(151,26): TS2345: Argument of type 'string | null | undefined' is not assignable to parameter of type 'string'`（article.title → addXMediaToContent 第三参）
   - `lib/scraper/index.ts(156,5): TS2322: Type 'string | null | undefined' is not assignable to type 'string'`（title: article.title）
   - `lib/scraper/index.ts(157,5): TS2322: 同上`（content 透传分支）
   - 修复：与既有 `excerpt: article.excerpt || ""` 同风格补空值兜底（`?? ""` / `|| ""`），不改运行时路径
2. **next 14→15 build lint 升级**（`npx next build` 点名，2 条，`@next/next/no-html-link-for-pages` 由警告升为 Error）：
   - `./app/s/[token]/not-found.tsx — 15:11 Error: Do not use an `<a>` element to navigate to `/`. Use `<Link />` from `next/link` instead`
   - `./app/s/[token]/page.tsx — 98:11 Error: 同上`
   - 修复：两处 `<a href="/">` → `<Link href="/">`（含 import），仅此两行
3. **Next 15 路由 params 异步化**（`next build` 首报 `app/api/notes/[id]/comments/route.ts — Type error: Route ... has an invalid "GET" export: Type "{ params: { id: string; }; }" is not a valid type for the function's second argument`；随后 `.next/types` 生成后 tsc 一次点名全部 5 个文件）：
   - `app/api/notes/[id]/comments/route.ts`（GET/POST/PATCH/DELETE）
   - `app/api/notes/[id]/move-block/route.ts`（POST）
   - `app/api/notes/[id]/route.ts`（GET/PATCH/DELETE）
   - `app/api/notes/[id]/suggestions/route.ts`（GET/POST/PATCH）
   - `app/api/plugins/[id]/route.ts`（PATCH/DELETE）
   - 修复：handler 第二参 `{ params: { id: string } }` → `{ params: Promise<{ id: string }> }` + `await params`（Next 15 官方要求的异步动态段），不改任何业务逻辑；新近路由（memos/versions/tags 等）已是异步写法，无需动

## 2026-08-19 笔记+待办集中修复（PR #77–#97，共 21 个 PR 合入 master）

对照 Notion/滴答清单逐项体验 + 代码审查出 50 条问题，按"丢数据 > 名存实亡 > 体验"分三批修完：

- 第一批（丢数据类，#77–#82）：导出/分享/拷贝丢公式与附件（latex 属性名 + fileAttachment 序列化）、斜杠命令误删整段已有文字（只删触发符 range）、重复任务完成不生成下一次实例（四个完成入口接线 complete_recurring_task）、任务日期清除被 trigger 回填复活（035：显式清除全清语义）、月历拖拽范围任务整段平移（不再违反 check 约束）、到期提醒三类误报（setTimeout 24.8 天溢出/改期不再提醒/全天任务早晨误报过期）
- 第二批（名存实亡，#83–#88）：删除/恢复后侧栏幽灵节点（mutateTrash 广播变更事件）、清单改名/删除接线（原来不可达）、版本历史去重失效改为 60 秒时间节流（036）、月历跨天任务连续条形（周行布局+泳道+折叠 +N）、死按钮清理（排序/更多/任务属性/添加评论/桌面关闭按钮）、数据库块失败不再污染正文 + 加载可重试
- 第三批（体验对齐，#89–#97）：封面隐形按钮误触（pointer-events 双保险）、置顶立即重排（sortNotesLocal）、任务搜索空态、/tasks 跳转闪烁、路径栏块不刷新（meta 事务强制 NodeView 刷新）、笔记全文搜索（037：search_text 生成列 + trigram GIN，列表页+命令面板搜正文）、页内菜单补齐历史/导出/删除 + 修恢复覆盖竞态、优先级旗标+筛选+内联可改、22 处 window.prompt/alert → 全局 showPrompt 对话框/toast、待办列表拖拽排序（组内 sort_order 归一 + 乐观回滚）、触屏点按块显示手柄

migration 035/036/037 已合入并应用；pgTAP 48 条、vitest 492 条全绿。

## 目标（≤10 行）
把待办升级为可持久化三栏工作台 + 月历：侧栏(清单/今天/7天/已完成/垃圾桶) +
中栏(列表/看板/月历) + 右详情；日期组件/重复任务/提醒/附件/模板/活动。

## 已合入 master（PR #65–#73，共 9 个 PR）
- migration 033（5 新表 + tasks 8 扩列 + trigger + RLS + 备份 v3）✅
- 三栏布局 + 侧栏 + 月历视图 + scope 过滤 ✅
- 清单管理（新建/改名/删除）✅
- 日期组件（单日/时间段/全天/重复）✅
- 12 项菜单全部无占位 ✅
- 附件上传（storage + 失败补偿删对象）+ 任务动态 ✅
- URL 路由（scope/list/view query）✅
- 月历拖拽改期（保留时长/墙钟 + 回滚）✅
- 响应式 390px 手机布局（侧栏抽屉）✅
- pgTAP 30 + vitest 408 ✅

## 最终验证序列（2026-08-02 全过）
- test：48 文件 / 408 用例 / 0 FAIL
- typecheck：exit 0
- build：✓ Compiled successfully
- migration list：001-033 对齐
- db tests：30/30 PASS
- git diff --check：exit 0

## 红→绿反向验证证据（DB 层实测 2026-08-02）
1. 跨用户 RLS：用户 B 读 A 的 task_lists → count=0（红：被拒）；A 读自己 → count=1（绿：通过）。
2. 非法结束时间：schedule_end < start → check_violation 被拒（红）；合法范围 → 接受（绿）。
3. 重复任务幂等：同一 task done 后调 complete_recurring_task 两次 → 第二次返回 null（pgTAP #65 断言覆盖）。
4. 提醒 ≤3：第 4 条 insert → 23514 被拒（pgTAP 覆盖）。
5. 上传失败补偿：前端代码实现（元数据写失败→删 storage 对象），pgTAP 覆盖 task_attachments RLS。

## 触屏日期面板
触屏设备：拖拽不可用（HTML5 DnD 不支持触屏），改为点任务→打开 TaskDialog 选日期（onTaskClick 路径已实现）。
点日期→onDateClick 回调（预填新建）。这满足"触屏走日期面板"要求。

## mock 新表 seed
lib/supabase/mock-data.ts 加 task_lists（工作/学习/生活默认清单）+ task_reminders/attachments/activities/templates 空数组。

## 未完成
- 真浏览器验收（1440×900 + 390×844）+ 截图 → 执行 agent 无浏览器，需人工操作
- 本地两名临时用户验越权 → DB 层 RLS 已验证（红→绿），但未做完整双账号端到端

- mock 新表 seed → 后续

### 其他升级自带变更
- `apps/web/tsconfig.json`：`npx next build`（Next 15）自动追加 `"target": "ES2017"` 并重排版（build 日志原文：`- target was set to ES2017 (For top-level `await`. Note: Next.js only polyfills for the esmodules target.)`），未手工改动语义

### CI 红→绿回归证据（PR #176 实跑）

1. 🟢 升级后（d70a65a，run 33258965163）：verify ✅，审计步骤输出 `1 vulnerabilities found — Severity: 1 moderate`
2. 🔴 故意恢复 next@14.2.11（e00ec95，run 33259210650）：verify ❌，审计步骤输出 `32 vulnerabilities found — 4 low | 16 moderate | 11 high | 1 critical`（Paths: apps/web > next@14.2.11）+ `##[error]Process completed with exit code 1`
3. 🟢 还原后（268b89e revert，run 33259493272）：verify ✅ + db-test ✅
- db-test（pgTAP）：`Files=10, Tests=96` → `Result: PASS`（与基线 10 文件/96 断言一致，无回归）
- 门禁最终态：CI verify job 在 install 后即跑 `corepack pnpm audit --prod --audit-level high`，此后任何 PR 引入 Critical/High 直接红灯

### P0-01 交付态
- audit（--audit-level high）exit 0；全量剩 1 moderate（uuid，不可达，随 P2-01 处理）
- React 18.3.1 / TipTap 2.27.2 未动；测试 111 文件 / 803 用例（≥基线）；skip=0
- ROADMAP：P0-01 ✅、P0-02 标记为下一项

### P0-02 CI 验证（2 轮）
- 第 1 轮 db-test：迁移应用成功、存量 10 文件全过、安全控制全部真实生效
  （复合外键 23503 / RLS 42501 / 表权限 42501 均真实拒绝）——失败 9 处全是
  测试断言写法：throws_ok 第 3 参是「期望错误消息」；越权后计数需绕 RLS；
  11/12/13 实际拒绝发生在表权限/RLS 层（42501）而非外键层；plan 数错
- 第 2 轮 db-test：**Files=11, Tests=116（存量 96 + 新增 20）→ Result: PASS**；
  verify（tsc + vitest 111/803 + next build + 审计门禁）全过
- 合并：PR #177 squash → master
