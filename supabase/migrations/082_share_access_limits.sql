-- 082 公开链接的访问名额与 IP 闸门（分享防扩散）
--
-- 在 072 的「三态公开链接」之上加两个**可选**的收敛闸门，用于「定向发给特定
-- 个人」时防止链接被随手转发后无限传播：
--   session_limit  integer  名额上限：null=不限（= 现状），1=仅首个认领者，N=N 个
--   ip_limit       integer  IP 上限：null=不限，N=活跃会话中允许出现的不同 IP 数
--
-- 语义核心：**锁落在「认领（claim）」上，不落在「打开链接」上**。
--   访客打开 /s/<token> 先看到一道「确认进入」；只有真实点击才调
--   claim_share_session 领名额。链接预览爬虫（微信/Slack 的 unfurl）只 GET 不点，
--   因此**不会烧掉链接**——这是把锁放在读接口上必然踩的坑（072 的三态已经把
--   「属主改回只读即刻断权」做成了安全根，本卡沿用同一条「实时判定」思路）。
--
-- 八条通道的口径（前四条 072 已有，本卡全部加名额闸门）：
--   get_public_share(...)        读页面：需认领且无有效会话 → status='claim_required'（不带内容）
--   resolve_share_access(...)    collab-server 判权唯一入口（握手 + 周期重验）
--   save_public_note(...)        匿名快照保存
--   get_note_ydoc_by_token(...)  回放
--   save_note_ydoc_by_token(...) 落库
--   另加三条本卡新增：claim_share_session / list_share_sessions / release_share_sessions
--
-- 安全设计：
--   1. **向后兼容是硬前提**：两个新列默认 null（=不启用）。不设限的分享行在所有
--      通道上与 072 行为逐字节一致——存量链接、存量匿名协作零变化。默认参数
--      p_session_id 让旧调用点（少传一个实参）继续可解析。
--   2. **名额判定与占用写入必须在同一事务 + 同一把行锁下**：claim_share_session
--      先 `select ... from shares for update` 锁住分享行，再「数活跃会话 → 插入」。
--      少了这把锁，两个并发认领会各自读到「还没满」而双双入选（经典 check-then-act
--      竞态）。session_limit=1 时这正是「抢注」能否成立的关键。
--   3. **claim_id 幂等**：客户端每次认领尝试生成一个 claim_id，重复提交（双击、
--      网络重试、StrictMode 双跑）命中 (share_id, claim_id) 唯一索引 → 返回同一
--      会话，不再吃第二个名额。没有它，一次双击会白耗两个名额。
--   4. **失败一律不可区分**：token 不存在/过期/disabled/资源不符 → 统一 forbidden，
--      不给存在性探针（对齐 018/065/067/072 口径）。no_quota 与 ip_mismatch 是
--      **已持有效 token 者**才拿得到的运行时结论，不泄漏链接是否存在。
--   5. **IP 是软约束，本卡如实承认**：XFF 客户端可伪造（072 的保存路由已注明），
--      NAT 下多人共享出口 IP。因此 ip_limit 只当「细分闸门」，**不当鉴权**；
--      真正的强门槛是 session_limit。IP 缺省（本地开发无代理 + 无 XFF）时
--      **fail-open**：不评估 IP 档——否则本地开发与无代理部署会被自己的闸门锁死。
--   6. **审计只记认领路径**：share_access_log 只在 claim 里写。读路径
--      （get_public_share / resolve_share_access）每次页面加载都跑，在那里写日志
--      等于给持 token 者一个无界写放大的 DoS 面。认领路径另有路由层 token+IP 限流。
--      同理 resolve_share_access 保持 stable（只读），不因本卡变成 volatile。
--   7. **属主可纠偏**：release_share_sessions 一键清空活跃会话（朋友换设备、误锁
--      自己时用）；list_share_sessions 让属主看到「谁在什么时候、从哪个 IP 进来」。
--      两个 RPC 都要求 auth.uid() = shares.owner_id，且不给 anon。
--   8. **会话凭证即 cookie 里的 uuid**：服务端一行 share_sessions 是事实源，
--      cookie 只是这台设备的提货单。cookie 丢了 = 得重新抢剩余名额（没名额被拒，
--      且审计留痕）——刻意不做「长期 cookie 免重验」，那会把锁的有效期从「握手前」
--      放宽到 cookie 生命周期，绕过会话锁的本意。
--
-- 不进备份合同：share_sessions / share_access_log 与 shares 同口径
-- （REQUIRED_EXCLUSIONS 已含 "shares"，本卡两表同属分享面，不进导出白名单）。
-- 恢复后名额占用与审计丢失是已知且刻意——它们是运行时会话态，不是内容事实源。

