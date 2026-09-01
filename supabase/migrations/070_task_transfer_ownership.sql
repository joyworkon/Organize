-- 070_task_transfer_ownership.sql
-- P5 收尾：逐域迁移业务行属主（最后独立域 = tasks）——任务属主移交 RPC
--
-- 卡源：ROADMAP P5-02 待办末条「tasks 域是最后的独立卡」+ BLOCKED.md 勘察笔记
-- （2026-08-31）。068 已落 notes 域（transfer_note_ownership + 判定链参数化内核
-- resource_role_for）、069 已落 reading_items 域；本卡复用同一内核做 tasks 域，
-- 完成后逐域属主迁移收尾。
--
-- 产品语义（本卡拍板，与 068/069 同构）：
--   1. 「任务+笔记联转」是唯一语义：task_item_refs 同时以 (task_id, user_id) →
--      tasks(id, user_id) 与 (note_id, user_id) → notes(id, user_id) 复合外键
--      双锚（056）。任务易主但引用它的笔记不易主，引用行立即悬空（FK 拒绝 UPDATE）；
--      引用行删除 = 笔记内容里 taskItem 块的 ID 变成悬空（前端每次保存会把 content
--      里的 taskId 提取成 mutations 撞 conflict_task）。故移动集合 = 目标任务
--      + 全部后代（040 层级复合 FK 强制父子同租户）+ 引用集合内任务的全部笔记；
--      笔记侧再叠加该笔记引用的全部任务（连同它们的后代）——递归闭包。
--   2. 接收人必须已持有「目标任务 + 移动集合内每一篇笔记」的 editor 授权
--      （「先共享后移交」；判定复用 068 抽出的 resource_role_for）。任一资源
--      接收人无 editor 即整体拒绝——不允许「移交过去但部分笔记对方打不开」。
--   3. 显式拒绝（fail-closed，全部明确报错，不静默改数据）：
--      - 调用者不是行属主 / 匿名；
--      - 接收人 = 自己 / 不存在 / 对目标任务或任一涉及笔记无 editor 授权；
--      - 任务在垃圾箱（先恢复）/ 移动集合内任一笔记在垃圾箱；
--      - 移动集合内任一笔记有父页面或子页面（023 validate_note_parent 要求
--        父子同属主，单独搬一层留下跨属主树边；层级整体移交归后续卡）；
--      - 移动集合内任一笔记被集合外任务引用（即「笔记引用的任务」闭包之外的
--        反向引用——该任务没法随迁，断链丢数据）；
--      - 任务依赖边恰好一端在移动集合里（041 要求依赖两端同属主；删边是数据
--        丢失，请先解除依赖再移交）。
--   4. 标签复制而非共享：task_tags / note_tags 行随属主走（RLS 经 tasks/notes
--      join），tag_id 指向的 tags 行是「每用户一份」（001 unique(user_id,name)）。
--      转移时把涉及的全部标签按同名复制到接收人名下（已有同名则复用），关联行
--      重指向；旧属主的原始标签与剩余关联原样保留。
--   5. 评论线程 / 评论 / 建议随笔记转移（user_id → 新属主）：056 复合外键把
--      这三张表的 user_id 钉成租户列，既定合同的取舍，与 068 同。
--   6. 反向引用清理（全部针对非接收人名下的行，否则两侧备份 BROKEN_REFERENCE）：
--      - lessons.task_id / lessons.note_id / highlights.task_id / highlights.note_id
--        → 置空（042 引用列）；
--      - tasks.note_id（集合外任务详情关联了集合内笔记）→ 置空；
--      - db_databases.parent_note_id → 置空；
--      - favorites（target_type='task'/'note'，指向集合内行）→ 删除；
--      - shares（resource_type='note'，指向集合内笔记）→ 删除（旧属主不应
--        继续持有一条指向新属主内容的公开暴露口；tasks 域无公开分享类型）。
--   7. resource_acl 不动：移交后旧属主是否保留访问由既有空间授权决定（通常仍是
--      editor，想彻底退出自行 revoke）；新属主凭行属主身份天然 owner。
--   8. 集合内任务的挂载点：根任务脱离原父任务（parent_task_id → null，056 层级
--      复合外键要求同租户，不脱离就得整棵祖先树搬家）、脱离原任务清单
--      （list_id → null，清单是旧属主的）、reading_item_id → null、note_id 指向
--      集合外笔记的置空（指向集合内笔记的保留）；series_id / source_id 指向集合
--      外任务的置空（重复任务链条不跨界，033 这两列无 FK 但语义上是系列内自
--      引用）；其余子任务保持父子关系随迁。
--   9. 幂等日志 task_mutations（059，复合外键同租户）随转移删除：旧属主在途的
--      离线任务操作回放时得到 not_found 进 dead-letter（可见、可人工处理），
--      这是正确行为而不是丢失。
--  10. 归属列 last_edit_by（066）不写：它回答「谁最后编辑了内容」，移交不是内容
--      编辑；content_revision / content / title 均不变，updated_at 由触发器自然
--      前移。
--
-- 触发器时序：040 层级 / 041 依赖（两个）的校验都是 deferrable constraint trigger，
-- 本 RPC 在同一事务里先 SET CONSTRAINTS ... DEFERRED，把「同一条语句内批量改
-- user_id」的中间态校验推到搬运完成后 SET CONSTRAINTS ... IMMEDIATE 统一执行；
-- 正常路径（单行写入）仍是 initially immediate，行为不变。note 层级（023）不在
-- 推迟名单内——本卡要求涉及笔记无父无子，触发器自然不炸。
--
-- 备份合同 v4 无 schema 变化（不加列不加表）：转移 = 行易主，导出本就按调用者
-- RLS 圈行，语义自洽；pgTAP 侧逐表断言「转移后两侧各自可见集合内无悬空引用」。

