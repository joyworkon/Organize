# PROGRESS

## P1 门禁核对（2026-08-29，P1-04 合并后）

门禁要求：核心收集、任务、工作台、速记在刷新、离线和换设备后不产生假成功或静默丢失；
相关真实/mock 测试齐全。逐项核对（证据见各卡 PROGRESS 段落）：

- **收集（P1-01）**：统一服务 collectReadingItem——失败 fail-closed 不假成功（单测），
  真实+mock 双分支测试（collect.test.ts / collect.mock.test.ts）
- **任务（P1-03）**：原子协议 expected sync_version+mutation id（pgTAP 059 + 单测），
  非网络失败进 dead-letter UI 可见不静默，队列按用户隔离（测试）
- **工作台（P1-02）**：完成率/连续天数纯函数基于持久化数据，固定时钟「同输入重复
  计算一致=刷新/换设备等价」测试
- **速记（P1-04）**：垃圾箱软删/恢复/永久删双用户隔离 pgTAP 060；命令面板搜索
  真实+mock 双分支
- 测试基线：118 文件 / 862 用例全绿 skip=0；pgTAP 13 文件 163 断言（CI 实跑）

**结论：P1 门禁通过，P2-01 开工。**

# PROGRESS

## P1-04 速记生命周期补齐（2026-08-29）

- 分支 `feat/p1-04-memo-lifecycle`（master = 9e8cfa2，P1-03 合并后）

### 现状核对与补齐

- **备份合同**：P0-04 已收录 memos（BACKUP_TABLES + restore RPC + pgTAP），本卡核对无缺口
- **垃圾箱**：055 迁移预留 deleted_at 但注释明示「垃圾箱体系暂不接入」——本卡补齐
- **全局搜索**：命令面板搜索五类资源无速记——本卡补齐
- 全局弹窗/移动分享/每日回顾：卡面「再决定」= 产品决策，不在本卡实现

### 实现

- **迁移 060**：mutate_trash / list_trash 替换版——资源白名单加 'memo'，
  三动作分支（软删/恢复/永久删，均按属主过滤），list_trash 追加 memo 分组
  （标题取 content 前 50 字符）；EXECUTE 分层维持 050 口径
- **contracts**：TRASH_RESOURCE_TYPES 加 "memo"；垃圾箱页 resourceConfig 加速记
  （MessageSquareText 图标）——恢复/永久删除入口自动可用
- **命令面板**：SearchResult/SearchCounts 加 "memo" 类型；真实分支 memos content
  ilike（is deleted_at null）+ count；mock 分支 mockDb.memos 过滤；分组「速记」
  渲染（标题=首行，副标题=内容预览），点击跳 /memos
- memos 页删除按钮原已走 DELETE /api/memos/[id]（软删除，mock shim 同语义）——
  与垃圾箱 RPC 语义一致，未改

### 测试（+1 pgTAP 文件 / +1 用例文件改动，全量 118 文件 / 862 用例）

- pgTAP 060（11 断言，CI 实跑）：属主软删 affected=1、list_trash memo 分组可见、
  标题取内容前缀、恢复出桶、再软删+永久删物理消失、B 软删自己的成功、A 动 B 的
  速记 affected=0 且行保持活跃
- contracts.test.ts：memo 类型被 parseTrashMutation 接受
- 门禁：tsc exit 0、vitest 118/862 全过 skip=0、next build exit 0

# PROGRESS

## P1-03 任务离线冲突与失败可见（2026-08-29）

- 分支 `feat/p1-03-task-offline-conflict`（master = 7d63eea，P1-02 合并后）

### 盘点出的四个缺口

1. 队列 storage key 全局（organize:offline:task-ops:v1 无 user 段）——退出后另一
   账号登录会读到/回放别人的操作
2. 持久化失败被 `catch {}` 静默吞掉（存储满/被禁用时假装入队成功）
3. 回放被拒操作只计数即丢弃——双设备冲突/任务被删等非网络失败用户不可见
4. 在线更新直写 `tasks.update`，与离线回放不同协议；tasks.sync_version（030）只有
   笔记 RPC 在加，形同虚设；回放无跨标签页互斥（两标签页并发回放同一队列）

### 实现

