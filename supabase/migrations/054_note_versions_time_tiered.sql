-- 054 笔记版本历史升级：时间分级保留 + 命名版本
--
-- 此前（010/036）：content/title 变化即快照、60 秒节流、每笔记最多 50 个、超出删最旧。
-- 问题：长期编辑的老笔记几天就把历史滚没了。
--
-- 新策略（用户选定的时间分级）：
--   写入去抖：距上次快照不足 5 分钟跳过（连续编辑不刷屏）
--   7 天内：每小时保留最新 1 版
--   7~90 天：每天保留最新 1 版
--   90 天前：删除
--   命名版本（message 非空）：永不清理
-- 新增 RPC save_note_named_version：手动把当前内容保存为命名版本。

-- 时间分级裁剪：可独立调用（命名版本保存后也走一遍）
create or replace function public.prune_note_versions(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.note_versions
  where note_id = p_note_id
    and message is null
    and (
      -- 90 天前：全删
      created_at < now() - interval '90 days'
      -- 7~90 天：每天只留最新 1 版
      or (
        created_at < now() - interval '7 days'
        and id not in (
          select distinct on (date_trunc('day', created_at)) id
          from public.note_versions
          where note_id = p_note_id
            and message is null
            and created_at >= now() - interval '90 days'
            and created_at < now() - interval '7 days'
          order by date_trunc('day', created_at), created_at desc
        )
      )
      -- 7 天内：每小时只留最新 1 版
      or (
        created_at >= now() - interval '7 days'
        and id not in (
          select distinct on (date_trunc('hour', created_at)) id
          from public.note_versions
          where note_id = p_note_id
            and message is null
            and created_at >= now() - interval '7 days'
          order by date_trunc('hour', created_at), created_at desc
        )
      )
    );
end;
$$;

-- 快照触发器：去抖放宽到 5 分钟，写入后走时间分级裁剪
create or replace function public.save_note_version()
returns trigger as $$
declare
  last_time timestamptz;
begin
  -- 只在 content 或 title 真正变化时才记录
  if (TG_OP = 'UPDATE' and NEW.content IS NOT DISTINCT FROM OLD.content
      and NEW.title IS NOT DISTINCT FROM OLD.title) then
    return NEW;
  end if;

  -- 距上次快照不足 5 分钟 → 跳过（连续编辑去抖；时间分级在裁剪端完成）
  select created_at into last_time
    from public.note_versions
    where note_id = NEW.id
    order by created_at desc
    limit 1;
  if last_time is not null
     and last_time > now() - interval '5 minutes' then
    return NEW;
  end if;

  insert into public.note_versions (note_id, content, title, created_at)
  values (NEW.id, OLD.content, OLD.title, now());

  perform public.prune_note_versions(NEW.id);

  return NEW;
end;
$$ language plpgsql security definer;

-- 手动保存命名版本：把「当前」内容存为 message 非空的版本（永不清理）
create or replace function public.save_note_named_version(
  p_note_id uuid,
  p_message text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_content jsonb;
  v_title text;
begin
  if v_user is null then
    return jsonb_build_object('status', 'forbidden');
  end if;
  if p_message is null or length(btrim(p_message)) = 0 then
    return jsonb_build_object('status', 'invalid_message');
  end if;

  select content, title into v_content, v_title
  from public.notes
  where id = p_note_id and user_id = v_user;
  if not found then
    return jsonb_build_object('status', 'note_not_found');
  end if;

  insert into public.note_versions (note_id, content, title, message, created_at)
  values (p_note_id, v_content, v_title, left(btrim(p_message), 100), now());

  perform public.prune_note_versions(p_note_id);

  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.save_note_named_version(uuid, text) from public;
grant execute on function public.save_note_named_version(uuid, text) to authenticated;
