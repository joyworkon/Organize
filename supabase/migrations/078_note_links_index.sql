-- B03 / R10b：精确关系索引——笔记内链边表 + 触发器维护 + v2 反链读接口。
-- 设计：docs/note-relations-index-design.md（B03-1，PR #273）。
--
-- 与 074（R10a）的关系：
--   074 get_note_backlinks 用 content::text LIKE 全文匹配，保留为**回退读路径**，本迁移不删不改。
--   v1 语义缺陷（设计 §1.2）：纯文本/代码块误报（D1）、外站同路径误报（D2）、
--   锚点/查询串漏报（D3）、百分号编码漏报（D4）、每次查询全表扫 content 读放大（D5）。
--
-- 本迁移四件事：
--   1. note_links 派生边表（source → target；目标不必存在 = 合法 missing 态）
--   2. 提取核心 note_links_pct_decode_ascii / note_links_extract（「有效内链」判定合同见设计 §2）
--   3. notes 触发器 diff 维护——保存/导入/恢复/移动/删除/移交全部写路径统一收口（设计 §1.4/§4.3）
--   4. get_note_backlinks_v2：稳定 keyset 游标 + 元数据 + 授权共享来源可见性（设计 §3/§4.4）
--
-- 派生数据合同：note_links 是 content 的可重建索引，**不进备份导出、不进 mock**（循 067 模式）；
-- 恢复时 rewriteInternalLinks 重映射 href 后由触发器自动重建。丢表不丢数据。

-- ============================================================
-- 1. 边表
-- ============================================================
create table if not exists public.note_links (
  id uuid primary key default gen_random_uuid(),
  source_note_id uuid not null references public.notes(id) on delete cascade,
  target_type text not null check (target_type in ('note', 'reading')),
  target_id uuid not null,
  -- 首次捕获的原始 href（排障用；判定只看 target_type/target_id，后续变体不回写）
  href text not null,
  created_at timestamptz not null default now(),
  unique (source_note_id, target_type, target_id)
);

-- 反链读路径：按目标取来源
create index if not exists note_links_backlink_idx
  on public.note_links (target_type, target_id, source_note_id);

-- 仿 057/067：客户端角色无任何直接表权限，读写只能经下方 RPC / service_role 维护
revoke select, insert, update, delete on public.note_links from authenticated;
revoke select, insert, update, delete on public.note_links from anon;
grant all on public.note_links to service_role;

alter table public.note_links enable row level security;

-- ============================================================
-- 2. 提取核心（immutable；仅供触发器/回填/RPC 内部使用，不授客户端）
-- ============================================================
-- ASCII 百分号解码：%XX → 字节。内链目标段是 uuid（ASCII 字符集），
-- 多字节序列解码结果必然过不了 uuid 形状校验，不需 UTF-8 重组。
create or replace function public.note_links_pct_decode_ascii(s text)
returns text
language plpgsql
immutable
as $$
declare
  i int := 1;
  o text := '';
begin
  if s is null then
    return null;
  end if;
  while i <= length(s) loop
    if substr(s, i, 1) = '%' and i + 2 <= length(s)
       and substr(s, i + 1, 2) ~ '^[0-9A-Fa-f]{2}$' then
      o := o || chr(('x' || substr(s, i + 1, 2))::bit(8)::int);
      i := i + 3;
    else
      o := o || substr(s, i, 1);
      i := i + 1;
    end if;
  end loop;
  return o;
end;
$$;

-- 「有效内链」提取（设计 §2）：
--   - 只认 TipTap link mark 的 attrs.href（jsonb_path 递归），纯文本/代码块正文不产生边（修 D1）
--   - href 必须站点相对 ^/(notes|library)/…（外站绝对 URL 排除，修 D2）
--   - 目标段 = 前缀到首个 ?/# 之间，ASCII 解码后须为合法 uuid（锚点不漏、编码段不漏，修 D3/D4）
--   - 同 (target_type, target_id) 的锚点/查询串变体折叠一条，href 取字典序最小（稳定）
--   - lax 模式同一 href 可能经两条结构路径命中 → group by 天然去重
create or replace function public.note_links_extract(p_content jsonb)
returns table (target_type text, target_id uuid, href text)
language sql
immutable
as $$
  with hrefs as (
    select m #>> '{}' as h
    from jsonb_path_query(p_content, 'lax $.**.marks[*].attrs.href') m
  ),
  candidates as (
    select
      case when h like '/notes/%' then 'note' else 'reading' end as ttype,
      public.note_links_pct_decode_ascii(substring(h from '^/(?:notes|library)/([^/?#]+)')) as seg,
      h
    from hrefs
    where h ~ '^/(?:notes|library)/[^/?#]+([?#].*)?$'
  )
  select c.ttype, c.seg::uuid, min(c.h)
  from candidates c
  where c.seg ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  group by c.ttype, c.seg;
$$;

revoke all on function public.note_links_pct_decode_ascii(text) from public, anon, authenticated;
revoke all on function public.note_links_extract(jsonb) from public, anon, authenticated;

-- ============================================================
-- 3. 维护触发器（新写维护：任意写路径改 content 即重算该行边集）
--    diff 语义：消失的边删除、新现的边补插（on conflict do nothing，
--    保留已存边的 created_at 首见时间）；无变化零写入，重复保存幂等。
--    硬删除来源不需要行级触发——source FK on delete cascade 级联清边。
-- ============================================================
create or replace function public.sync_note_links()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.note_links nl
  where nl.source_note_id = new.id
    and not exists (
      select 1
      from public.note_links_extract(new.content) e
      where e.target_type = nl.target_type
        and e.target_id = nl.target_id
    );

  insert into public.note_links (source_note_id, target_type, target_id, href)
  select new.id, e.target_type, e.target_id, e.href
  from public.note_links_extract(new.content) e
  on conflict (source_note_id, target_type, target_id) do nothing;

  return null;
