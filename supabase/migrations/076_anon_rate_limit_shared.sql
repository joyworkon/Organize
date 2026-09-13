-- 076 匿名入口多实例限流（A06，设计见 docs/anon-rate-limit-design.md）
--
-- 现状（BLOCKED.md Track A/B 声明 3）：HTTP 匿名保存与 WS 匿名握手两级限流均为
-- 进程内 token-bucket，多实例部署时限额按实例数放大。本迁移提供共享计数通道：
-- 一张表 + 一个原子 UPSERT RPC，web / collab-server 多实例对同一 key 全局合计。
--
-- 设计要点：
--   1. 固定窗口（非滑动）：window_start = db_now - db_now % window_ms，单条
--      UPSERT 原子自增，天然多实例正确；代价是窗口切换瞬间最多 2× limit 突刺
--      （对「防滥用第一道闸」可接受，授权仍在保存/回放 RPC 实时判）。
--      窗口时钟取 DB clock_timestamp()，实例间时钟漂移不会撕开窗口。
--   2. 拒绝也计数：被限后继续打继续 +1（持续滥用持续被拒到窗口尾）。
--   3. RLS 启用且无任何 policy：任何角色直读直写全拒，只经 SECURITY DEFINER RPC。
--   4. anon 可执行是刻意的（匿名保存路由无用户会话、collab-server 只持 anon
--      key）。滥用面与「持 token 连打 HTTP 路由」等价（限流本就发生在鉴权前，
--      429 也计数），不新增面；参数形状校验防任意 key 存储放大。
--   5. 防表膨胀：updated_at 索引 + consume 内 1% 概率清理 15 分钟未触碰的行
--      （窗口上限 1h 的 1/4，陈旧行必然可删）。
--   6. 不进备份：运行时抖动状态，等同 note_ydocs 的排除口径，不改
--      BACKUP_VERSION 与 EXPORT_EXCLUSIONS（rate_limit_hits 不在导出白名单内，
--      天然不导出）。

-- ============================================================
-- 1. 计数表：key 全局一行，窗口滚动时地重置
-- ============================================================
create table if not exists public.rate_limit_hits (
  key text primary key
    -- 含 "."：key 内嵌点分 IP（public-save:<token>:198.51.100.7）
    check (key ~ '^[A-Za-z0-9:._-]+$' and char_length(key) <= 512),
  window_start bigint not null check (window_start >= 0),
  hits integer not null default 0 check (hits >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists rate_limit_hits_updated_at_idx
  on public.rate_limit_hits (updated_at);

alter table public.rate_limit_hits enable row level security;
-- 刻意无任何 policy：anon/authenticated 直读直写全拒（服务端只经下方 RPC）

-- 表级权限：不 grant select/insert/update/delete 给 anon/authenticated
-- （RLS 已挡 + 双保险，与 057 user_ai_settings 收口同一口径）
revoke all on table public.rate_limit_hits from anon, authenticated;

-- ============================================================
-- 2. consume_rate_limit：原子消费一次额度。返回 true = 放行，false = 超限
-- ============================================================
create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_ms bigint
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_ms bigint;
  v_window bigint;
  v_count integer;
begin
  -- 参数形状校验（T3/T4）：key 字符集（含点分 IP 的 "."）与长度、limit/window 范围
  if p_key is null or p_limit is null or p_window_ms is null
     or p_limit < 1 or p_limit > 100000
     or p_window_ms < 1000 or p_window_ms > 3600000 then
    raise exception 'invalid rate limit arguments';
  end if;

  -- 窗口时钟取 DB 时钟（不是调用方本地时钟——多实例漂移会撕开窗口）
  v_now_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_window := v_now_ms - (v_now_ms % p_window_ms);

  -- 拒绝也计数：无条件自增，超限与否由返回值表达
  insert into rate_limit_hits as h (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key) do update
    set hits = case when h.window_start = excluded.window_start then h.hits + 1 else 1 end,
        window_start = excluded.window_start,
        updated_at = now()
  returning hits into v_count;

  -- 概率性防膨胀清理（独立函数可直测）
  if random() < 0.01 then
    perform purge_rate_limit_hits();
  end if;

  return v_count <= p_limit;
end;
$$;

-- ============================================================
-- 3. purge_rate_limit_hits：删 15 分钟未触碰的行，返回删除数
-- ============================================================
create or replace function public.purge_rate_limit_hits()
returns integer
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from rate_limit_hits where updated_at < now() - interval '15 minutes'
    returning 1
  )
  select count(*)::integer from deleted;
$$;

-- ============================================================
-- 4. EXECUTE 分层（沿 056/072 约定）：先 revoke public 收口默认权限
-- ============================================================
do $$
declare r record;
  fn text[] := array['consume_rate_limit', 'purge_rate_limit_hits'];
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname::text = any (fn)
  loop
    execute format('revoke execute on function public.%I(%s) from public', r.proname, r.args);
    -- purge 只给服务端角色（service_role / postgres），不给 anon——清理不是匿名通道的事
    execute format('grant execute on function public.%I(%s) to service_role',
      r.proname, r.args);
  end loop;
  -- consume 是匿名通道（web 匿名保存路由 + collab-server anon key）
  grant execute on function public.consume_rate_limit(text, integer, bigint)
    to anon, authenticated;
end $$;

-- 防御性收口（实测：本地栈会自动给 public schema 新函数补 anon/authenticated 的
-- EXECUTE，do block 内的 revoke public 挡不住这种显式补授——072 及之前所有
-- 函数都是三角色全授所以从未暴露）。显式 revoke 保证最终状态：
-- purge 只归服务端角色，consume 才是匿名通道。
revoke execute on function public.purge_rate_limit_hits() from anon, authenticated;
