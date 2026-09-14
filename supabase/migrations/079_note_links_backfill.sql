-- B03 / R10b 第二步：note_links 回填与对账（设计 docs/note-relations-index-design.md §5）。
--
-- 078 之后新写维护已由触发器生效，但存量笔记的边尚未建立。本迁移提供两个
-- service_role 专用批处理函数（运维脚本驱动，非客户端接口）：
--   1. rebuild_note_links_batch：按 notes.id keyset 分批，对每行跑与触发器同一套
--      diff 逻辑。幂等（重跑零变化），可与线上写入并存（触发器已维护的行收敛不变）。
--   2. reconcile_note_links：只读对账——重算期望边集与现存集对比，报告漂移计数与
--      样本。切读门槛（设计 §5）：全量对账连续两轮 mismatched = 0。
--
-- 两者都不触碰 notes.content；与 074/v1、078 触发器无耦合顺序要求。

-- ============================================================
-- 1. 分批回填
-- ============================================================
create or replace function public.rebuild_note_links_batch(
  p_batch_size integer default 500,
  p_after uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_processed integer := 0;
  v_last_id uuid := p_after;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 5000 then
    p_batch_size := 500;
  end if;

  for v_row in
    select n.id, n.content
    from public.notes n
    where (p_after is null or n.id > p_after)
    order by n.id
    limit p_batch_size
  loop
    delete from public.note_links nl
    where nl.source_note_id = v_row.id
      and not exists (
        select 1
        from public.note_links_extract(v_row.content) e
        where e.target_type = nl.target_type
          and e.target_id = nl.target_id
      );

    insert into public.note_links (source_note_id, target_type, target_id, href)
    select v_row.id, e.target_type, e.target_id, e.href
    from public.note_links_extract(v_row.content) e
    on conflict (source_note_id, target_type, target_id) do nothing;

    v_processed := v_processed + 1;
    v_last_id := v_row.id;
  end loop;

  return jsonb_build_object('processed', v_processed, 'last_id', v_last_id);
end;
$$;

-- ============================================================
-- 2. 只读对账
-- ============================================================
create or replace function public.reconcile_note_links(
  p_batch_size integer default 500,
  p_after uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row record;
  v_checked integer := 0;
  v_mismatched integer := 0;
  v_last_id uuid := p_after;
  v_sample jsonb := '[]'::jsonb;
  v_drift_extra boolean;
  v_drift_missing boolean;
begin
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 5000 then
    p_batch_size := 500;
  end if;

  for v_row in
    select n.id, n.content
    from public.notes n
    where (p_after is null or n.id > p_after)
    order by n.id
    limit p_batch_size
  loop
    select
      exists (
        select 1
        from (
          select target_type, target_id from public.note_links
          where source_note_id = v_row.id
          except
          select target_type, target_id from public.note_links_extract(v_row.content)
        ) d
      ),
      exists (
        select 1
        from (
          select target_type, target_id from public.note_links_extract(v_row.content)
          except
          select target_type, target_id from public.note_links
          where source_note_id = v_row.id
        ) d
      )
    into v_drift_extra, v_drift_missing;

    if v_drift_extra or v_drift_missing then
      v_mismatched := v_mismatched + 1;
      if v_mismatched <= 20 then
        v_sample := v_sample || jsonb_build_object(
          'note_id', v_row.id,
          'extra_edges', v_drift_extra,
          'missing_edges', v_drift_missing
        );
      end if;
    end if;

    v_checked := v_checked + 1;
    v_last_id := v_row.id;
  end loop;

  return jsonb_build_object(
    'checked', v_checked,
    'mismatched', v_mismatched,
    'last_id', v_last_id,
    'sample', v_sample
  );
end;
$$;

revoke all on function public.rebuild_note_links_batch(integer, uuid) from public, anon, authenticated;
revoke all on function public.reconcile_note_links(integer, uuid) from public, anon, authenticated;
grant execute on function public.rebuild_note_links_batch(integer, uuid) to service_role;
grant execute on function public.reconcile_note_links(integer, uuid) to service_role;