end;
$$;

drop trigger if exists note_links_sync on public.notes;
create trigger note_links_sync
  after insert or update of content on public.notes
  for each row execute function public.sync_note_links();

-- ============================================================
-- 4. 读接口 get_note_backlinks_v2（v1 的精确替身）
--    - 目标读权门槛：resource_role('note', p_note_id) 非空（设计 §3；v1 无此门，
--      收紧无行为回归：反链面板只在可读页挂载，匿名分享页不渲染反链）
--    - 来源可见：owner 或 workspace 授权（resource_role 查询时现算 → 撤权即时生效，
--      标题/计数同步收敛，不泄露）
--    - 稳定 keyset 游标 (updated_at desc, id desc)；total 每页返回；行形状与 v1 相同
-- ============================================================
create or replace function public.get_note_backlinks_v2(
  p_note_id uuid,
  p_page_size integer default 100,
  p_cursor jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_page_size integer := p_page_size;
  v_cursor_updated timestamptz;
  v_cursor_id uuid;
  v_total integer;
  v_rows jsonb;
  v_last_updated timestamptz;
  v_last_id uuid;
  v_has_more boolean := false;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if v_page_size < 1 or v_page_size > 200 then
    v_page_size := 100;
  end if;
  if p_note_id is null then
    return jsonb_build_object('total', 0, 'rows', '[]'::jsonb, 'next_cursor', null);
  end if;
  if public.resource_role('note', p_note_id) is null then
    raise exception using errcode = '42501', message = 'Note not found or access denied';
  end if;

  if p_cursor is not null then
    begin
      v_cursor_updated := ((p_cursor ->> 'u')::text)::timestamptz;
      v_cursor_id := ((p_cursor ->> 'i')::text)::uuid;
    exception when others then
      raise exception using errcode = '22023', message = 'Invalid cursor';
    end;
  end if;

  select count(*) into v_total
  from public.note_links nl
  join public.notes s on s.id = nl.source_note_id
  where nl.target_type = 'note'
    and nl.target_id = p_note_id
    and s.deleted_at is null
    and s.id <> p_note_id
    and (s.user_id = v_user or public.resource_role('note', s.id) is not null);

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', r.id, 'title', r.title, 'created_at', r.created_at)
      order by r.updated_at desc, r.id desc
    ),
    '[]'::jsonb
  ) into v_rows
  from (
    select s.id, s.title, s.created_at, s.updated_at
    from public.note_links nl
    join public.notes s on s.id = nl.source_note_id
    where nl.target_type = 'note'
      and nl.target_id = p_note_id
      and s.deleted_at is null
      and s.id <> p_note_id
      and (s.user_id = v_user or public.resource_role('note', s.id) is not null)
      and (
        v_cursor_id is null
        or s.updated_at < v_cursor_updated
        or (s.updated_at = v_cursor_updated and s.id < v_cursor_id)
      )
    order by s.updated_at desc, s.id desc
    limit v_page_size
  ) r;

  -- 游标合同：next_cursor = **本页最后一行**的 (updated_at, id)；下一页谓词取
  -- 「严格落后于该键」的行 → 无缝无重（若误用“越过本页首行”作游标，该行自身
  -- 会被严格谓词跳过，产生裂缝）。取尽时**省略 next_cursor 键**：
  -- 响应里没有该键 = 已取尽（JSON null 与键缺失在 jsonb 语义不同，客户端
  -- `->'next_cursor'` 对缺失键得 SQL NULL，可安全判停）。
  select s.updated_at, s.id
  into v_last_updated, v_last_id
  from public.note_links nl
  join public.notes s on s.id = nl.source_note_id
  where nl.target_type = 'note'
    and nl.target_id = p_note_id
    and s.deleted_at is null
    and s.id <> p_note_id
    and (s.user_id = v_user or public.resource_role('note', s.id) is not null)
    and (
      v_cursor_id is null
      or s.updated_at < v_cursor_updated
      or (s.updated_at = v_cursor_updated and s.id < v_cursor_id)
    )
  order by s.updated_at desc, s.id desc
  limit 1 offset v_page_size - 1;

  if v_last_id is not null then
    select exists (
      select 1
      from public.note_links nl
      join public.notes s on s.id = nl.source_note_id
      where nl.target_type = 'note'
        and nl.target_id = p_note_id
        and s.deleted_at is null
        and s.id <> p_note_id
        and (s.user_id = v_user or public.resource_role('note', s.id) is not null)
        and (
          s.updated_at < v_last_updated
          or (s.updated_at = v_last_updated and s.id < v_last_id)
        )
    ) into v_has_more;
  end if;

  if v_has_more then
    return jsonb_build_object(
      'total', v_total,
      'rows', v_rows,
      'next_cursor', jsonb_build_object('u', v_last_updated::text, 'i', v_last_id::text)
    );
  end if;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

revoke all on function public.get_note_backlinks_v2(uuid, integer, jsonb) from public, anon;
grant execute on function public.get_note_backlinks_v2(uuid, integer, jsonb) to authenticated, service_role;