- **迁移 059**：`update_task_atomic(p_task_id, p_patch, p_expected_sync_version,
  p_mutation_id)`——校验+应用合并为单条 UPDATE（行锁内原子），22 列白名单（显式
  null 覆盖），applied/conflict/not_found/already_applied 四态；`task_mutations`
  幂等日志表（PK(user_id,mutation_id)，复合外键同租户+级联，RLS select/insert，
  GRANT authenticated/service_role，EXECUTE revoke public+anon）；migration 内
  revoke/grant 遵循 P0-02 分层约定
- **队列 v2**：key 带 userId（`organize:offline:task-ops:v2:<uid>`；v1 无法安全
  判定归属，弃用不清除，历史离线操作一次性失效）；update op 携带
  expected_sync_version（op_id 即 mutation id）；write 失败上报 persisted=false
- **回放**：writer.updateTask 走原子协议（meta 透传 op 的版本+op_id），conflict→
  TASK_SYNC_CONFLICT、not_found→TASK_NOT_FOUND 结构化错误；replayTaskOps 返回
  rejectedOps 数组（不再只计数丢弃）
- **dead-letter（per-user）**：`lib/offline/task-dead-letter.ts`——拒绝入账（同
  op_id 去重）、人工重试（expected 置 null 后重入队回放，op_id 保持幂等链）、丢弃
- **跨标签页单实例**：`lib/offline/single-instance.ts` Web Locks 封装，回放在
  `organize:task-replay:v1` 互斥区先重读队列；API 不可用退化为直接执行（已知限制）
- **共用协议接入点**：repository（updateTaskStatus/togglePin/updateTask）、任务
  工作台页（updateTask/sort 拖拽/batchComplete）、今日视图 toggle、子任务层级、
  任务详情页日期/note_id 关联——在线更新全部携带本地已知 sync_version + UUID
  mutation id；冲突→dead-letter+刷新+toast（绝不静默覆盖），网络失败→入队
- **dead-letter UI**：任务工作台头部计数（role=alert）+ 面板逐条展示失败原因，
  重试/丢弃/全部丢弃
- mock：update_task_atomic shim（同白名单/幂等/版本语义）+ task_mutations 空表
- 测试适配：task-queue.test.ts 重写（隔离/persisted/rejectedOps/meta 透传）

### 测试（+3 文件 / +18 用例，全量 118 文件 / 861 用例）

- task-queue.test.ts 重写：user 隔离、persisted 上报、meta 透传、conflict 进
  rejectedOps 继续后续、网络中止滞留（原语义保留）
- task-dead-letter.test.ts：入账/去重/隔离/移除/重试重置/写盘失败上报
- single-instance.test.ts：串行、释放、异常后可继续、无锁退化
- atomic-update.test.ts：四态解析 + 异常形状归一 error
- pgTAP 059（14 断言，CI 实跑）：属主 applied+版本递增、同 mutation 重放
  already_applied 不递增、过期版本 conflict 带当前版本、显式 null 清空、他人任务
  not_found、日志 RLS 双用户隔离、日志不可 update（42501）、EXECUTE 分层 ×3
- 门禁：tsc exit 0、vitest 118/861 全过 skip=0、next build exit 0

# PROGRESS

## P1-02 修正工作台与经验复习（2026-08-29）

- 分支 `fix/p1-02-workbench-review`（master = 5da01dd，P1-01 合并后）

### 修掉的三个问题（均在 components/dashboard/today-view.tsx）

1. **完成率恒为 0**：分母（overdue+today）先过滤掉 done 任务，再从分母里数 done
   → completedToday 恒 0。重写为同窗口口径（新纯函数 `computeTodayCompletion`）：
   窗口=今天日历日；计划 = 未取消且（今日到期 ∪ 逾期未完成）∪ 今日完成（不论
   到期日，历史完成不进今天）；完成 = 窗口内 done；rate = completed/planned。
   验收用例 4 计划 2 完成 = 50% 固定时钟固化
2. **连续天数假数据**：原实现只 `localStorage.getItem("organize-streak")`（全库无
   写入点，永远 undefined→0，且换设备即失真）。改为 `computeTaskStreak`：基于持久化
   tasks.completed_at，按本地日历日从今天（今天无完成则从昨天）回数连续活动日
