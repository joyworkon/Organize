-- R05：同步块并发完整性——原子 revision 乐观锁。
-- PATCH 语义收敛到 security definer RPC synced_block_patch：
-- 单条 UPDATE 内完成 expected revision 比较（非 SELECT 后 UPDATE），
-- 冲突时返回服务端当前内容供客户端决策（默认不覆盖远端）。
-- default 1 使既有行与备份恢复行天然获得初值，无需回填；备份导出为显式列清单，合同不变。

alter table synced_blocks
  add column if not exists revision integer not null default 1;

create or replace function public.synced_block_patch(
  p_id uuid,
  p_content jsonb,
  p_expected_revision integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.synced_blocks%rowtype;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if p_expected_revision is null then
    -- 旧客户端兜底：不比较，直接覆盖并递增
    update public.synced_blocks
    set content = p_content, revision = revision + 1
    where id = p_id and user_id = v_user
    returning * into v_row;
  else
    update public.synced_blocks
    set content = p_content, revision = p_expected_revision + 1
    where id = p_id and user_id = v_user and revision = p_expected_revision
    returning * into v_row;
  end if;

  if v_row.id is null then
    -- 未命中：区分「revision 过期（冲突）」与「行不存在/无权（404，不泄露存在性）」
    select * into v_row from public.synced_blocks
    where id = p_id and user_id = v_user;
    if v_row.id is null then
      return jsonb_build_object('status', 'not_found');
    end if;
    return jsonb_build_object(
      'status', 'conflict',
      'current', jsonb_build_object('revision', v_row.revision, 'content', v_row.content)
    );
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'id', v_row.id,
    'content', v_row.content,
    'revision', v_row.revision,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.synced_block_patch(uuid, jsonb, integer) from public;
grant execute on function public.synced_block_patch(uuid, jsonb, integer) to authenticated;
