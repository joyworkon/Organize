-- 062 修复恢复静默丢数据（P2-03 恢复演练发现）
--
-- 演练逐表核对发现三类恢复丢失，全部源于 DB 端 restore 链：
--   1. notes 页面字段（icon / cover_url / cover_position / parent_note_id）：
--      024–027 的 restore_backup_v2_with_pages 在基础插入后回填这些列，
--      033 为任务工作台重写该函数时把回填丢掉，034 再次重写仍未补回 →
--      恢复后笔记层级断裂、图标/封面丢失。
--   2. synced_blocks：027 起随 with_pages 恢复，同样在 033 重写时丢失 →
--      笔记正文里的 syncedId 引用指向不存在的行。
--   3. db_databases / db_rows：028 建表后从未接入恢复链，而客户端
--      BACKUP_TABLES 与导出/重映射均包含两表 → 数据库块恢复时整体消失。
--
-- 修复：重定义 restore_backup_v2_with_pages = 034 原有任务工作台表逻辑
-- + 027 的笔记页面回填 + 027 的 synced_blocks 插入 + 新增 db 两表插入。
-- 页面字段仍走「基础插入后回填」模式（parent_note_id 是自引用外键，
-- 且回填不改 content/title，不会触发版本快照触发器）。
-- counts 报告补齐三处，与实际写入一致（沿用 058 的实数口径）。

