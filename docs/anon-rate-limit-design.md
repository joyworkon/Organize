# 匿名入口多实例限流设计（A06）

> 状态：已实施（随本设计同 PR 落地）。
> 卡面：长期计划 `docs/long-term-agent-plan-2026-09-11.md` §A06；
> 前置声明：`BLOCKED.md` Track A/B 声明 3（进程内限流单实例边界）。
> 本文回答卡面四问：部署拓扑、威胁场景、共享计数机制、故障策略。

## 1. 部署拓扑（先定义，再选机制）

**当前真实拓扑**（2026-09-13，D01 阻塞中、无云凭据，以账本为准）：

```
客户端 ──HTTP──> web（Next.js，单实例）
客户端 ──WS────> collab-server（Hocuspocus，单实例，未部署常驻主机）
                    │
                    └──anon key──> Supabase（Auth + PostgREST/Postgres）
```

两级限流点及其现状：

| 限流点 | 代码 | 限额（两级键） | 现状实现 |
|---|---|---|---|
| HTTP 匿名保存 | `apps/web/app/api/public-share/[token]/save/route.ts` | `token+IP` 30/min + 单 token 总量 120/min | 进程内滑动窗口（`lib/api/rate-limit.ts`） |
| WS 匿名握手 | `apps/collab-server/src/server.ts`（onAuthenticate） | `token+IP` 30/min + 单 token 总量 120/min | 进程内滑动窗口（server.ts 内嵌） |

**目标拓扑**（本卡设计对象）：任一端水平扩展——web 多 pod / collab-server 多节点，
前面任意 LB。进程内计数此时按实例数放大（30/min × N），这就是声明 3 的坑。

**决策**：共享计数选 **Supabase Postgres**（新增表 + RPC），理由：
- 两端都已有 Supabase 连接与 anon key，不引入新服务、新凭据、付费依赖（卡面依赖约束）；
- Redis / Upstash 类需新开通与付费，卡面明确「只做适配/本地验证，实际开通另行处理」——
  当前吞吐（匿名保存/握手，非热路径）用 Postgres 单行 UPSERT 足够，不值得为此加一个
  基础设施。若未来吞吐证明 Postgres 成瓶颈，换存储只需替换两端 limiter 的 rpc 注入。

**单实例保留现状**：backend 开关默认 `memory`（进程内，零额外延迟、零外部依赖）。
多实例部署时显式配置 `RATE_LIMIT_BACKEND=postgres`（web 与 collab-server 同名变量）。
D01 恢复部署时必须把该配置写进部署清单（deploy-runbook）。

## 2. 威胁场景

- **T1 匿名写滥用**：持公开 token 者刷保存 / 刷 WS 握手（每次握手触发 Auth+RPC
  查询，写放大耗 DB）。→ 两级键限额（既有，不变）。
- **T2 伪造 XFF 绕 IP 档**：`X-Forwarded-For` 客户端可伪造，每次换假 IP 让
  `token+IP` 档永不触发。→ 单 token 总量档（120/min）不依赖 IP，伪造 IP 绕不过；
  IP 档只是正常用户细分防误伤，不是防攻击边界（既有口径，保留）。
- **T3 直调限流 RPC 刷别人计数**：`consume_rate_limit` 必须 anon 可执行（web 匿名
  保存路由无用户会话、collab-server 只持 anon key），攻击者可绕过路由直接刷
  `token+IP` 档让别人被限。**等价性论证**：限流计数本就发生在鉴权前（路由代码
  顺序：形状校验 → 限流 → RPC 鉴权），持 token 者对 HTTP 路由连发请求同样能刷满
  任一档（429 响应也计数）；RPC 直调与打路由的差别仅是省了 body 传输，**不新增
  滥用面**。RPC 端做参数形状校验（key 字符集/长度、limit/window 范围），
  防任意 key 存储放大。
- **T4 随机 key 表膨胀**：攻击者用随机 token 直调 RPC 制造无限行。→
  行有 `updated_at` 索引，consume 内 1% 概率清理 15 分钟未触碰的行（窗口最长
  60s，15 分钟陈旧行必然可删）。
- **T5 一人耗尽整条链接**（卡面验收点）：单 IP 最多占 30/min，同 token 其他人
  仍有 90/min 余量——两级键的原始设计目标，共享化后语义不变。

## 3. 共享计数机制

**固定窗口计数**（`window_start = db_now_ms - (db_now_ms % window_ms)`），不是
进程内的滑动窗口。权衡：

- 滑动窗口在 SQL 里需要数组/行锁，多实例下代价与复杂度陡增；固定窗口是
  单条 UPSERT 原子自增，天然多实例正确（同一 key 全局一行）。
