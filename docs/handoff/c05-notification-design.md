# C05 通知端到端闭环 — 盘点与设计（2026-09-14）

C02 第五轮后接手的 L 卡。本文是 C05 的盘点与设计交付：四条投递路径的职责/去重键/生命周期、
双响防线现状与残余双响面、三项「未端到端」（Cron 重试 / 夏令时 / 点击跳转）的现状结论、
可本地验证 vs 需 staging 的测试矩阵，以及后续执行切片。

---

## 1. 四条投递路径盘点

### 1.1 Web 前台本地提醒（页面打开时）

- 代码：`hooks/use-notifications.ts` + 纯函数 `lib/tasks/notifications.ts`
- 触发：任务列表加载/变更时 `scheduleDueDateReminders(tasks)`（仅 `/tasks` 页）；
  另有每日一次逾期摘要 `notifyOverdueSummary`
- 计划：`buildDueReminders` 三变体——`:today`（当天即时，15 分钟过期宽限）、
  `:15min`、`:due`；基于 `due_date`（全天任务按本地 23:59:59，`effectiveDueDate`）
- **去重键**：`${task.id}:${dueMs}:${variant}`，存 localStorage `organize:notified-due`（按浏览器档案）
- 生命周期：`pruneNotifiedKeys` 只保留「任务仍存在且到期时刻未变」的 key——
  完成/取消/删除/改期后旧 key 清除、改期自然重新武装 ✓；
  delay > 24.8 天跳过排程（setTimeout 溢出防护），任务临近后随列表刷新再排 ✓

### 1.2 PWA Web Push（服务端 Cron，主路径）

- 代码：`app/api/cron/task-reminders/route.ts` + 迁移 039（`task_reminder_deliveries`、
  `claim_due_task_reminder_deliveries` RPC、两个 reset 触发器）+ 061（变量冲突修复）
- 计划来源：`task_reminders` 行（用户按任务配置，anchor start/end + offset 预设，
  `lib/tasks/reminders.ts`）——**与 1.1 的 due_date 自动计划是两套语义**
- 触发：GitHub Actions 每 15 分钟 POST `/api/cron/task-reminders`（`CRON_SECRET` 鉴权；
  未配 `TASK_REMINDER_BASE_URL` 时工作流自动跳过）
- 领取窗口：`scheduled_for <= now()` 且 `>= now() - 24h`；`attempt_count < 6`；
  `sending` 超 5 分钟视为僵死可重领（设备离线/进程被杀的投递恢复）；
  失败退避 `min(60, 2^attempt)` 分钟；推送消息 TTL 86400、urgency high
- **去重键（每订阅设备最多一次）**：`unique (reminder_id, subscription_id, scheduled_for)`
  ——039 头注释声明的语义，`on conflict do nothing` 幂等落队列
- 生命周期：任务改期/完成/取消/软删 → 触发器 `reset_task_reminders_after_schedule_change`
  删未 sent 投递 + `notified_at=null` → 自动重新武装 ✓；推送端点 404/410 → 订阅
  `disabled_at` ✓；`lastSentAt` 心跳随响应返回供调度侧告警 ✓
- 点击跳转：payload 带 `url: /tasks/${task_id}`，`sw.js` `notificationclick` 聚焦已有
  窗口并导航（或开新窗）；`/tasks/[id]` 是真实详情页路由 → **跳转链路有效** ✓

### 1.3 桌面壳（Tauri）兜底轮询

- 代码：`components/desktop/reminder-poller.tsx` + `/api/tasks/due-soon`
  （`lib/tasks/due-soon.ts`，用户态 RLS）
- 触发：仅 tauri 平台，5 分钟轮询，未来 15 分钟窗口内到期/开始的未完成任务
- **去重键**：内存 Set `task_id:anchor`（每 App 会话；重启后 15 分钟窗口内的任务
  会再报一次——窗口小、概率低，接受并记录）
- 双响防线（multi-platform-plan §3.2 / ROADMAP）：tauri 平台不注册 SW
  （`sw-registrar.tsx` 平台门）+ 壳内从不订阅 Web Push（`use-notifications` 仅 web
  平台订阅）→ cron 投递只发生在已订阅设备上，与轮询天然隔离 ✓

### 1.4 移动端（Capacitor）——骨架

- 代码：`lib/platform/notifications.ts` 的 capacitor 适配器
- 现状：`LocalNotifications.schedule` **不带 `schedule.at`**（即发即显），
  无 FCM/APNs 推送集成；提醒只在 App 打开时由 1.1 的客户端排程驱动
- 语义与桌面壳一致（App 打开才有效）；后台定时提醒需原生子任务（见 §6）

平台抽象：`PlatformNotifier`（web=Notification API / tauri=plugin-notification /
capacitor=local-notifications），按 `detectPlatform()` 分发。

---

## 2. 双响防线现状与两个残余双响面

「三道锁」= tauri 不注册 SW + 壳内不订阅 Push + 轮询去重键与 delivery 语义隔离。
防线本身完好。但**跨路径同刻双响**还有两面，此前未入账：

