-- 036 修复笔记版本历史去重失效
--
-- 背景：010 的去重条件是「最近快照 content = OLD.content 且 60 秒内」。
-- 但连续编辑时最近一次快照存的是更早一次保存的 OLD，与本次 OLD
-- 几乎必不相等 → 900ms 防抖的自动保存每次都插一个新版本，
-- 连续输入一两分钟即可耗尽 50 个版本额度，且每次 update 附带一次
-- prune delete，写放大明显。版本历史名存实亡。
--
-- 修复：改为时间节流——距上次快照不足 60 秒直接跳过（连续编辑
-- 每分钟至多 1 个快照，50 个版本约覆盖 50 分钟编辑时长）；
-- 「无实际变化不记」的既有判断保留。

create or replace function save_note_version()
returns trigger as $$
declare
  last_time timestamptz;
begin
  -- 只在 content 或 title 真正变化时才记录
  if (TG_OP = 'UPDATE' and NEW.content IS NOT DISTINCT FROM OLD.content
      and NEW.title IS NOT DISTINCT FROM OLD.title) then
    return NEW;
  end if;

  -- 最近一次快照时间
  select created_at into last_time
    from note_versions
    where note_id = NEW.id
    order by created_at desc
    limit 1;

  -- 距上次快照不足 60 秒 → 跳过（连续编辑时间节流）
  if last_time is not null
     and last_time > now() - interval '60 seconds' then
    return NEW;
  end if;

  insert into note_versions (note_id, content, title, created_at)
  values (NEW.id, OLD.content, OLD.title, now());

  -- 保留最多 50 个版本/笔记，超出删最旧
  delete from note_versions
    where note_id = NEW.id
      and id not in (
        select id from note_versions
          where note_id = NEW.id
          order by created_at desc
          limit 50
      );

  return NEW;
end;
$$ language plpgsql security definer;