-- ============================================================
-- 1. shares 新增两列 + 一致性约束
-- ============================================================
alter table public.shares
  add column if not exists session_limit integer;
alter table public.shares
  add column if not exists ip_limit integer;

-- 档位只能是 null（不限）或 >=1；0 / 负数无意义（0 = 谁也进不来，是可撤销性
-- 已经覆盖的语义，不该用「名额」表达）
alter table public.shares drop constraint if exists shares_session_limit_bounds;
alter table public.shares
  add constraint shares_session_limit_bounds
  check (session_limit is null or session_limit >= 1);

alter table public.shares drop constraint if exists shares_ip_limit_bounds;
alter table public.shares
  add constraint shares_ip_limit_bounds
  check (ip_limit is null or ip_limit >= 1);

-- ip_limit 只在有认领（session_limit 非空）时才有评估时机：没有认领就没有
-- 「把 IP 钉进白名单」这个动作，配 ip_limit 是死配置。拒绝掉，避免属主设了个
-- 看起来生效、实际永不触发的档位。
alter table public.shares drop constraint if exists shares_ip_limit_requires_session_limit;
alter table public.shares
  add constraint shares_ip_limit_requires_session_limit
  check (ip_limit is null or session_limit is not null);

-- ============================================================
-- 2. share_sessions：名额占用的唯一事实源（一行 = 一个被占用的名额）
-- ============================================================
create table if not exists public.share_sessions (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.shares(id) on delete cascade,
  -- 客户端每次认领尝试的幂等键（双击/重试/StrictMode 双跑 → 同一会话，不重复吃名额）
  claim_id uuid,
  ip text,
  claimed_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- 属主释放（release_share_sessions）后置位：行保留供审计，但不再计入名额
  released_at timestamptz
);

-- 幂等键：同一分享下同一 claim_id 只允许一行。null 在 unique 索引里互不相等，
-- 因此不传 claim_id 的调用点（老客户端 / 直调 RPC）不受影响。
create unique index if not exists share_sessions_share_claim_uniq
  on public.share_sessions(share_id, claim_id);

-- 名额计数与 IP 去重都只数活跃行，部分索引让这两条判定走索引
create index if not exists share_sessions_active_idx
  on public.share_sessions(share_id)
  where released_at is null;