- 已知边界（记录在案）：窗口切换瞬间最多 2× limit 突刺（30/min 档最坏 60 次/瞬间）。
  对「防滥用第一道闸」语义可接受；授权不受影响（保存/回放 RPC 每次实时判权）。
- **窗口时钟取 DB 的 `clock_timestamp()`**，不取各实例本地时钟——实例间时钟漂移
  不会撕开窗口。
- **拒绝也计数**：被限后继续打的请求继续 +1（持续攻击者持续被拒到窗口尾），
  与「拒绝不计数」的进程内语义有差；UPSERT 单语句无法廉价区分，且该语义更严。

表与 RPC（迁移 076）：

```sql
create table public.rate_limit_hits (
  key text primary key,          -- 调用方构造：如 public-save:<token>:<ip>
  window_start bigint not null,  -- epoch ms，DB 时钟
  hits int not null default 0,
  updated_at timestamptz not null default now()
);
-- RLS 启用且无任何 policy：任何角色直读直写全拒，只经 RPC

consume_rate_limit(p_key, p_limit, p_window_ms) → boolean  -- SECURITY DEFINER
-- UPSERT：窗口相同 +1 / 窗口已滚动重置为 1；返回 hits <= p_limit
-- 参数校验：key ^[A-Za-z0-9:_-]+$ 且 ≤512、limit 1..100000、window 1s..1h
-- 1% 概率 perform purge_rate_limit_hits()（删 updated_at < now()-15min 的行）

purge_rate_limit_hits() → integer  -- 独立函数，pgTAP 直测
```

**两端接入**（backend 开关，默认 memory）：

- web `lib/api/rate-limit.ts`：新增异步 `checkRateLimit()`——postgres 模式调
  RPC（模块级 anon client，无请求上下文依赖），失败回退进程内 `rateLimit()`；
  调用点 `public-share/[token]/save`（两级键）与 `share/invite`（顺带受益，
  同模块同开关）。
- collab-server：握手限流从 server.ts 抽为 `src/anon-auth-limiter.ts`
  （`createAnonAuthLimiter({ backend, rpc })`，rpc 注入便于单测），postgres
  模式两档分别调 RPC，失败回退进程内判定。

## 4. 故障与重试策略（卡面验收点）

- **限流 RPC 失败（网络/超时/5xx）**：不重试（限流不是正确性关键路径——授权
  在保存/回放 RPC 实时判；重试只会放大延迟），**回退进程内档继续放行判定**，
  并 warn 一次（日志不含 key——key 内嵌分享 token，验收要求日志不存 token）。
  故障窗口内限流弱化为单实例语义，好过全断。
- **Postgres 完全不可用**：匿名保存的 `save_public_note`、WS 握手的
  `resolve_share_access`/`getUser` 同库同挂——链路自然 fail-closed，无需额外
  处理。
- **时钟**：窗口计算只用 DB 时钟（§3）；进程侧不传时间戳。
- **日志合规**：现有日志只打 `tokenLen` 不打值（保留）；新增 fallback warn 只打
  `error.message`；验证脚本输出统计数不打 token。

## 5. 验收映射（卡面 → 证据）

| 卡面验收 | 落点 |
|---|---|
| 两个实例合计额度正确 | pgTAP 076（跨调用合计/原子性/窗口滚动）；`apps/web/scripts/verify-shared-rate-limit.mjs` 本地与 CI 实测两实例（web :3101+:3102、collab :1421+:1422，均 postgres backend）：token+IP 档合计第 31 次拒绝；伪造 XFF 时单 token 总量档第 121 次拒绝；WS 握手合计第 31 次拒绝 |
| 不信任任意 X-Forwarded-For | 总量档与 IP 档解耦（既有），验证脚本场景 2 实测伪造递增 IP 绕不过总量档 |
| 重试、存储故障有明确策略 | §4；单测覆盖 fallback 路径 |
| 日志不存分享 token | §4；代码审读 |
| 避免一人耗尽整条链接 | 两级键语义不变（T5）；pgTAP 钉住 |

## 6. 边界与不做

- E2E 13 个 spec 与生产默认仍是 memory backend，行为零变化（默认值不动）。
- 不改限额数字（30/120/60s 两端一致，§1 表）。
- 不给 collab-server 引入 service role；限流 RPC 与其他 token 型 RPC 同为
  anon 可调（T3 等价性论证）。
- 表不进备份（`rate_limit_hits` 是运行时抖动状态，等同 `note_ydocs` 的
  「不进备份」口径——已加入备份排除声明的同类说明，不改 BACKUP_VERSION）。
