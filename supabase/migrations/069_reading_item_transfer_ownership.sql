-- 069_reading_item_transfer_ownership.sql
-- P5 收尾：逐域迁移业务行属主（第二域 = reading_items）——阅读条目属主移交 RPC
--
-- 卡源：ROADMAP P5-02 待办「逐域迁移业务行属主（一次一个资源域）」；068 已落地 notes
-- 域（transfer_note_ownership + 判定链参数化内核 resource_role_for），本卡复用同一
-- 内核做 reading_items 域。tasks 域仍是后续独立卡。
--
-- 产品语义（与 068 同构，按 reading_items 域的实际形状裁剪）：
--   1. 「同转」是唯一语义，且在本域是结构强制的：highlights.reading_item_id 是
--      NOT NULL 外键（014），高亮行要么随条目易主、要么删除——置空不存在，删除
--      是丢数据。故挂在本条目上的全部高亮随迁到接收人名下（与 068 评论随笔记
--      同一取舍）；随迁行上指向「非接收人名下」笔记/任务的 note_id/task_id
--      （042 引用列）顺手置空，不让转移后的行悬空引用旧属主的内容。
--   2. 接收人必须已持有该条目的 editor 授权（「先共享后移交」，防误移交 + uuid
--      试探）；判定复用 063 判定链的参数化内核 resource_role_for（068 抽出），
--      不重写等价 SQL。
--   3. 显式拒绝（fail-closed，全部明确报错）：匿名；条目 id / 接收人为空；自移自；
--      接收人不存在；调用者不是行属主；条目在垃圾箱（先恢复）。reading_items
--      没有父子页面结构、没有任务树、没有依赖边——notes 域的对应拒绝类在本域
--      结构上不存在，无需对应分支。
--   4. 标签复制而非共享：item_tags 行经 RLS 随条目走（RLS 经 reading_items join），
--      但 tag_id 指向的 tags 行是「每用户一份」（001 unique(user_id,name)）。
--      转移时把条目上的标签按同名复制到接收人名下（已有同名则复用），item_tags
--      重指向；旧属主的原始标签与剩余关联原样保留。
--   5. 反向引用清理（全部针对非接收人名下的行，否则两侧备份导出 BROKEN_REFERENCE）：
--      - notes.reading_item_id / tasks.reading_item_id / lessons.reading_item_id
--        → 置空（三处都是普通外键，行留在旧属主名下但指向的条目已易主）；
--      - favorites（target_type='reading'）→ 删除；
--      - shares（resource_type='reading_item' 公开链接）→ 删除：旧属主不应继续
--        持有一条指向新属主内容的公开暴露口；shares 本就不进备份合同。
--      接收人名下的同引用行刻意保留（转移后同租户，引用合法——例如接收人此前把
--      共享文章转成过自己的笔记）。
--   6. resource_acl 不动：移交后旧属主是否保留访问由既有空间授权决定（通常仍是
--      editor，想彻底退出自行 revoke）。064 合同下协作者本就没有 reading_items
--      写路径（无 UPDATE 策略、无写 RPC），移交后新属主凭行属主身份直写。
--   7. 阅读进度 / 状态 / 全宽偏好是行内字段，随行易主；无 content_revision、无
--      last_edit_by、无 ydoc blob（067 仅 notes），updated_at 由触发器自然前移。
--   8. 备份合同 v4 无 schema 变化（不加列不加表）：转移 = 行易主，导出按调用者
--      RLS 圈行语义自洽；pgTAP 侧逐表断言「转移后两侧各自可见集合内无悬空引用」。