create or replace function public.restore_backup_v2_with_pages(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  restore_result jsonb;
  target_user uuid := auth.uid();
begin
  if target_user is null then
    return jsonb_build_object('status', 'error', 'message', '未授权');
  end if;

  restore_result := public.restore_backup_v2(p_payload);
  if (restore_result->>'status') = 'not_empty' or (restore_result->>'status') = 'error' then
    return restore_result;
  end if;

  -- 笔记页面字段回填（基础函数不含这些列；老备份缺键时为 NULL，等价默认值）
  update public.notes note
  set
    icon = page.icon,
    cover_url = page.cover_url,
    cover_position = coalesce(page.cover_position, 50),
    parent_note_id = page.parent_note_id
  from jsonb_to_recordset(p_payload->'data'->'notes') as page(
    id uuid,
    icon text,
    cover_url text,
    cover_position smallint,
    parent_note_id uuid
  )
  where note.id = page.id
    and note.user_id = target_user;

  -- 同步区块（可选，仅新备份含；正文内 syncedId 已由客户端重映射）
  if jsonb_typeof(p_payload->'data'->'synced_blocks') = 'array' then
    insert into public.synced_blocks (id, user_id, content, created_at, updated_at)
    select row.id, target_user, row.content, row.created_at, row.updated_at
    from jsonb_to_recordset(p_payload->'data'->'synced_blocks') as row(
      id uuid, content jsonb, created_at timestamptz, updated_at timestamptz
    ) on conflict (id) do nothing;
  end if;

  -- 数据库块（可选；parent_note_id / database_id 已由客户端重映射，
  -- 基础函数先落了 notes，外键顺序安全）
  if jsonb_typeof(p_payload->'data'->'db_databases') = 'array' then
    insert into public.db_databases (
      id, user_id, parent_note_id, title, icon, "schema", views, created_at, updated_at
    )
    select
      row.id, target_user, row.parent_note_id, coalesce(row.title, ''), row.icon,
      coalesce(row."schema", '[]'::jsonb),
      coalesce(row.views, '[{"id":"default_view","type":"table","config":{}}]'::jsonb),
      row.created_at, row.updated_at
    from jsonb_to_recordset(p_payload->'data'->'db_databases') as row(
      id uuid, parent_note_id uuid, title text, icon text,
      "schema" jsonb, views jsonb, created_at timestamptz, updated_at timestamptz
    ) on conflict (id) do nothing;
  end if;
  if jsonb_typeof(p_payload->'data'->'db_rows') = 'array' then
    insert into public.db_rows (
      id, user_id, database_id, sort, "values", created_at, updated_at
    )
    select
      row.id, target_user, row.database_id, coalesce(row.sort, 0),
      coalesce(row."values", '{}'::jsonb), row.created_at, row.updated_at
    from jsonb_to_recordset(p_payload->'data'->'db_rows') as row(
      id uuid, database_id uuid, sort int, "values" jsonb,
      created_at timestamptz, updated_at timestamptz
    ) on conflict (id) do nothing;
  end if;

  -- ── 以下保持 034 原有逻辑：033 任务工作台表 + 034 倒数日 ──
  if jsonb_typeof(p_payload->'data'->'task_lists') = 'array' then
    insert into public.task_lists (id, user_id, name, icon, color, sort_order, is_default, created_at, updated_at)
    select row.id, target_user, row.name, row.icon, row.color, row.sort_order, coalesce(row.is_default, false), row.created_at, row.updated_at
    from jsonb_to_recordset(p_payload->'data'->'task_lists') as row(
      id uuid, name text, icon text, color text, sort_order int, is_default boolean, created_at timestamptz, updated_at timestamptz
    ) on conflict (id) do nothing;
  end if;
  if jsonb_typeof(p_payload->'data'->'task_reminders') = 'array' then
    insert into public.task_reminders (id, user_id, task_id, anchor, offset_minutes, notified_at, created_at)
    select row.id, target_user, row.task_id, row.anchor, row.offset_minutes, row.notified_at, row.created_at
    from jsonb_to_recordset(p_payload->'data'->'task_reminders') as row(
      id uuid, task_id uuid, anchor text, offset_minutes int, notified_at timestamptz, created_at timestamptz
    ) on conflict (id) do nothing;
  end if;
  if jsonb_typeof(p_payload->'data'->'task_attachments') = 'array' then
    insert into public.task_attachments (id, user_id, task_id, name, bucket, path, mime_type, size_bytes, created_at)
    select row.id, target_user, row.task_id, row.name, coalesce(row.bucket, 'attachments'), row.path, row.mime_type, row.size_bytes, row.created_at
    from jsonb_to_recordset(p_payload->'data'->'task_attachments') as row(
      id uuid, task_id uuid, name text, bucket text, path text, mime_type text, size_bytes bigint, created_at timestamptz
    ) on conflict (id) do nothing;
  end if;
  if jsonb_typeof(p_payload->'data'->'task_activities') = 'array' then
    insert into public.task_activities (id, user_id, task_id, action, detail, created_at)
    select row.id, target_user, row.task_id, row.action, row.detail, row.created_at
    from jsonb_to_recordset(p_payload->'data'->'task_activities') as row(
      id uuid, task_id uuid, action text, detail jsonb, created_at timestamptz
    ) on conflict (id) do nothing;
  end if;
  if jsonb_typeof(p_payload->'data'->'task_templates') = 'array' then
    insert into public.task_templates (id, user_id, name, template, created_at, updated_at)
    select row.id, target_user, row.name, row.template, row.created_at, row.updated_at
    from jsonb_to_recordset(p_payload->'data'->'task_templates') as row(
      id uuid, name text, template jsonb, created_at timestamptz, updated_at timestamptz
    ) on conflict (id) do nothing;
  end if;
  if jsonb_typeof(p_payload->'data'->'countdown_days') = 'array' then
    insert into public.countdown_days (id, user_id, title, target_date, repeat_annually, deleted_at, created_at, updated_at)
    select row.id, target_user, row.title, row.target_date, coalesce(row.repeat_annually, false), row.deleted_at, row.created_at, row.updated_at
    from jsonb_to_recordset(p_payload->'data'->'countdown_days') as row(
      id uuid, title text, target_date date, repeat_annually boolean, deleted_at timestamptz,
      created_at timestamptz, updated_at timestamptz
    ) on conflict (id) do nothing;
  end if;

  restore_result := jsonb_set(restore_result, '{counts,synced_blocks}',
    to_jsonb((select count(*) from public.synced_blocks where user_id = target_user)));
  restore_result := jsonb_set(restore_result, '{counts,db_databases}',
    to_jsonb((select count(*) from public.db_databases where user_id = target_user)));
  restore_result := jsonb_set(restore_result, '{counts,db_rows}',
    to_jsonb((select count(*) from public.db_rows where user_id = target_user)));

  return restore_result;
end;
$$;

revoke all on function public.restore_backup_v2_with_pages(jsonb) from public;
grant execute on function public.restore_backup_v2_with_pages(jsonb) to authenticated;
