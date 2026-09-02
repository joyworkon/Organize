-- 072 可编辑公开链接 + 匿名实时协同（Track B 后端，分叉 2-B）
--
-- 在 006/018/021 的匿名只读公开链接之上，给 shares 增加 access_mode 三态：
--   disabled     关闭（is_public=false，等价撤销前的静默态）
--   public_read  公开只读（现状语义，默认值，存量行 backfill 落这里）
--   public_edit  公开可编辑：任何持链接者可经 token-scoped RPC 编辑该笔记
--
-- 四条匿名写入/回放通道，全部 token-scoped、每次读实时 shares 行（属主改回
-- 只读/关闭即刻断权，可撤销性是本卡的安全根）：
--   resolve_share_access(p_token, p_resource_id) → 'editor' | 'viewer' | null
--   save_public_note(...)        匿名快照保存（属主 scope 写，乐观锁同 v2 形）
--   get_note_ydoc_by_token(...)  collab-server 回放（067 新鲜度规则原样保留）
--   save_note_ydoc_by_token(...) collab-server 落库（仅 editor，4MB 上限同 067）
--
-- 安全设计：
--   1. collab-server 仍无密钥：匿名连接用 anon key 调上述 RPC，不引入 service role。
--   2. 统一 null / forbidden：token 不存在/过期/disabled/资源不匹配不可区分，
--      不给存在性探针（对齐 018/065/067 口径）。
--   3. 判权一律 is distinct from（067 的 NULL 陷阱：role 为 NULL 时 not in 不触发）。
--   4. save_public_note 以属主 scope 写（actor = share.owner_id，不是 auth.uid()），
--      last_edit_by 置 null——匿名不署名（任务书 §3 边界）。
--   5. 版本裁剪：save_note_version 触发器仅在 auth.uid() is not null 时裁剪（065），
--      匿名保存 auth.uid() 为 null → 本函数写完显式调 prune_note_versions_for，
--      否则匿名编辑会无限堆积 note_versions。
--   6. resolve_share_access 仅解析 note 分享：reading_item 分享不给实时编辑房间
--      提供角色（房间名空间是 note:<uuid>，reading_item 没有实时房间语义）。
--   7. 幂等：save_public_note 跳过 save_mutation_log（匿名无稳定身份可记账，
--      快照本就是节流覆盖写）；保留 p_mutation_id 参数位以免将来改签名。
--
-- shares 仍不进备份合同（REQUIRED_EXCLUSIONS）：access_mode 是 shares 行的属性，
-- 随行一起排除，备份链不动。

-- ============================================================
-- 1. access_mode 列 + backfill + 一致性约束
-- ============================================================
alter table public.shares
  add column if not exists access_mode text not null default 'public_read'
    check (access_mode in ('disabled', 'public_read', 'public_edit'));

-- 存量行：公开行 → public_read；历史上被手动关掉（is_public=false）的行 → disabled。
-- 顺序不能反：先归档 disabled，再钉 is_public = (access_mode <> 'disabled') 不变量。
update public.shares set access_mode = 'disabled' where not is_public;
update public.shares set is_public = (access_mode <> 'disabled');

alter table public.shares drop constraint if exists shares_access_mode_is_public_consistency;
alter table public.shares
  add constraint shares_access_mode_is_public_consistency
  check ((access_mode = 'disabled' and not is_public)
      or (access_mode <> 'disabled' and is_public));

-- ============================================================
-- 2. get_public_share：返回体带 access_mode（其余白名单与 anon execute 不变）
--    返回列变化（新增 access_mode）超出 create or replace 的允许范围，先 drop
-- ============================================================
drop function if exists public.get_public_share(text);

create or replace function public.get_public_share(p_token text)
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

revoke all on function public.get_public_share(text) from public;
grant execute on function public.get_public_share(text) to anon, authenticated;

-- ============================================================
-- 3. resolve_share_access：token → 实时有效角色（collab-server 判权唯一入口）
-- ============================================================
create or replace function public.resolve_share_access(p_token text, p_resource_id uuid)
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
     and resource_type = 'note'   -- 见文件头第 6 条
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

  if v_share.access_mode = 'public_edit' then
    return 'editor';
  elsif v_share.access_mode = 'public_read' then
    return 'viewer';
  end if;
  return null;
end;
$$;

-- ============================================================
-- 4. save_public_note：匿名快照保存（属主 scope 写 + 乐观锁 + 显式版本裁剪）
-- ============================================================
create or replace function public.save_public_note(
  p_token text,
  p_content jsonb,
  p_expected_note_revision integer,
  p_title text default null,
  p_mutation_id uuid default null    -- 预留：当前不记账（见文件头第 7 条）
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
-- 5. token 版 ydoc RPC（仿 067；collab-server 匿名连接的回放/落库通道）
-- ============================================================
create or replace function public.get_note_ydoc_by_token(p_token text, p_note_id uuid)
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
  -- 不存在/过期/只读关/disabled → null，不可区分
  if public.resolve_share_access(p_token, p_note_id) is null then
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

create or replace function public.save_note_ydoc_by_token(p_token text, p_note_id uuid, p_ydoc_b64 text)
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

  v_role := public.resolve_share_access(p_token, p_note_id);
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
-- 6. EXECUTE 分层（沿 056 约定）：本卡四个新 RPC 全部 anon 可调（匿名通道），
--    authenticated/service_role 同授；先 revoke public 收口默认权限
-- ============================================================
do $$
declare r record;
  fn text[] := array[
    'resolve_share_access', 'save_public_note',
    'get_note_ydoc_by_token', 'save_note_ydoc_by_token'
  ];
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname::text = any (fn)
  loop
    execute format('revoke execute on function public.%I(%s) from public', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to anon, authenticated, service_role',
      r.proname, r.args);
  end loop;
end $$;