-- ============================================================
-- 3. share_access_log：认领路径的审计（只记 claim，见文件头第 6 条）
-- ============================================================
create table if not exists public.share_access_log (
  id bigserial primary key,
  share_id uuid not null references public.shares(id) on delete cascade,
  ip text,
  -- granted / denied_no_quota / denied_ip / forbidden；text 不设 check，
  -- 将来加档位（如 denied_expired）不必为枚举再开一次迁移
  outcome text not null,
  session_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists share_access_log_share_time_idx
  on public.share_access_log(share_id, created_at desc);

-- ============================================================
-- 4. 表级 GRANT + RLS（铁律 1：新表必须显式 grant，anon 一律不给）
-- ============================================================
alter table public.share_sessions enable row level security;
alter table public.share_access_log enable row level security;

-- 属主能看自己分享的名额占用与审计；anon 无任何表级权限（匿名访问全走 DEFINER RPC）
drop policy if exists "Owners can view own share sessions" on public.share_sessions;
create policy "Owners can view own share sessions" on public.share_sessions
  for select using (
    exists (
      select 1 from public.shares s
       where s.id = share_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists "Owners can view own share access log" on public.share_access_log;
create policy "Owners can view own share access log" on public.share_access_log
  for select using (
    exists (
      select 1 from public.shares s
       where s.id = share_id and s.owner_id = auth.uid()
    )
  );

revoke all on public.share_sessions from anon;
revoke all on public.share_access_log from anon;
grant select on public.share_sessions to authenticated;
grant select on public.share_access_log to authenticated;

-- ============================================================
-- 5. share_session_ok：会话有效性判定（内部 helper，不给 anon）
--    DEFINER 调用方（resolve_share_access 等）以属主权限执行，不受本函数
--    的 EXECUTE 授权影响；对 anon 收口是为了不把「会话 id 是否存在」变成探针。
-- ============================================================
create or replace function public.share_session_ok(p_share_id uuid, p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.share_sessions ss
     where ss.share_id = p_share_id
       and ss.id = p_session_id
       and ss.released_at is null
  );
$$;

revoke execute on function public.share_session_ok(uuid, uuid) from public, anon;
grant execute on function public.share_session_ok(uuid, uuid) to authenticated, service_role;

-- ============================================================
-- 6. get_public_share：读页面。加名额闸门 + 新状态 claim_required
--    返回列不变（status 是 text，新状态不破坏形状）；签名加 p_session_id
--    超出 create or replace 的允许范围，先 drop
-- ============================================================
drop function if exists public.get_public_share(text);

create or replace function public.get_public_share(p_token text, p_session_id uuid default null)
returns table (
  status text,
  resource_type text,
  expires_at timestamptz,
  access_mode text,
  resource jsonb
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  selected_share public.shares%rowtype;
  payload jsonb;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 256 then
    return query select 'missing'::text, null::text, null::timestamptz, null::text, null::jsonb;
    return;
  end if;

  select s.* into selected_share
  from public.shares s
  where s.token = p_token
  limit 1;

  if not found or not selected_share.is_public then
    return query select 'missing'::text, null::text, null::timestamptz, null::text, null::jsonb;
    return;
  end if;
  if selected_share.expires_at is not null and selected_share.expires_at <= now() then
    return query
      select 'expired'::text, selected_share.resource_type, selected_share.expires_at,
             selected_share.access_mode, null::jsonb;
    return;
  end if;

  -- 名额闸门（本卡）：分享设了 session_limit 且调用方没带有效会话 → 只回
  -- claim_required，**不带 resource**。内容在此处就断掉，页面渲染不出正文——
  -- 这样「第二个人打开链接」在服务端就已经拿不到内容，而不是靠前端藏起来。
  -- resource_type / access_mode 仍回：持 token 者本就知道链接指向什么，
  -- 页面需要它来决定「确认进入」的文案与进入后的只读/可编辑态。
  if selected_share.session_limit is not null
     and not public.share_session_ok(selected_share.id, p_session_id) then
    return query
      select 'claim_required'::text, selected_share.resource_type, selected_share.expires_at,
             selected_share.access_mode, null::jsonb;
    return;
  end if;

  if selected_share.resource_type = 'note' then
    select jsonb_build_object('id', n.id, 'title', n.title, 'content', n.content)
      into payload
      from public.notes n
      where n.id = selected_share.resource_id
        and n.user_id = selected_share.owner_id
        and n.deleted_at is null;
  elsif selected_share.resource_type = 'reading_item' then
    select jsonb_build_object(
      'id', r.id, 'title', r.title, 'content', r.content, 'excerpt', r.excerpt,
      'cover_image', r.cover_image, 'url', r.url
    )
      into payload
      from public.reading_items r
      where r.id = selected_share.resource_id
        and r.user_id = selected_share.owner_id
        and r.deleted_at is null;
  end if;

  if payload is null then
    return query select 'missing'::text, null::text, null::timestamptz, null::text, null::jsonb;
    return;
  end if;
  return query
    select 'active'::text, selected_share.resource_type, selected_share.expires_at,
           selected_share.access_mode, payload;
end;
$$;

revoke all on function public.get_public_share(text, uuid) from public;
grant execute on function public.get_public_share(text, uuid) to anon, authenticated, service_role;

-- ============================================================
-- 7. resolve_share_access：token + 会话 → 实时有效角色（collab-server 判权唯一入口）
--    名额闸门加在这里，下游 get/save_note_ydoc_by_token 自动继承（它们都走本函数）
-- ============================================================
drop function if exists public.resolve_share_access(text, uuid);

create or replace function public.resolve_share_access(
  p_token text,
  p_resource_id uuid,
  p_session_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_share public.shares%rowtype;
begin
  if p_token is null or p_resource_id is null then
    return null;
  end if;

  select * into v_share
    from public.shares
   where token = p_token
     and resource_id = p_resource_id
     and resource_type = 'note'   -- 见 072 文件头第 6 条
   limit 1;

  -- 不存在 / 已关 / 过期 / disabled：一律 null，不可区分
  if not found
     or not v_share.is_public
     or (v_share.expires_at is not null and v_share.expires_at <= now()) then
    return null;
  end if;

  -- 属主复核（防跨租户）：分享行必须仍指向属主自己的笔记。068 移交属主会清
  -- shares 行，这里是纵深防御——将来任何改属主的路径漏掉清理时 fail-closed
  if not exists (
    select 1 from public.notes
     where id = v_share.resource_id
       and user_id = v_share.owner_id
  ) then
    return null;
  end if;

  -- 名额闸门（本卡）：设了 session_limit 就必须持有效会话，否则与「不存在」
  -- 同样返回 null —— 不区分「没名额」与「链接无效」，不给探测面
  if v_share.session_limit is not null
     and not public.share_session_ok(v_share.id, p_session_id) then
    return null;
  end if;

  if v_share.access_mode = 'public_edit' then
    return 'editor';
  elsif v_share.access_mode = 'public_read' then
    return 'viewer';
  end if;
  return null;
end;
$$;

-- ============================================================
-- 8. save_public_note：匿名快照保存（属主 scope 写 + 乐观锁 + 显式版本裁剪）
-- ============================================================
drop function if exists public.save_public_note(text, jsonb, integer, text, uuid);

create or replace function public.save_public_note(
  p_token text,
  p_content jsonb,
  p_expected_note_revision integer,
  p_title text default null,
  p_mutation_id uuid default null,    -- 预留：当前不记账（见 072 文件头第 7 条）
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

  -- 名额闸门（本卡）：与 resolve_share_access 同口径，写路径也 fail-closed
  if v_share.session_limit is not null
     and not public.share_session_ok(v_share.id, p_session_id) then
    return jsonb_build_object('status', 'forbidden');
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
-- 9. token 版 ydoc RPC（仿 067；collab-server 匿名连接的回放/落库通道）
--    两个都只多一个 p_session_id，名额闸门由 resolve_share_access 承担
-- ============================================================
drop function if exists public.get_note_ydoc_by_token(text, uuid);

create or replace function public.get_note_ydoc_by_token(
  p_token text,
  p_note_id uuid,
  p_session_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result text;
begin
  if p_token is null or p_note_id is null then
    return null;
  end if;

  -- 读 = editor 或 viewer（与 067 的「viewer 连接也要拿文档」同口径）；
  -- 不存在/过期/只读关/disabled/未认领 → null，不可区分
  if public.resolve_share_access(p_token, p_note_id, p_session_id) is null then
    return null;
  end if;

  select encode(y.ydoc, 'base64')
    into v_result
    from public.note_ydocs y
    join public.notes n on n.id = y.note_id
   where y.note_id = p_note_id
     and n.deleted_at is null
     and y.updated_at >= n.updated_at;  -- 067 新鲜度规则原样保留

  return v_result;
end;
$$;

drop function if exists public.save_note_ydoc_by_token(text, uuid, text);

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

  insert into public.note_ydocs (note_id, ydoc, updated_at)
  values (p_note_id, v_ydoc, now())
  on conflict (note_id) do update
    set ydoc = excluded.ydoc,
        updated_at = excluded.updated_at;
end;
$$;

-- ============================================================
-- 10. claim_share_session：认领名额（本卡核心）
--
--     整体是一把行锁 + 一次计数 + 一次插入。锁分享行是关键：把并发认领串行化，
--     否则 session_limit=1 时两个请求会同时看到「0 个活跃会话」双双入选。
-- ============================================================
create or replace function public.claim_share_session(
  p_token text,
  p_ip text default null,
  p_claim_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_share public.shares%rowtype;
  v_existing public.share_sessions%rowtype;
  v_active integer;
  v_distinct_ips integer;
  v_same_ip boolean;
  v_new public.share_sessions%rowtype;
  v_alive boolean;
begin
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 256 then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- 行锁：并发认领在此串行（见函数头）
  select * into v_share
    from public.shares
   where token = p_token
   for update;

  if not found
     or not v_share.is_public
     or (v_share.expires_at is not null and v_share.expires_at <= now()) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- 资源存活复核（对齐 071 redeem 的 fail-closed 口径）：软删 / 属主已变 → 拒绝
  if v_share.resource_type = 'note' then
    select exists (
      select 1 from public.notes
       where id = v_share.resource_id
         and user_id = v_share.owner_id
         and deleted_at is null
    ) into v_alive;
  else
    select exists (
      select 1 from public.reading_items
       where id = v_share.resource_id
         and user_id = v_share.owner_id
         and deleted_at is null
    ) into v_alive;
  end if;
  if not v_alive then
    insert into public.share_access_log (share_id, ip, outcome)
    values (v_share.id, p_ip, 'forbidden');
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- 未设名额 = 不需要认领：调用方（页面）直接按现状渲染，不产生会话行
  if v_share.session_limit is null then
    return jsonb_build_object('status', 'not_required');
  end if;

  -- 幂等短路：同 claim_id 的重复提交返回同一个会话，不再吃第二个名额
  -- （双击 / 网络重试 / React StrictMode 双跑都会打到这里）
  if p_claim_id is not null then
    select * into v_existing
      from public.share_sessions
     where share_id = v_share.id
       and claim_id = p_claim_id
     limit 1;
    if found then
      update public.share_sessions
         set last_seen_at = now()
       where id = v_existing.id;
      return jsonb_build_object('status', 'ok', 'session_id', v_existing.id,
                                'reused', true);
    end if;
  end if;

  select count(*), count(distinct coalesce(ip, '')),
         coalesce(bool_or(ip is not distinct from p_ip), false)
    into v_active, v_distinct_ips, v_same_ip
    from public.share_sessions
   where share_id = v_share.id
     and released_at is null;

  if v_active >= v_share.session_limit then
    insert into public.share_access_log (share_id, ip, outcome)
    values (v_share.id, p_ip, 'denied_no_quota');
    return jsonb_build_object('status', 'no_quota');
  end if;

  -- IP 档（软约束，见文件头第 5 条）：
  --   * 没设 ip_limit → 不评估
  --   * p_ip 为空（无代理 / 本地开发）→ 不评估，fail-open
  --   * 该 IP 已在白名单里 → 放行（同一网络环境的人在名额内仍可进）
  --   * 否则要求「去重后的 IP 数」还没到上限
  if v_share.ip_limit is not null and p_ip is not null and not v_same_ip then
    if v_distinct_ips >= v_share.ip_limit then
      insert into public.share_access_log (share_id, ip, outcome)
      values (v_share.id, p_ip, 'denied_ip');
      return jsonb_build_object('status', 'ip_mismatch');
    end if;
  end if;

  insert into public.share_sessions (share_id, claim_id, ip)
  values (v_share.id, p_claim_id, p_ip)
  returning * into v_new;

  insert into public.share_access_log (share_id, ip, outcome, session_id)
  values (v_share.id, p_ip, 'granted', v_new.id);

  return jsonb_build_object(
    'status', 'ok',
    'session_id', v_new.id,
    'remaining', v_share.session_limit - v_active - 1
  );
end;
$$;

-- ============================================================
-- 11. 属主管理面：看名额占用 / 一键释放
--     两个都要求 auth.uid() = shares.owner_id；anon 一律不给
-- ============================================================
create or replace function public.list_share_sessions(p_share_id uuid)
returns table (
  session_id uuid,
  ip text,
  claimed_at timestamptz,
  last_seen_at timestamptz,
  released boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  -- 非属主 → 空集（不报错、不区分「不是你的」与「没有会话」，无探测面）
  if p_share_id is null or not exists (
    select 1 from public.shares where id = p_share_id and owner_id = auth.uid()
  ) then
    return;
  end if;

  return query
    select ss.id, ss.ip, ss.claimed_at, ss.last_seen_at, ss.released_at is not null
      from public.share_sessions ss
     where ss.share_id = p_share_id
     order by ss.claimed_at desc
     limit 50;
end;
$$;

create or replace function public.release_share_sessions(p_share_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if p_share_id is null or not exists (
    select 1 from public.shares where id = p_share_id and owner_id = auth.uid()
  ) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  update public.share_sessions
     set released_at = now()
   where share_id = p_share_id
     and released_at is null;
  get diagnostics v_count = row_count;

  return jsonb_build_object('status', 'ok', 'released', v_count);
end;
$$;

-- ============================================================
-- 12. EXECUTE 分层（沿 056/072 约定）：匿名通道 anon 可调；管理面只给登录态。
--     先 revoke public 收口默认权限。
-- ============================================================
do $$
declare r record;
  anon_fns text[] := array[
    'get_public_share', 'resolve_share_access', 'save_public_note',
    'get_note_ydoc_by_token', 'save_note_ydoc_by_token', 'claim_share_session'
  ];
  owner_fns text[] := array['list_share_sessions', 'release_share_sessions'];
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

  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname::text = any (owner_fns)
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated, service_role',
      r.proname, r.args);
  end loop;
end $$;
