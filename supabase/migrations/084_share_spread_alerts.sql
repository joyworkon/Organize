-- 084 分享扩散告警（防扩散的可观测面）
--
-- 目标：属主**主动**开启后，当一条受限链接出现「大量被拒的进入尝试」时通知他。
--
-- 为什么以「被拒」为信号（而不是「访问量高」）：
--   082 的名额闸门在链接被转发出去后，会稳定地产生 `denied_no_quota`
--   （名额已满还有人想进）。这条记录**恰好就是扩散的证据**——正常使用时
--   一条定向链接只有收件人一台设备进来，不会有第二条 denied。反过来，
--   单看「访问量」会把收件人自己反复刷新误判成扩散。
--   故只统计 denied_no_quota / denied_ip 两类，不掺 granted / forbidden。
--
-- 设计要点：
--   1. **告警是属主主动开的**（spread_alert_enabled 默认 false）。推送通知是
--      侵入性的，未经同意不发；且多数分享属主并不需要这种监控。
--   2. **去重靠 last_spread_alert_at 时间水位**：同一波扩散只提醒一次，
--      直到水位之后又攒够一批新的拒绝才再提醒。没有水位的话，持续被转发
--      会每次 cron 都推一条，属主很快会关掉它——告警被无视等于没有。
--   3. **claim 语义（for update skip locked + 就地打水位）**：与 039 的
--      claim_due_task_reminder_deliveries 同款，多实例并跑不会重复推送。
--   4. **只选仍然有效的分享**：已关闭/已过期的链接不会再产生新的 denied，
--      没必要继续提醒（它们的历史日志仍在，属主可在面板看到）。
--   5. 阈值与窗口做成参数（默认 1 小时内 5 次拒绝），够低到能捕获「链接刚被
--      贴到某个群」这种早期扩散，又够高到不被偶发的刷新重试触发。
--   6. 不新增表，只给 shares 加两列：水位是分享行的属性，与 access_mode 同口径。
--      备份链不动（shares 本就在 REQUIRED_EXCLUSIONS 里）。

-- ============================================================
-- 1. shares 新增两列
-- ============================================================
-- 默认 false = 不启用：存量链接与新建链接都静默，属主在面板里主动打开
alter table public.shares
  add column if not exists spread_alert_enabled boolean not null default false;
-- 上次告警时间（水位）：null = 从未告警过，则窗口内所有拒绝都算数
alter table public.shares
  add column if not exists last_spread_alert_at timestamptz;

-- 检测查询按 (share_id, 时间) 过滤被拒记录；部分索引只覆盖判为「扩散信号」的
-- 两类 outcome，比全表索引小得多
create index if not exists share_access_log_denied_idx
  on public.share_access_log (share_id, created_at desc)
  where outcome in ('denied_no_quota', 'denied_ip');

-- ============================================================
-- 2. claim_spread_alerts：取出「该告警的分享」并就地打水位（原子）
-- ============================================================
create or replace function public.claim_spread_alerts(
  p_limit integer default 50,
  p_min_denials integer default 5,
  p_window interval default interval '1 hour'
)
returns table (
  share_id uuid,
  owner_id uuid,
  resource_type text,
  resource_id uuid,
  denied_count integer,
  distinct_ips integer
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500
     or p_min_denials is null or p_min_denials < 1
     or p_window is null or p_window <= interval '0' then
    raise exception 'invalid arguments';
  end if;

  -- 一条语句内完成「选行 → 锁行 → 计数 → 打水位」，多实例并跑时靠
  -- for update skip locked 互不重复（与 039 的 claim 同款）
  return query
  with candidates as (
    select s.id, s.owner_id, s.resource_type, s.resource_id, s.last_spread_alert_at
      from public.shares s
     where s.spread_alert_enabled
       and s.is_public
       and (s.expires_at is null or s.expires_at > now())
     order by s.id
     for update of s skip locked
     limit p_limit
  ),
  -- 注意：CTE 里的别名刻意用 n_denied / n_ips，**不能**直接叫 denied_count /
  -- distinct_ips——RETURNS TABLE 的出参名在 plpgsql 里是可见变量，与外层同名
  -- 别名撞车会报 column reference is ambiguous（实测踩过）
  counted as (
    select c.id, c.owner_id, c.resource_type, c.resource_id,
           count(l.id)::integer as n_denied,
           count(distinct l.ip)::integer as n_ips
      from candidates c
      left join public.share_access_log l
        on l.share_id = c.id
       and l.outcome in ('denied_no_quota', 'denied_ip')
       and l.created_at > now() - p_window
       -- 水位之后才算新的一波（见文件头第 2 条：同一次扩散只提醒一次）
       and (c.last_spread_alert_at is null or l.created_at > c.last_spread_alert_at)
     group by c.id, c.owner_id, c.resource_type, c.resource_id
  ),
  hits as (
    select * from counted where counted.n_denied >= p_min_denials
  ),
  stamped as (
    update public.shares s
       set last_spread_alert_at = now()
      from hits h
     where s.id = h.id
    returning s.id
  )
  -- 末列按位置映射到出参（denied_count / distinct_ips）
  select h.id, h.owner_id, h.resource_type, h.resource_id, h.n_denied, h.n_ips
    from hits h
    join stamped st on st.id = h.id
   order by h.n_denied desc;
end;
$$;

-- 只给 service_role：cron 路由用 service key 调；不给 anon/authenticated
-- （属主的读取需求走 list_share_sessions 一类的属主 RPC，不走这个 claim 接口）
revoke execute on function public.claim_spread_alerts(integer, integer, interval) from public, anon, authenticated;
grant execute on function public.claim_spread_alerts(integer, integer, interval) to service_role;