| # | 场景 | 根因 | 建议 |
|---|---|---|---|
| D1 | **web**：任务 `due_date` 在今天、且用户配置了 start/end 提醒行 → 同一时刻本地报「任务已到期」（1.1，due 基）+ 服务端 push 报「任务即将开始」（1.2，schedule 基） | 1.1 与 1.2 是两套计划源，互不知情 | 客户端排程前拉取该任务的 `task_reminders` 已配置集，对「同一任务同一时刻窗口（±15min）已配置提醒行」的变体跳过本地报；或产品层接受并文案区分 |
| D2 | **tauri**：`schedule_start_at` 在 15 分钟内且 `due_date` 同刻 → 页面排程报「任务即将到期」（1.1）+ 轮询报「任务即将开始」（1.3） | 同上，壳内两条本地路径并存 | 轮询发通知前查同一任务的本地已通知键（`organize:notified-due`）做抑制；或轮询只服务「页面不在前台」时（`document.visibilityState` 门） |

两面都属产品语义决策（是否把「到期」与「开始」视为两个事件），执行前需定方向。

---

## 3. 三项「未端到端」现状结论

### 3.1 Cron 重试/设备离线/重复触发

- 机制已备齐（§1.2），pgTAP `061_claim_reminder_exec.test.sql` 覆盖领取执行语义
- **未验证的端到端段**：真实浏览器订阅 → 真实推送服务（Mozilla autopush / FCM）→
  设备离线期间 cron 重试 → 设备恢复收到补投。本地无法伪造真实推送服务，
  按 C05 验收「不以 mock 冒充」——归 staging 项（§5）
- 可本地补强：对 route handler 的退避/停订分支做带 stub `web-push` 的单测
  （纯 Node 层，不冒充推送服务本身）

### 3.2 夏令时/时区

- 时刻存储全链 timestamptz（绝对时）：`reminderFireAt` = 锚点 + offset 分钟（绝对）、
  claim 窗口/退避用 DB `now()`（绝对）→ 提醒的**绝对时刻**不受 DST 影响 ✓
- 全天任务按**本地墙钟** 23:59:59（`effectiveDueDate`）——语义正确（「当天结束」）✓
- **决策项 R1（已定方向并实现，2026-09-15 用户确认默认墙钟语义，迁移 080）**：
  033 `complete_recurring_task` 用绝对 interval 推进 →「每天 09:00」DST 切换后漂移成
  08:00/10:00。080 新增 `advance_recurring_wall_clock`（任务 `timezone` 列做 AT TIME ZONE
  墙钟日历推进，monthly/yearly 夹取由 naive 日历运算完成），RPC 改为「有合法 timezone 走墙钟、
  null/非法时区回退 033 绝对推进」——存量任务（无时区）行为不变，不迁移数据。
  pgTAP `080_complete_recurring_wall_clock.test.sql` 17 断言（春/秋令时、weekly、月末/闰日
  夹取、回退信号、RPC 端到端+幂等+越权负例）
- 决策项 R2（随 R1 一并定，2026-09-15）：任务始终按**创建时写入的 `tasks.timezone`**（浏览器
  IANA 时区，task-date-popover 排程时落库）解释与推进，不随查看设备时区变；无 timezone 的
  存量任务保持绝对时刻语义（回退合同），不补默认时区

### 3.3 点击跳转

| 路径 | 现状 |
|---|---|
| 1.2 服务端 push | payload url `/tasks/${task_id}` → sw `notificationclick` 导航 ✓（本轮已核实路由存在） |
| 1.1 web 本地通知 | `onclick` 只 `window.focus()`，**不跳转** ✗ → 本轮修复（见 §6） |
| 1.3 tauri 轮询 | plugin-notification v2 无点击回调 API，**平台限制**，保持不跳转（记录） |
| 1.4 capacitor | 可监听 `localNotificationActionPerformed`，随移动壳实现一并接（骨架期不单做） |

---

## 4. 测试矩阵

| 项 | 层 | 现状 | 环境要求 |
|---|---|---|---|
| buildDueReminders/prune/summary 语义 | vitest（notifications.test.ts） | ✓ 已有 | 本地 |
| due-soon 窗口/归一化 | vitest（due-soon.test.ts） | ✓ 已有 | 本地 |
| claim RPC 领取/幂等/重领 | pgTAP 061 | ✓ 已有 | 本地 Postgres |
| 任务改期/完成/删除 → 投递重置 | pgTAP（039 触发器，随 061 系列） | ✓ 已有 | 本地 Postgres |
| route 退避/停订分支 | vitest + stub web-push | 本轮新增 | 本地 |
| 本地通知点击跳转 | e2e/探针（Notification 构造可拦截） | 本轮新增 | 本地 mock 栈 |
| 真实订阅→真实推送→离线补投 | 端到端 | ✗ | **staging（VAPID 密钥 + 公网 HTTPS + 真浏览器）**；本地部分（自生成 VAPID + localhost secure context）可先行 |
| 锁屏/后台 WebView 投递 | 真机 | ✗ | 真机（C03/C04 人工项） |
| DST 跨界重复任务行为 | 墙钟语义已实现（080） | ✓ | 本地 pgTAP |

## 5. 后续执行切片（建议顺序）

1. **S1（本轮）**：web 本地通知点击跳转 + route 重试分支单测（§6）
2. **S2（需产品决策 D1/D2）**：同刻双响收敛
3. **S3（需决策 R1）**：重复任务 DST 语义
4. **S4（需 staging）**：真实 Push 端到端 + `lastSentAt` 告警接线 + 补投验证
5. **S5（随移动壳）**：capacitor 后台调度与点击监听

阻塞项与 D01/D02 相同：VAPID 密钥、公网 HTTPS 域名、真实推送服务连通性。