-- ============================================================
-- 任务属主移交 RPC
-- ============================================================
create or replace function public.transfer_task_ownership(
  p_task_id uuid,
  p_new_owner uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_task public.tasks%rowtype;
  v_moving_tasks uuid[] := '{}'::uuid[];
  v_moving_notes uuid[] := '{}'::uuid[];
  v_prev_task_count integer := 0;
  v_prev_note_count integer := 0;
  v_tag_count integer := 0;
  v_note_id uuid;
  v_dummy integer;
begin
  if v_user is null then
    raise exception 'anonymous' using errcode = '42501';
  end if;
  if p_task_id is null or p_new_owner is null then
    raise exception 'task id and new owner are required' using errcode = '22023';
  end if;
  if p_new_owner = v_user then
    raise exception 'new owner must be another user' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_new_owner) then
    raise exception 'new owner not found' using errcode = 'P0002';
  end if;

  -- 行锁：与 059 原子更新互斥，转移期间无并发写
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if v_task.user_id <> v_user then
    raise exception 'only the task owner can transfer' using errcode = '42501';
  end if;
  if v_task.deleted_at is not null then
    raise exception 'task is in trash; restore it first' using errcode = '22023';
  end if;

  -- 接收人对目标任务的资格：当前已持有 editor 及以上授权
  if public.resource_role_for('task', p_task_id, p_new_owner) is distinct from 'editor'
     and public.resource_role_for('task', p_task_id, p_new_owner) is distinct from 'owner' then
    raise exception 'recipient must have editor access to this task first'
      using errcode = '22023';
  end if;

  -- 移动集合（任务侧）= 目标任务 + 全部后代（040 复合外键要求父子同租户）
  with recursive tree as (
    select p_task_id as id
    union
    select t.id
      from public.tasks t
      join tree on t.parent_task_id = tree.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_moving_tasks from tree;

  -- 移动集合（笔记侧）的递归闭包：任务→笔记→任务 往返扩到不动点。
  -- PG 不允许递归 CTE 在递归 term 里多次自引用，也不允许两个递归 CTE 互相引用；
  -- 改为在 plpgsql 里用循环 + 数组累计，每轮把新引进的任务/笔记并入集合（去重），
  -- 直到没有新增为止（集合单调递增，必然收敛）。
  loop
    -- 扩 1：被任务集合引用的笔记并入笔记集合
    select coalesce(array_agg(distinct x.id), '{}'::uuid[])
      into v_moving_notes
      from (
        select id from (select unnest(v_moving_notes) as id) s
        union
        select note_id from public.task_item_refs where task_id = any(v_moving_tasks)
      ) x;
    -- 扩 2：被笔记集合引用的任务并入任务集合
    select coalesce(array_agg(distinct x.id), '{}'::uuid[])
      into v_moving_tasks
      from (
        select id from (select unnest(v_moving_tasks) as id) s
        union
        select task_id from public.task_item_refs where note_id = any(v_moving_notes)
      ) x;
    -- 扩 3：被引进任务的后代并入任务集合（040 复合外键要求父子同租户）
    with recursive tree as (
      select id from (select unnest(v_moving_tasks) as id) s
      union
      select t.id from public.tasks t join tree on t.parent_task_id = tree.id
    )
    select coalesce(array_agg(id), '{}'::uuid[]) into v_moving_tasks from tree;

    exit when coalesce(array_length(v_moving_tasks, 1), 0) = v_prev_task_count
          and coalesce(array_length(v_moving_notes, 1), 0) = v_prev_note_count;
    v_prev_task_count := coalesce(array_length(v_moving_tasks, 1), 0);
    v_prev_note_count := coalesce(array_length(v_moving_notes, 1), 0);
  end loop;

  -- 接收人对移动集合内每一篇笔记的资格（先于其他拒绝，避免「移交过去但打不开」）
  foreach v_note_id in array v_moving_notes loop
    if public.resource_role_for('note', v_note_id, p_new_owner) is distinct from 'editor'
       and public.resource_role_for('note', v_note_id, p_new_owner) is distinct from 'owner' then
      raise exception
        'recipient must have editor access to every linked note first'
        using errcode = '22023';
    end if;
  end loop;

  -- 拒绝：移动集合内有笔记在垃圾箱（整组移交，不留半截）
  if exists (
    select 1 from public.notes n
     where n.id = any(v_moving_notes) and n.deleted_at is not null
  ) then
    raise exception 'a linked note is in trash; restore it first'
      using errcode = '22023';
  end if;

  -- 拒绝：移动集合内有任务在垃圾箱（除目标外，子任务也可能在垃圾箱）
  if exists (
    select 1 from public.tasks t
     where t.id = any(v_moving_tasks) and t.deleted_at is not null
  ) then
    raise exception 'a linked task is in trash; restore it first'
      using errcode = '22023';
  end if;

  -- 拒绝：移动集合内有笔记带父页面或子页面（023 触发器要求父子同属主）
  if exists (
    select 1 from public.notes n
     where n.id = any(v_moving_notes) and n.parent_note_id is not null
  ) then
    raise exception 'a linked note has a parent page; move it to top level first'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.notes c
     where c.parent_note_id = any(v_moving_notes)
  ) then
    raise exception 'a linked note has child pages; move them out first'
      using errcode = '22023';
  end if;

  -- 拒绝：移动集合内的笔记被集合外任务引用（反向引用无法随迁）
  if exists (
    select 1 from public.tasks t
     where t.note_id = any(v_moving_notes)
       and t.id <> all(v_moving_tasks)
  ) then
    raise exception
      'a linked note is referenced by an outside task; unbind it there first'
      using errcode = '22023';
  end if;

  -- 拒绝：依赖边恰好一端在移动集合里（041 要求两端同属主；删边是数据丢失）
  if exists (
    select 1 from public.task_dependencies d
     where (d.task_id = any(v_moving_tasks)) <> (d.depends_on_task_id = any(v_moving_tasks))
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

  -- 语句 1：标签复制到接收人名下（同名复用；001 unique(user_id,name)）。
  -- 范围 = 移动集合全部任务的 task_tags + 全部笔记的 note_tags
  insert into public.tags (user_id, name, color)
  select distinct p_new_owner, t.name, t.color
    from public.tags t
   where t.id in (
     select tt.tag_id from public.task_tags tt where tt.task_id = any(v_moving_tasks)
     union
     select nt.tag_id from public.note_tags nt where nt.note_id = any(v_moving_notes)
   )
  on conflict (user_id, name) do nothing;
  get diagnostics v_tag_count = row_count;

  -- 语句 2：一次性搬齐所有同租户绑定（056 复合外键在语句末统一校验）。
  -- 数据修改 CTE 互不重叠：tasks 拆成「移动集合」与「非移动的笔记详情关联」两个
  -- 互斥子集；notes 只动移动集合；其余子表各行其是。
  with
    u_refs as (
      update public.task_item_refs set user_id = p_new_owner
       where task_id = any(v_moving_tasks) or note_id = any(v_moving_notes)
    ),
    u_rem as (
      update public.task_reminders set user_id = p_new_owner
       where task_id = any(v_moving_tasks)
    ),
    u_att as (
      update public.task_attachments set user_id = p_new_owner
       where task_id = any(v_moving_tasks)
    ),
    u_dep as (
      update public.task_dependencies set user_id = p_new_owner
       where task_id = any(v_moving_tasks)
         and depends_on_task_id = any(v_moving_tasks)
    ),
    u_act as (
      update public.task_activities set user_id = p_new_owner
       where task_id = any(v_moving_tasks)
    ),
    u_mut as (
      delete from public.task_mutations where task_id = any(v_moving_tasks)
    ),
    u_fav as (
      delete from public.favorites
       where ((target_type = 'task' and target_id = any(v_moving_tasks))
          or (target_type = 'note' and target_id = any(v_moving_notes)))
         and user_id <> p_new_owner
    ),
    u_share as (
      delete from public.shares
       where resource_type = 'note' and resource_id = any(v_moving_notes)
    ),
    u_hl as (
      update public.highlights
         set note_id = case when note_id = any(v_moving_notes) then null else note_id end,
             task_id = case when task_id = any(v_moving_tasks) then null else task_id end
       where user_id <> p_new_owner
         and (note_id = any(v_moving_notes) or task_id = any(v_moving_tasks))
    ),
    u_les as (
      update public.lessons
         set task_id = case when task_id = any(v_moving_tasks) then null else task_id end,
             note_id = case when note_id = any(v_moving_notes) then null else note_id end
       where user_id <> p_new_owner
         and (task_id = any(v_moving_tasks) or note_id = any(v_moving_notes))
    ),
    u_db as (
      update public.db_databases set parent_note_id = null
       where parent_note_id = any(v_moving_notes)
         and user_id <> p_new_owner
    ),
    u_ttags as (
      update public.task_tags tt
         set tag_id = (
               select b.id from public.tags b
                where b.user_id = p_new_owner
                  and b.name = (select a.name from public.tags a where a.id = tt.tag_id)
             )
       where tt.task_id = any(v_moving_tasks)
    ),
    u_ntags as (
      update public.note_tags nt
         set tag_id = (
               select b.id from public.tags b
                where b.user_id = p_new_owner
                  and b.name = (select a.name from public.tags a where a.id = nt.tag_id)
             )
       where nt.note_id = any(v_moving_notes)
    ),
    u_tasks as (
      update public.tasks
         set user_id = p_new_owner,
             -- 根任务（父不在移动集合）脱离原父；子任务保持父子关系随迁
             parent_task_id = case
               when parent_task_id = any(v_moving_tasks) then parent_task_id
               else null
             end,
             -- 任务详情关联指向集合内笔记的随迁保留，指向集合外笔记的解除
             note_id = case
               when note_id = any(v_moving_notes) then note_id
               else null
             end,
             reading_item_id = null,
             -- 清单是旧属主的个人分组，移交后不挂在别人的清单上
             list_id = null,
             -- 重复任务链条不跨界：指向集合外的来源/系列剪断（无 FK 但语义自引用）
             source_id = case
               when source_id = any(v_moving_tasks) then source_id
               else null
             end,
             series_id = case
               when series_id = any(v_moving_tasks) then series_id
               when series_id = id then series_id  -- 自指（系列首条）保留
               else null
             end
       where id = any(v_moving_tasks)
    ),
    u_notelink as (
      -- 非移动任务里「详情页关联了集合内笔记」的（仍是旧属主名下）：解除关联
      update public.tasks set note_id = null
       where note_id = any(v_moving_notes)
         and id <> all(v_moving_tasks)
    ),
    u_threads as (
      update public.note_comment_threads set user_id = p_new_owner
       where note_id = any(v_moving_notes)
    ),
    u_comments as (
      update public.note_comments c
         set user_id = p_new_owner
       where c.thread_id in (
         select t.id from public.note_comment_threads t where t.note_id = any(v_moving_notes)
       )
    ),
    u_sugg as (
      update public.note_suggestions set user_id = p_new_owner
       where note_id = any(v_moving_notes)
    ),
    u_notes as (
      update public.notes
         set user_id = p_new_owner,
             reading_item_id = null
       where id = any(v_moving_notes)
    )
    -- plpgsql 不允许裸 SELECT：数据修改 CTE 随本语句执行，顶层补一个带目的地的哑查询
    select 1 into v_dummy;

  -- 立即统一校验（层级/依赖 constraint trigger），错误在本函数内浮出并整体回滚
  set constraints public.validate_task_parent_trigger,
                  public.validate_task_dependency_trigger,
                  public.validate_task_dependency_owner_trigger immediate;

  return jsonb_build_object(
    'status', 'ok',
    'tasks_transferred', cardinality(v_moving_tasks),
    'notes_transferred', cardinality(v_moving_notes),
    'tags_copied', v_tag_count
  );
end;
$$;

-- ============================================================
-- 函数 EXECUTE 分层（沿 056 / 063 / 068 / 069 约定）
-- ============================================================
do $$
declare r record;
  client_fn text[] := array['transfer_task_ownership'];
begin
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname::text = any (client_fn)
  loop
    execute format('revoke execute on function public.%I(%s) from public, anon', r.proname, r.args);
    execute format('grant execute on function public.%I(%s) to authenticated, service_role', r.proname, r.args);
  end loop;
end $$;
