-- 083 匿名公开链接的每日写入总量帽（防滥用兜底）
--
-- 为什么需要它（把 082 的限流缺口补上）：
--   匿名保存的两级限流见 072/076——`token+IP` 30/min 与**单 token** 120/min 兜底。
--   但 `X-Forwarded-For` 客户端可伪造（072 保存路由已注明），per-IP 档形同虚设，
--   实际只剩单 token 120/min。120 次/分的**持续**写入是每分享可控的 DB 写压力，
--   且每次快照上限 4MB——这不是「存储无限增长」（content/ydoc 都是覆盖写，
--   版本由 054 的 5 分钟去抖 + 时间分层裁剪兜住），而是**写入吞吐**上的资源消耗。
--   本迁移按分享、按天记一笔总量账，作为绕过限流后的最后一道兜底。
--
-- 设计要点：
--   1. **额度只在放行时消耗**：UPSERT 的 `do update ... where` 把「加一」与
--      「还在额度内」压在同一条语句里——被拒的请求不计数，额度不会被空打耗尽。
--      （若写成「先加再判」，攻击者狂打就能让计数无限膨胀，属主看到的是噪声。）
--   2. **同时卡次数与字节**：次数挡住「大量小写入」的往返开销，字节挡住
--      「少量巨大写入」的负载开销。两者互为补集，只卡一个都会漏。
--   3. **额度是宽松兜底，不是配额功能**：默认 10000 次 / 1 GiB 每日每分享，
--      远高于任何正常编辑（客户端 3s 去抖 + 仅在内容变化时保存）。目的是拦住
--      跑飞的滥用，不是给正常使用设限——被误伤比被滥用更糟，故取值刻意宽松。
--   4. **只作用于匿名 token 通道**：登录用户走 save_note_with_tasks_v2 /
--      save_note_ydoc，有自己的节流与归属，不吃这份额度。
--   5. 表不进备份（运行时抖动状态，与 rate_limit_hits / note_ydocs 同口径）。
--
-- 阈值调优：改下方 v_max_writes / v_max_bytes 两个常量即可（再开一次迁移）。
-- 若将来需要按分享配置，再升级成 shares 上的列——当前刻意不做，避免为兜底
-- 机制增加一个属主需要理解的旋钮。

-- ============================================================
-- 1. 计数表：(分享, UTC 日) 一行
-- ============================================================
create table if not exists public.share_write_quota (
  share_id uuid not null references public.shares(id) on delete cascade,
  -- UTC 日：窗口边界取 DB 时钟且与实例时区无关，多实例一致
  day date not null,
  writes integer not null default 0 check (writes >= 0),
  bytes bigint not null default 0 check (bytes >= 0),
  updated_at timestamptz not null default now(),
  primary key (share_id, day)
);

-- 防表膨胀的清理走 updated_at（见下方 helper 的概率清理）
create index if not exists share_write_quota_updated_at_idx
  on public.share_write_quota (updated_at);

-- RLS 启用且无任何 policy + 表级权限收口：anon/authenticated 直读直写全拒，
-- 只经下方 SECURITY DEFINER helper（与 076 rate_limit_hits 同一口径）
alter table public.share_write_quota enable row level security;
revoke all on table public.share_write_quota from anon, authenticated;

-- ============================================================
-- 2. consume_share_write_quota：原子消费一次写入额度。true = 放行
-- ============================================================
create or replace function public.consume_share_write_quota(p_share_id uuid, p_bytes bigint)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_max_writes constant integer := 10000;
  v_max_bytes constant bigint := 1073741824;  -- 1 GiB
  v_day date := (now() at time zone 'utc')::date;
  v_bytes bigint := greatest(coalesce(p_bytes, 0), 0);
  v_ok boolean;
begin
  if p_share_id is null then
    return false;
  end if;
  -- 单次就超总额度：直接拒。首次插入不参与下面的 where 判断，漏了这条会放行
  -- 一次超额写入（表里原本没有该 (share, day) 行时）
  if v_bytes > v_max_bytes then
    return false;
  end if;

  -- 加一与判额度在同一条语句里（见文件头第 1 条）：额度不足则不更新、不返回行
  insert into public.share_write_quota as q (share_id, day, writes, bytes)
  values (p_share_id, v_day, 1, v_bytes)
  on conflict (share_id, day) do update
     set writes = q.writes + 1,
         bytes = q.bytes + v_bytes,
         updated_at = now()
   where q.writes + 1 <= v_max_writes
     and q.bytes + v_bytes <= v_max_bytes
  returning true into v_ok;

  if v_ok is null then
    return false;
  end if;

  -- 概率清理 30 天前的行（与 076 同一口径：摊薄成本，避免每次写都删）
  if random() < 0.01 then
    delete from public.share_write_quota where day < v_day - 30;
  end if;

  return true;
end;
$$;

-- 内部 helper：anon 不给（额度判定只由下方的写入 RPC 调用，不对外暴露探针）
revoke execute on function public.consume_share_write_quota(uuid, bigint) from public, anon;
grant execute on function public.consume_share_write_quota(uuid, bigint) to authenticated, service_role;