3. **经验复习假降级**：lessons 无 next_review_at 列（012 schema 确认）——真实后端
   查询报错 → fallback 把最近 5 条经验伪装成「待复习」；「记住了」按钮把复习计划
   写到不存在的列（假成功）。整块移除（含 state/查询分支/handler/JSX）；是否引入
   复习算法留待产品决策（P1-02 卡面明示）

### 实现

- 新 `lib/dashboard/workbench-stats.ts`：computeTodayCompletion / computeTaskStreak
  纯函数，时钟注入；today-view 挂载 allTasks state 后即时计算，不碰 localStorage
- review-view（每日回顾）/stats-view 盘点确认已基于持久化数据，未改

### 测试（+1 文件 / +10 用例，全量 115 文件 / 843 用例）

- `lib/dashboard/workbench-stats.test.ts`：固定时钟 2026-08-29——4 计划 2 完成=50%
  （验收原案）、逾期与昨日完成窗口归属、提前完成未来任务、cancelled 排除、空窗口
  0%、同输入重复计算一致（刷新/换设备等价）、streak 连续/今天未断签/断档截断/空
- 本地门禁：tsc exit 0、vitest 115/843 全过 skip=0、next build exit 0

# PROGRESS

## P1-01 统一稍后读收集链路（2026-08-29）

- 分支 `feat/p1-01-unify-collection`（master = 222fe4b，P0-04 合并后）

### 盘点出的五个入口、四套写法（含 3 个真 bug）

1. `command-palette`：抓取结果**直接丢弃**——抓取成功也只存 url+原文做标题，正文永远不落库
2. `share` 页：绕过 `scrapeUrl()` 直连 `/api/scrape`——mock 模式下分享保存必坏；失败也不降级
3. `batch-import`：抓取失败整条失败，与 Quick Add 的「仅存链接」降级不一致；不发 `reading:item-created` 事件
4. `QuickAdd` FAB：「添加文章」完全不抓取；`quick-add-bar` 是唯一全字段正确写入的入口

### 实现

- **新服务 `lib/reading/collect.ts`**：collectReadingItem 唯一入口——extractFirstUrl
  规范化 → 去重查询（显式 `eq user_id` + `is deleted_at null`，RLS 双保险）→ scrapeUrl
  （失败降级仅存链接）→ 固定 8 字段插入 → 发 `reading:item-created`；collectResultToast
  统一五入口文案
- **冻结语义**（写在服务头注释 + 测试固化）：抓取失败=仅存链接（title=规范化 URL，
  正文字段 null，UI 必须明示）；去重仅对活跃条目、限定 user_id、规范化 URL 精确匹配，
  命中返回 duplicate 不插新行不发事件；软删除行对客户端不可见（021 RLS），再次保存
  产生新条目、回收站副本不动（垃圾箱走 050 RPC 恢复）；查询/写入失败一律 error 结局
- **五个入口全部改为薄壳**：quick-add-bar / command-palette / quick-add FAB /
  batch-import-panel / share 页只留输入、进度与反馈；share 页补 duplicate 态，
  batch 面板新增「跳过」状态与统计（duplicate 琥珀色 + note 文案）
- 无迁移：不加 (user_id,url) 部分唯一索引——restore RPC 明文插入且历史数据可能有
  同 URL 活跃重复行，会破坏 P0-04 刚冻结的 v4 备份往返（详见 BLOCKED.md）

### 测试（+2 文件 / +14 用例，全量 114 文件 / 833 用例）

- `lib/reading/collect.test.ts`（11 条）：固定抓取响应下插入字段逐项一致（含字段
  清单冻结断言：恰好 8 字段）、杂讯文本规范化、仅存链接降级、同用户 duplicate
  不插不发、`eq user_id` 显式在查询过滤器里（跨用户不命中）、软删除行排除、
  invalid-url/unauthenticated/查询失败 fail-closed/插入失败均不假成功、事件
  payload 契约、toast 统一文案
- `lib/reading/collect.mock.test.ts`（3 条）：真实 mock 客户端集成——保存样例文章
  + 重复提交 duplicate 不新增行、他人同 URL 不拦、与 seed 活跃条目去重
