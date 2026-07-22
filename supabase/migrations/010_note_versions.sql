-- 笔记版本历史
-- 每次笔记内容变更时存一个快照，最多保留 N 个（应用层控制）
-- 用户可以查看历史版本并恢复

create table if not exists note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid references notes on delete cascade not null,
  -- 当时的内容快照（jsonb，和 notes.content 同结构）
  content jsonb not null,
  -- 当时的标题快照（可选，便于历史列表展示）
  title text,
  -- 自动生成；也可以手动指定（如"恢复点"）
  message text,
  created_at timestamptz default now()
);

-- 索引：按笔记反查，按时间倒序
create index if not exists idx_note_versions_note_id on note_versions(note_id, created_at desc);

-- RLS
alter table note_versions enable row level security;

create policy "Users can view own note versions" on note_versions
  for select using (
    exists (select 1 from notes where id = note_id and user_id = auth.uid())
  );
create policy "Users can insert own note versions" on note_versions
  for insert with check (
    exists (select 1 from notes where id = note_id and user_id = auth.uid())
  );
create policy "Users can delete own note versions" on note_versions
  for delete using (
    exists (select 1 from notes where id = note_id and user_id = auth.uid())
  );

-- GRANT
grant select, insert, delete on public.note_versions to authenticated;
grant select on public.note_versions to anon;

-- 触发器：notes.content 更新时自动存历史版本（存 OLD，即修改前的快照）
-- 去重：如果距离上次快照不足 60 秒，且 content 完全一样，则跳过
create or replace function save_note_version()
returns trigger as $$
declare
  last_content jsonb;
  last_time timestamptz;
begin
  -- 只在 content 或 title 真正变化时才记录
  if (TG_OP = 'UPDATE' and NEW.content IS NOT DISTINCT FROM OLD.content
      and NEW.title IS NOT DISTINCT FROM OLD.title) then
    return NEW;
  end if;

  -- 检查最近一次快照
  select content, created_at into last_content, last_time
    from note_versions
    where note_id = NEW.id
    order by created_at desc
    limit 1;

  -- 60 秒内 + 内容相同 -> 跳过（避免输入过程产生海量快照）
  if last_content is not null
     and last_content = OLD.content
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

drop trigger if exists on_note_update_save_version on notes;
create trigger on_note_update_save_version
  after update on notes
  for each row execute function save_note_version();

