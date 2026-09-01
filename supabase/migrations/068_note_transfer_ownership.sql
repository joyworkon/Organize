-- 068_note_transfer_ownership.sql
-- P5 收尾：逐域迁移业务行属主（首域 = notes）——笔记属主移交 RPC
--
-- 卡源：ROADMAP P5-02「逐域迁移业务行属主（含 056 复合外键与 task_item_refs 的同步
-- 改法），一次一个资源域」+ BLOCKED.md 勘察笔记（2026-08-31）。本卡只做 notes 域；
-- reading_items / tasks 的属主转移是后续独立卡。
--
-- 产品语义（本卡拍板，ADR 0002 延伸）：
--   1. 「同转」是唯一语义：笔记引用的任务（task_item_refs）连同任务子树一并转移到
--      新属主名下。不提供「断链」选项——前端每次保存都把 content 里所有带 taskId 的
--      任务块提取成 mutations（lib/task-link.ts），悬空 taskId 会让新属主的每次保存
--      都撞 conflict_task（v2 步骤 3：tasks where user_id = 属主 找不到即冲突），
--      笔记直接存不了；静默删块则是数据丢失。
--   2. 接收人必须已持有该笔记的 editor 授权（「先共享后移交」）：移交是交给一个
--      既有协作者，不是投递给任意账号；同时挡住拿 uuid 瞎试的误操作。判定复用
--      063 判定链——把 resource_role 的实现抽成参数化内核 resource_role_for，
--      resource_role 变成 auth.uid() 的薄委托（单一判定实现，064/065 消费方不变）。
--   3. 显式拒绝（fail-closed，全部是明确报错，不静默改数据）：
--      - 调用者不是行属主 / 匿名；
--      - 接收人 = 自己 / 不存在 / 无 editor 及以上授权；
--      - 笔记在垃圾箱（先恢复）；
--      - 笔记有父页面或子页面（023 validate_note_parent 要求父子同属主，单独转移
--        一层会留下跨属主的树边；层级整体移交归后续卡）；
--      - 移动集合里有任务被本笔记之外的笔记引用（056 复合外键下该引用行没法跟着
--        搬，断链又丢数据）；
--      - 任务依赖边恰好一端在移动集合里（041 要求依赖两端同属主；删边是数据丢失，
--        请先解除依赖再移交）。
--   4. 标签复制而非共享：task_tags / note_tags 行跟随属主（RLS 经 tasks/notes join），
--      但 tag_id 指向的 tags 行是「每用户一份」（001 unique(user_id,name)）。若不处理，
--      转移后两侧的备份导出都会因引用别人 tag 而 BROKEN_REFERENCE。转移时把涉及的
--      标签按同名复制到接收人名下（接收人已有同名标签则复用），关联行重指向；
--      旧属主的原始标签与剩余关联原样保留。
--   5. 评论线程 / 评论 / 建议随笔记转移（user_id → 新属主）：056 的复合外键把这三张
--      表的 user_id 钉成「租户列」（(note_id,user_id)/(thread_id,user_id) 同租户），
--      不搬则复合外键直接炸；搬则作者列语义按租户解释。这是 056 合同的既定取舍，
--      不是本卡新引入的归因失真。
--   6. 反向引用清理（全部针对非接收人名下的行，否则两侧备份引用校验断）：
--      - lessons.task_id / lessons.note_id、highlights.note_id / highlights.task_id、
--        tasks.note_id（任务详情关联）、db_databases.parent_note_id、favorites（收藏）
--        → 置空 / 删除；
--      - notes.reading_item_id、移动任务的 tasks.reading_item_id → 置空（reading_items
--        域不在本卡转移，悬空引用不留）；
--      - shares（公开链接）→ 删除：移交后旧属主不应继续持有一条指向新属主内容的
--        公开暴露口；shares 本就不进备份合同。
--   7. resource_acl 不动：移交后旧属主是否保留访问由既有空间授权决定（通常仍是
--      editor，想彻底退出自行 revoke）；新属主凭行属主身份天然 owner。公开授权、
--      空间成员关系均不变。
--   8. 移动任务的挂载点：根任务脱离原父任务（parent_task_id → null，056 层级复合
--      外键要求同租户，不脱离就得整棵祖先树搬家）、脱离原任务清单（list_id → null，
--      清单是旧属主的）、reading_item_id → null；其余子任务保持父子关系随迁。
--   9. 幂等日志 task_mutations（059，复合外键同租户）随转移删除：旧属主在途的离线
--      任务操作回放时得到 not_found 进 dead-letter（可见、可人工处理），这是正确
--      行为而不是丢失。
--  10. 归属列 last_edit_by（066）不写：它回答「谁最后编辑了内容」，移交不是内容
--      编辑；content_revision / content / title 均不变，updated_at 由触发器自然
--      前移（会让 067 的 ydoc blob 失效一次，下次打开按 notes.content 重新播种，
--      内容无损）。
--
-- 触发器时序：056 之后的层级/依赖校验都是 deferrable constraint trigger（040/041），
-- 本 RPC 在同一事务里先 SET CONSTRAINTS ... DEFERRED，把「同一条语句内批量改
-- user_id」的中间态校验推到搬运完成后 SET CONSTRAINTS ... IMMEDIATE 统一执行；
-- 正常路径（单行写入）仍是 initially immediate，行为不变。
--
-- 备份合同 v4 无 schema 变化（不加列不加表）：转移 = 行易主，导出本就按调用者
-- RLS 圈行，语义自洽；pgTAP 侧逐表断言「转移后两侧各自可见集合内无悬空引用」。