- 本地门禁：tsc exit 0、vitest 114/833 全过 skip=0、next build exit 0、改动文件
  lint 零告警；无迁移故无 pgTAP 变更（存量 12 文件 126 断言不变）

# PROGRESS

## P0-04 备份恢复合同重建（2026-08-29）

- 分支 `chore/p0-04-backup-contract`（基于 P0-03 合并后的 master = d3ae007，串行第二 PR）

### 盘点出的三个数据丢失洞

1. `memos`（055）不在 BACKUP_TABLES —— 导出即丢全部速记
2. `task_item_refs`（030 任务↔笔记双链）不在备份清单 —— 导出即丢双链关系
3. `rewriteInternalLinks` 不处理 `taskItem.attrs.taskId` —— 即使导出了笔记，
   恢复后任务绑定块指向旧 ID，双链断链

### 实现（v4 合同）

- **schema.ts**：BACKUP_VERSION 3→4；BACKUP_TABLES 收录 memos/task_item_refs
  （28 张表）；两张表的字段 validator（memos.tags 字符串数组、task_item_refs
  唯一键 note_id+block_id）；关系校验（task_id/note_id 引用）；
  v2/v3 老文件兼容——缺新表键补空数组，validateManifest 对 v2/v3 豁免新表
  counts 键缺失（按 0 记），v4 起严格（缺表即 INVALID_TABLE）
- **restore.ts**：ID_TABLES 与映射收录两表；**rewriteInternalLinks 新增
  taskId 键重映射**（空/未绑定原样保留），全部 8 个调用点传入 tasks 映射
- **迁移 058**：restore_backup_v2_full 包装 with_highlight_references 链尾，
  落库 memos（tags 数组原样）与 task_item_refs（on conflict 跳过），
  counts 报告增补两表；coalesce 兜底老 payload
- **API**：/api/backup/restore 改调 restore_backup_v2_full
- **设置页**：导出区「备份包含什么？」折叠清单（28 表 + 不包含项明示：
  附件/图片文件本体、auth、插件配置、分享链接、AI 密钥）；**新增「从备份恢复」
  入口**（restore-section.tsx：文件选择 → inspect 预检 → 问题清单 → 确认
  （明示整体替换语义）→ POST → 逐表结果报告）
- 非空账户：沿用既有 not_empty → 409 整体拒绝（UI 有明确文案）

### 测试

- schema.test.ts：fixture 扩展（memos/task_item_refs/taskItem 节点）；remaps
  用例新增 6 组断言（taskId 重映射/未绑定保留/两表引用重映射/旧 ID 全清除）；
  新用例「v3 老备份兼容」（真实形状：counts 也不含新键；v4 缺表必须报错）
- pgTAP 058_backup_v4.test.sql：10 断言——双账号恢复（B 空账户 restored；
  memos 按属主+内容落库；task_item_refs 按引用落库；不挂他人任务；
  counts 报告一致）；非空账户 not_empty 且零写入；v3 老形状 payload 恢复成功
- 本地门禁：tsc exit 0、vitest **112 文件 / 819 用例**、next build exit 0；
  pgTAP 由 CI db-test 实跑（116 存量 + 10 新增）

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

### P0-04 CI 验证（4 轮）
- 第 1 轮：exit 3（SQL 前置错误）——用户 C 的 auth.users 预置 DO 块写在 set role
  authenticated 之后（无权限）；挪到开头 postgres DO 块
- 第 2 轮：notes.is_pinned NOT NULL——测试 payload 手写行缺列（真实 v4 导出经
  schema 合同字段齐全）；补 is_pinned/full_width/font_family/small_font
- 第 3 轮：tasks.sort_order NOT NULL——停止逐列猜，读 044 基础 RPC 的
  jsonb_to_recordset 全列清单核对，四张非空表必填列一次补齐
- 第 4 轮：**db-test Files=12, Tests=126（116 存量 + 10 新增）→ Result: PASS**；
  verify（tsc + vitest 112/819 + build + 审计门禁）全过
- 说明：三轮失败均为测试载荷形状问题，产品代码（迁移/RPC/合同/重映射）零缺陷
  返工；合并 PR #179