-- ============================================================
-- 阅读条目属主移交 RPC
-- ============================================================
create or replace function public.transfer_reading_item_ownership(
  p_item_id uuid,
  p_new_owner uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_item public.reading_items%rowtype;
  v_new_role text;
  v_highlight_count integer := 0;
  v_tag_count integer := 0;
  v_dummy integer;
begin
  if v_user is null then
    raise exception 'anonymous' using errcode = '42501';
  end if;
  if p_item_id is null or p_new_owner is null then
    raise exception 'item id and new owner are required' using errcode = '22023';
  end if;
  if p_new_owner = v_user then
    raise exception 'new owner must be another user' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_new_owner) then
    raise exception 'new owner not found' using errcode = 'P0002';
  end if;

  -- 行锁：与属主的进度/状态更新互斥，转移期间无并发写
  select * into v_item from public.reading_items where id = p_item_id for update;
  if not found then
    raise exception 'reading item not found' using errcode = 'P0002';
  end if;
  if v_item.user_id <> v_user then
    raise exception 'only the article owner can transfer' using errcode = '42501';
  end if;
  if v_item.deleted_at is not null then
    raise exception 'article is in trash; restore it first' using errcode = '22023';
  end if;

  -- 接收人资格：当前已持有 editor 及以上授权（063 判定链参数化内核，068 抽出）
  v_new_role := public.resource_role_for('reading_item', p_item_id, p_new_owner);
  if v_new_role is null or (v_new_role <> 'editor' and v_new_role <> 'owner') then
    raise exception 'recipient must have editor access to this article first'
      using errcode = '22023';
  end if;

  -- 随迁高亮行数（报告用；实际迁移在下方 CTE）
  select count(*) into v_highlight_count
    from public.highlights
   where reading_item_id = p_item_id
     and user_id <> p_new_owner;

  -- 语句 1：标签复制到接收人名下（同名复用；001 unique(user_id,name)）
  insert into public.tags (user_id, name, color)
  select distinct p_new_owner, t.name, t.color
    from public.tags t
   where t.id in (
     select it.tag_id from public.item_tags it where it.item_id = p_item_id
   )
  on conflict (user_id, name) do nothing;
  get diagnostics v_tag_count = row_count;

  -- 语句 2：一次性搬齐。reading_items 域没有 056 复合外键（highlights 的
  -- reading_item_id 是普通外键），无需推迟任何约束触发器，单语句即原子。
  with
    u_hl as (
      -- 高亮随迁（NOT NULL 锚点：置空不存在，删行 = 丢数据）。
      -- 引用列只保留指向接收人名下笔记/任务的；指向旧属主内容的解除。
      update public.highlights
         set user_id = p_new_owner,
             note_id = case
               when note_id is null then null
               when (select n.user_id from public.notes n
                      where n.id = highlights.note_id) = p_new_owner
                 then note_id
               else null
             end,
             task_id = case
               when task_id is null then null
               when (select t.user_id from public.tasks t
                      where t.id = highlights.task_id) = p_new_owner
                 then task_id
               else null
             end
       where reading_item_id = p_item_id
         and user_id <> p_new_owner
    ),
    u_fav as (
      delete from public.favorites
       where target_type = 'reading'
         and target_id = p_item_id
         and user_id <> p_new_owner
    ),
    u_share as (
      delete from public.shares
       where resource_type = 'reading_item' and resource_id = p_item_id
    ),
    u_itags as (
      update public.item_tags it
         set tag_id = (
               select b.id from public.tags b
                where b.user_id = p_new_owner
                  and b.name = (select a.name from public.tags a where a.id = it.tag_id)
             )
       where it.item_id = p_item_id
    ),
    u_note as (
      -- 旧属主的文章笔记解除挂载；接收人自己的笔记保留（转移后同租户合法）
      update public.notes set reading_item_id = null
       where reading_item_id = p_item_id
         and user_id <> p_new_owner
    ),
    u_task as (
      update public.tasks set reading_item_id = null
       where reading_item_id = p_item_id
         and user_id <> p_new_owner
    ),
    u_les as (
      update public.lessons set reading_item_id = null
       where reading_item_id = p_item_id
         and user_id <> p_new_owner
    ),
    u_item as (
      update public.reading_items set user_id = p_new_owner
       where id = p_item_id
    )
    -- plpgsql 不允许裸 SELECT：数据修改 CTE 随本语句执行，顶层补一个带目的地的哑查询
    select 1 into v_dummy;

  return jsonb_build_object(
    'status', 'ok',
    'highlights_transferred', v_highlight_count,
    'tags_copied', v_tag_count
  );
end;
$$;

-- ============================================================
-- 函数 EXECUTE 分层（沿 056 / 063 / 068 约定）
-- ============================================================
do $$
declare r record;
  client_fn text[] := array['transfer_reading_item_ownership'];
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