-- ============================================================
-- 1. 判定链参数化内核：resource_role_for（internal，service_role 专用）
-- ============================================================
-- 接受任意 user_id 的服务端判定入口。对客户端不开放的理由同 resource_owner：
-- 直调等于拿到「探测指定用户对任意资源的授权」的 oracle。
create or replace function public.resource_role_for(
  p_resource_type text,
  p_resource_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
begin
  if p_user_id is null or p_resource_id is null then
    return null;
  end if;

  if public.resource_owner(p_resource_type, p_resource_id) is null then
    return null;                       -- 资源不存在或类型未知，一律视为无权限
  end if;
  if public.resource_owner(p_resource_type, p_resource_id) = p_user_id then
    return 'owner';
  end if;

  select case
           when bool_or(a.access_role = 'owner') then 'owner'
           when bool_or(a.access_role = 'editor') then 'editor'
           when bool_or(a.access_role = 'viewer') then 'viewer'
         end
    into v_role
    from public.resource_acl a
    join public.workspace_members m
      on m.workspace_id = a.workspace_id and m.user_id = p_user_id
   where a.resource_type = p_resource_type
     and a.resource_id = p_resource_id;

  return v_role;
end;
$$;

-- 对外判定函数保持签名与语义不变，改为委托同一实现（单一判定链）
create or replace function public.resource_role(p_resource_type text, p_resource_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  return public.resource_role_for(p_resource_type, p_resource_id, auth.uid());
end;
$$;

-- ============================================================
-- 2. 笔记属主移交 RPC
-- ============================================================
create or replace function public.transfer_note_ownership(
  p_note_id uuid,
  p_new_owner uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_note public.notes%rowtype;
  v_new_role text;
  v_moving uuid[] := '{}'::uuid[];
  v_tag_count integer := 0;
  v_dummy integer;
begin
  if v_user is null then
    raise exception 'anonymous' using errcode = '42501';
  end if;
  if p_note_id is null or p_new_owner is null then
    raise exception 'note id and new owner are required' using errcode = '22023';
  end if;
  if p_new_owner = v_user then
    raise exception 'new owner must be another user' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_new_owner) then
    raise exception 'new owner not found' using errcode = 'P0002';
  end if;

  -- 行锁：与原子保存 RPC 的 for update 互斥，转移期间无并发写
  select * into v_note from public.notes where id = p_note_id for update;
  if not found then
    raise exception 'note not found' using errcode = 'P0002';
  end if;
  if v_note.user_id <> v_user then
    raise exception 'only the note owner can transfer' using errcode = '42501';
  end if;
  if v_note.deleted_at is not null then
    raise exception 'note is in trash; restore it first' using errcode = '22023';
  end if;

  -- 接收人资格：当前已持有 editor 及以上授权（063 判定链参数化内核）
  v_new_role := public.resource_role_for('note', p_note_id, p_new_owner);
  if v_new_role is null or (v_new_role <> 'editor' and v_new_role <> 'owner') then
    raise exception 'recipient must have editor access to this note first'
      using errcode = '22023';
  end if;

  -- 页面结构：仅顶层、无子页面的笔记可移交（023 触发器要求父子同属主）
  if v_note.parent_note_id is not null then
    raise exception 'note has a parent page; move it to top level first'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.notes c where c.parent_note_id = p_note_id
  ) then
    raise exception 'note has child pages; move them out first'
      using errcode = '22023';
  end if;

  -- 移动集合 = 笔记引用的任务 + 全部后代（040 层级复合外键要求父子同租户）。
  -- 祖先链刻意不跟随：移动根脱离原父任务，避免「移交一篇笔记」放大成整棵任务树搬家。
  with recursive tree as (
    select r.task_id as id
      from public.task_item_refs r
     where r.note_id = p_note_id
    union
    select t.id
      from public.tasks t
      join tree on t.parent_task_id = tree.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_moving from tree;

  -- 拒绝：移动集合里的任务被其他笔记引用（引用行无法同租户随迁，断链丢数据）
  if exists (
    select 1 from public.task_item_refs r
     where r.task_id = any(v_moving)
       and r.note_id <> p_note_id
  ) then
    raise exception
      'a linked task is also referenced by another note; unbind it there first'
      using errcode = '22023';
  end if;

  -- 拒绝：依赖边跨越移动边界（041 要求依赖两端同属主；删边是数据丢失）
  if exists (
    select 1 from public.task_dependencies d
     where (d.task_id = any(v_moving)) <> (d.depends_on_task_id = any(v_moving))
  ) then
    raise exception
      'a task dependency crosses the transfer boundary; remove it first'
      using errcode = '22023';
  end if;

  -- 同一事务内推迟层级/依赖校验（040/041 的 deferrable constraint trigger）：
  -- 同语句批量改 user_id 的中间态不再逐行触发，搬运完成后统一立即校验
  set constraints public.validate_task_parent_trigger,
                  public.validate_task_dependency_trigger,
                  public.validate_task_dependency_owner_trigger deferred;

  -- 语句 1：标签复制到接收人名下（同名复用；001 unique(user_id,name)）
  insert into public.tags (user_id, name, color)
  select distinct p_new_owner, t.name, t.color
    from public.tags t
   where t.id in (
     select nt.tag_id from public.note_tags nt where nt.note_id = p_note_id
     union
     select tt.tag_id from public.task_tags tt where tt.task_id = any(v_moving)
   )
  on conflict (user_id, name) do nothing;
  get diagnostics v_tag_count = row_count;

  -- 语句 2：一次性搬齐所有同租户绑定（056 复合外键在语句末统一校验）。
  -- 数据修改 CTE 互不重叠：tasks 拆成「移动集合」与「非移动的任务详情关联」两个互斥子集。
  with
    u_refs as (
      update public.task_item_refs set user_id = p_new_owner
       where note_id = p_note_id
    ),
    u_rem as (
      update public.task_reminders set user_id = p_new_owner
       where task_id = any(v_moving)
    ),
    u_att as (
      update public.task_attachments set user_id = p_new_owner
       where task_id = any(v_moving)
    ),
    u_dep as (
      update public.task_dependencies set user_id = p_new_owner
       where task_id = any(v_moving)
         and depends_on_task_id = any(v_moving)
    ),
    u_act as (
      update public.task_activities set user_id = p_new_owner
       where task_id = any(v_moving)
    ),
    u_mut as (
      delete from public.task_mutations where task_id = any(v_moving)
    ),
    u_fav as (
      delete from public.favorites
       where target_type = 'note'
         and target_id = p_note_id
         and user_id <> p_new_owner
    ),
    u_share as (
      delete from public.shares
       where resource_type = 'note' and resource_id = p_note_id
    ),
    u_hl as (
      update public.highlights
         set note_id = case when note_id = p_note_id then null else note_id end,
             task_id = case when task_id = any(v_moving) then null else task_id end
       where user_id <> p_new_owner
         and (note_id = p_note_id or task_id = any(v_moving))
    ),
    u_les as (
      update public.lessons
         set task_id = case when task_id = any(v_moving) then null else task_id end,
             note_id = case when note_id = p_note_id then null else note_id end
       where user_id <> p_new_owner
         and (task_id = any(v_moving) or note_id = p_note_id)
    ),
    u_db as (
      update public.db_databases set parent_note_id = null
       where parent_note_id = p_note_id
         and user_id <> p_new_owner
    ),
    u_ntags as (
      update public.note_tags nt
         set tag_id = (
               select b.id from public.tags b
                where b.user_id = p_new_owner
                  and b.name = (select a.name from public.tags a where a.id = nt.tag_id)
             )
       where nt.note_id = p_note_id
    ),
    u_ttags as (
      update public.task_tags tt
         set tag_id = (
               select b.id from public.tags b
                where b.user_id = p_new_owner
                  and b.name = (select a.name from public.tags a where a.id = tt.tag_id)
             )
       where tt.task_id = any(v_moving)
    ),
    u_tasks as (
      update public.tasks
         set user_id = p_new_owner,
             -- 根任务（父不在移动集合）脱离原父；子任务保持父子关系随迁
             parent_task_id = case
               when parent_task_id = any(v_moving) then parent_task_id
               else null
             end,
             -- 任务详情关联指向本笔记的随迁保留，指向别人的笔记的解除
             note_id = case
               when note_id = p_note_id then note_id
               else null
             end,
             reading_item_id = null,
             -- 清单是旧属主的个人分组，移交后不挂在别人的清单上
             list_id = null
       where id = any(v_moving)
    ),
    u_notelink as (
      -- 非移动任务里「详情页关联了本笔记」的（仍是旧属主名下）：解除关联
      update public.tasks set note_id = null
       where note_id = p_note_id
         and id <> all(v_moving)
    ),
    u_threads as (
      update public.note_comment_threads set user_id = p_new_owner
       where note_id = p_note_id
    ),
    u_comments as (
      update public.note_comments c
         set user_id = p_new_owner
       where c.thread_id in (
         select t.id from public.note_comment_threads t where t.note_id = p_note_id
       )
    ),
    u_sugg as (
      update public.note_suggestions set user_id = p_new_owner
       where note_id = p_note_id
    ),
    u_note as (
      update public.notes
         set user_id = p_new_owner,
             reading_item_id = null
       where id = p_note_id
    )
    -- plpgsql 不允许裸 SELECT：数据修改 CTE 随本语句执行，顶层补一个带目的地的哑查询
    select 1 into v_dummy;

  -- 立即统一校验（层级/依赖 constraint trigger），错误在本函数内浮出并整体回滚
  set constraints public.validate_task_parent_trigger,
                  public.validate_task_dependency_trigger,
                  public.validate_task_dependency_owner_trigger immediate;

  return jsonb_build_object(
    'status', 'ok',
    'tasks_transferred', cardinality(v_moving),
    'tags_copied', v_tag_count
  );
end;
$$;

-- ============================================================
-- 3. 函数 EXECUTE 分层（沿 056 / 063 / 065 约定）
-- ============================================================
do $$
declare r record;
  client_fn text[] := array['transfer_note_ownership'];
  internal_only text[] := array['resource_role_for'];
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname::text = any (client_fn || internal_only)
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
    if r.proname::text = any (internal_only) then
      -- 接受任意 user_id + 资源 id，客户端直调等于拿到「探测任意用户授权」的 oracle
      execute format('revoke execute on function public.%I(%s) from authenticated', r.proname, r.args);
      execute format('grant execute on function public.%I(%s) to service_role', r.proname, r.args);
    else
      execute format('grant execute on function public.%I(%s) to authenticated, service_role', r.proname, r.args);
    end if;
  end loop;
end $$;
