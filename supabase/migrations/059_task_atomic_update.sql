-- 059: 任务原子变更协议（P1-03）
-- 在线与离线的任务字段更新统一走 update_task_atomic：
-- - 携带 p_expected_sync_version 做乐观并发校验（版本不符 → conflict，双设备冲突可见）；
-- - 携带 p_mutation_id 做幂等（响应丢失后的重放 → already_applied，不会二次应用）；
-- - 应用成功 sync_version + 1（其余直写路径若绕过本 RPC，只会造成其他客户端的
--   「假冲突→刷新重试」，方向安全，绝不会漏检冲突）。
-- task_mutations 是同步管道的内部日志（幂等键），非用户数据：
-- 不入备份合同（同 plugins/shares 的排除口径），软删除不适用，仅 insert/select。

create table if not exists public.task_mutations (
  user_id uuid not null references auth.users on delete cascade,
  mutation_id uuid not null,
  task_id uuid,
  created_at timestamptz default now() not null,
  primary key (user_id, mutation_id)
);

-- 父子同租户（P0-02 约定）：日志行必须挂在同租户任务上；任务被硬删则日志级联消失
alter table public.task_mutations drop constraint if exists task_mutations_task_same_tenant;
alter table public.task_mutations
  add constraint task_mutations_task_same_tenant
  foreign key (task_id, user_id) references public.tasks (id, user_id)
  on delete cascade;

alter table public.task_mutations enable row level security;

drop policy if exists "Users can select own task mutations" on public.task_mutations;
create policy "Users can select own task mutations" on public.task_mutations
  for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own task mutations" on public.task_mutations;
create policy "Users can insert own task mutations" on public.task_mutations
  for insert with check (auth.uid() = user_id);

grant select, insert on public.task_mutations to authenticated;
grant all on public.task_mutations to service_role;

create or replace function public.update_task_atomic(
  p_task_id uuid,
  p_patch jsonb,
  p_expected_sync_version integer default null,
  p_mutation_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_new_version integer;
  v_current_version integer;
  v_task_exists boolean;
begin
  if v_user is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_task_id is null or p_patch is null then
    raise exception 'task_id and patch are required' using errcode = '22023';
  end if;

  -- 幂等：同一 mutation 已应用过则直接确认（先于版本校验——重放时版本必然已前进）
  if p_mutation_id is not null then
    if exists (
      select 1 from public.task_mutations
      where user_id = v_user and mutation_id = p_mutation_id
    ) then
      return jsonb_build_object('status', 'already_applied');
    end if;
  end if;

  -- 校验与写入合并为一条 UPDATE（行锁内完成版本比较，天然原子）
  update public.tasks t set
    title              = case when p_patch ? 'title'              then p_patch->>'title'                              else t.title end,
    description        = case when p_patch ? 'description'        then p_patch->>'description'                        else t.description end,
    status             = case when p_patch ? 'status'             then p_patch->>'status'                             else t.status end,
    priority           = case when p_patch ? 'priority'           then p_patch->>'priority'                           else t.priority end,
    category           = case when p_patch ? 'category'           then p_patch->>'category'                           else t.category end,
    due_date           = case when p_patch ? 'due_date'           then (p_patch->>'due_date')::timestamptz            else t.due_date end,
    estimated_minutes  = case when p_patch ? 'estimated_minutes'  then (p_patch->>'estimated_minutes')::integer       else t.estimated_minutes end,
    actual_minutes     = case when p_patch ? 'actual_minutes'     then (p_patch->>'actual_minutes')::integer          else t.actual_minutes end,
    reading_item_id    = case when p_patch ? 'reading_item_id'    then (p_patch->>'reading_item_id')::uuid            else t.reading_item_id end,
    note_id            = case when p_patch ? 'note_id'            then (p_patch->>'note_id')::uuid                    else t.note_id end,
    is_pinned          = case when p_patch ? 'is_pinned'          then (p_patch->>'is_pinned')::boolean               else t.is_pinned end,
    completed_at       = case when p_patch ? 'completed_at'       then (p_patch->>'completed_at')::timestamptz        else t.completed_at end,
    sort_order         = case when p_patch ? 'sort_order'         then (p_patch->>'sort_order')::integer              else t.sort_order end,
    list_id            = case when p_patch ? 'list_id'            then (p_patch->>'list_id')::uuid                    else t.list_id end,
    schedule_start_at  = case when p_patch ? 'schedule_start_at'  then (p_patch->>'schedule_start_at')::timestamptz   else t.schedule_start_at end,
    schedule_end_at    = case when p_patch ? 'schedule_end_at'    then (p_patch->>'schedule_end_at')::timestamptz     else t.schedule_end_at end,
    all_day            = case when p_patch ? 'all_day'            then (p_patch->>'all_day')::boolean                 else t.all_day end,
    timezone           = case when p_patch ? 'timezone'           then p_patch->>'timezone'                           else t.timezone end,
    recurrence_rule    = case when p_patch ? 'recurrence_rule'    then p_patch->'recurrence_rule'                     else t.recurrence_rule end,
    series_id          = case when p_patch ? 'series_id'          then (p_patch->>'series_id')::uuid                  else t.series_id end,
    source_id          = case when p_patch ? 'source_id'          then (p_patch->>'source_id')::uuid                  else t.source_id end,
    reference_managed  = case when p_patch ? 'reference_managed'  then (p_patch->>'reference_managed')::boolean       else t.reference_managed end,
    sync_version       = t.sync_version + 1,
    updated_at         = now()
  where t.id = p_task_id
    and t.user_id = v_user
    and t.deleted_at is null
    and (p_expected_sync_version is null or t.sync_version = p_expected_sync_version)
  returning t.sync_version into v_new_version;

  if v_new_version is not null then
    if p_mutation_id is not null then
      insert into public.task_mutations (user_id, mutation_id, task_id)
      values (v_user, p_mutation_id, p_task_id)
      on conflict (user_id, mutation_id) do nothing;
    end if;
    return jsonb_build_object('status', 'applied', 'sync_version', v_new_version);
  end if;

  -- 未命中：区分「任务不存在/不可见」与「版本冲突」
  select true, t.sync_version into v_task_exists, v_current_version
  from public.tasks t
  where t.id = p_task_id and t.user_id = v_user and t.deleted_at is null;
  if v_task_exists then
    return jsonb_build_object('status', 'conflict', 'current_sync_version', v_current_version);
  end if;
  return jsonb_build_object('status', 'not_found');
end;
$$;

-- P0-02 约定：函数默认 PUBLIC EXECUTE，必须收回并按角色分层
revoke all on function public.update_task_atomic(uuid, jsonb, integer, uuid) from public;
revoke all on function public.update_task_atomic(uuid, jsonb, integer, uuid) from anon;
grant execute on function public.update_task_atomic(uuid, jsonb, integer, uuid) to authenticated, service_role;