-- ============================================================
-- 3. save_public_note：快照通道接入额度（正文 082，只加额度判定）
-- ============================================================
create or replace function public.save_public_note(
  p_token text,
  p_content jsonb,
  p_expected_note_revision integer,
  p_title text default null,
  p_mutation_id uuid default null,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_share public.shares%rowtype;
  v_owner uuid;
  v_cur_rev integer;
begin
  -- 内容护栏（匿名直调 RPC 绕不过，路由层校验只是外皮）：
  -- 必须是 jsonb object（数组/标量拒绝），且体积与 ydoc 通道同上限 4MB——
  -- 否则持 token 者可无界填充属主存储
  if p_content is null or jsonb_typeof(p_content) <> 'object'
     or octet_length(p_content::text) > 4 * 1024 * 1024 then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if p_title is not null and char_length(p_title) > 255 then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if p_token is null then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- token → 未过期的 public_edit 笔记分享；其余（不存在/过期/只读/disabled/
  -- 非笔记/软删/属主不符）统一 forbidden，不给 not_found 探针
  select * into v_share
    from public.shares
   where token = p_token
     and resource_type = 'note'
   limit 1;
  if not found
     or not v_share.is_public
     or (v_share.expires_at is not null and v_share.expires_at <= now())
     or v_share.access_mode is distinct from 'public_edit' then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- 名额闸门（082）：与 resolve_share_access 同口径，写路径也 fail-closed
  if v_share.session_limit is not null
     and not public.share_session_ok(v_share.id, p_session_id) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- 每日写入额度（083）：绕过限流后的兜底。独立状态码，便于客户端如实提示
  -- 而不是显示成「权限被收回」（forbidden 会触发编辑器转只读，语义不同）
  if not public.consume_share_write_quota(v_share.id, octet_length(p_content::text)) then
    return jsonb_build_object('status', 'quota_exceeded');
  end if;

  select user_id, content_revision into v_owner, v_cur_rev
    from public.notes
   where id = v_share.resource_id
     and user_id = v_share.owner_id
     and deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- 乐观锁与 v2 同形：null = 不校验（节流快照语义）
  if p_expected_note_revision is not null and v_cur_rev <> p_expected_note_revision then
    return jsonb_build_object('status', 'conflict_note', 'current_revision', v_cur_rev);
  end if;

  -- 以属主 scope 写（DEFINER 直写）；匿名不署名：last_edit_by 强制 null
  update public.notes
     set content = p_content,
         content_revision = v_cur_rev + 1,
         title = coalesce(p_title, title),
         updated_at = now(),
         last_edit_by = null
   where id = v_share.resource_id
     and user_id = v_owner;

  -- 版本裁剪坑：save_note_version 触发器只在 auth.uid() is not null 时裁剪（065），
  -- 匿名保存没有 uid → 必须显式按属主裁剪，否则匿名编辑无限堆版本
  perform public.prune_note_versions_for(v_share.resource_id, v_owner);

  return jsonb_build_object('status', 'ok', 'note_revision', v_cur_rev + 1);
end;
$$;

-- ============================================================
-- 4. save_note_ydoc_by_token：blob 通道接入额度（正文 082，只加额度判定）
-- ============================================================
create or replace function public.save_note_ydoc_by_token(
  p_token text,
  p_note_id uuid,
  p_ydoc_b64 text,
  p_session_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_ydoc bytea;
  v_share_id uuid;
begin
  if p_token is null or p_note_id is null or p_ydoc_b64 is null or p_ydoc_b64 = '' then
    raise exception 'invalid_argument';
  end if;

  v_role := public.resolve_share_access(p_token, p_note_id, p_session_id);
  -- 不能写 `v_role not in (...)`：role 为 NULL 时整个条件是 NULL，IF 不触发，
  -- 写入会穿透到 DEFINER 的 upsert（067 实测踩过的洞）
  if v_role is distinct from 'editor' then
    raise exception 'forbidden';
  end if;

  if exists (
    select 1 from public.notes
     where id = p_note_id and deleted_at is not null
  ) then
    raise exception 'forbidden';
  end if;

  v_ydoc := decode(p_ydoc_b64, 'base64');
  if v_ydoc is null or octet_length(v_ydoc) = 0 then
    raise exception 'invalid_argument';
  end if;
  if octet_length(v_ydoc) > 4 * 1024 * 1024 then
    raise exception 'ydoc_too_large';
  end if;

  -- 每日写入额度（083）：两条匿名写通道共用同一份账（按分享计，不按通道计）
  -- 取分享行：resolve_share_access 只回角色，额度记账需要 share_id
  select id into v_share_id
    from public.shares
   where token = p_token
     and resource_id = p_note_id
     and resource_type = 'note'
   limit 1;
  if v_share_id is null
     or not public.consume_share_write_quota(v_share_id, octet_length(v_ydoc)) then
    raise exception 'quota_exceeded';
  end if;

  insert into public.note_ydocs (note_id, ydoc, updated_at)
  values (p_note_id, v_ydoc, now())
  on conflict (note_id) do update
    set ydoc = excluded.ydoc,
        updated_at = excluded.updated_at;
end;
$$;

-- ============================================================
-- 5. EXECUTE 分层（沿 056/072/082 约定）
-- ============================================================
do $$
declare r record;
  anon_fns text[] := array['save_public_note', 'save_note_ydoc_by_token'];
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname::text = any (anon_fns)
  loop
    execute format('revoke execute on function public.%I(%s) from public', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to anon, authenticated, service_role',
      r.proname, r.args);
  end loop;
end $$;
