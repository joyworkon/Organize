-- 笔记块评论线程
create table if not exists note_comment_threads (
  id uuid primary key default gen_random_uuid(),
  note_id uuid references notes on delete cascade not null,
  block_id text not null,
  user_id uuid references auth.users on delete cascade not null,
  resolved_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists note_comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references note_comment_threads on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists note_suggestions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid references notes on delete cascade not null,
  block_id text not null,
  user_id uuid references auth.users on delete cascade not null,
  original_block jsonb not null,
  proposed_block jsonb not null,
  status text default 'pending' not null check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists idx_note_comment_threads_note_block on note_comment_threads(note_id, block_id);
create index if not exists idx_note_comments_thread on note_comments(thread_id, created_at);
create index if not exists idx_note_suggestions_note_block on note_suggestions(note_id, block_id, status);

alter table note_comment_threads enable row level security;
alter table note_comments enable row level security;
alter table note_suggestions enable row level security;

create policy "Users manage own note comment threads" on note_comment_threads
  for all using (auth.uid() = user_id) with check (
    auth.uid() = user_id and exists (
      select 1 from notes where notes.id = note_id and notes.user_id = auth.uid()
    )
  );

create policy "Users manage own note comments" on note_comments
  for all using (auth.uid() = user_id) with check (
    auth.uid() = user_id and exists (
      select 1 from note_comment_threads thread
      where thread.id = thread_id and thread.user_id = auth.uid()
    )
  );

create policy "Users manage own note suggestions" on note_suggestions
  for all using (auth.uid() = user_id) with check (
    auth.uid() = user_id and exists (
      select 1 from notes where notes.id = note_id and notes.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on table note_comment_threads to authenticated;
grant select, insert, update, delete on table note_comments to authenticated;
grant select, insert, update, delete on table note_suggestions to authenticated;

create trigger update_note_comment_threads_updated_at
  before update on note_comment_threads
  for each row execute function update_updated_at_column();

create trigger update_note_comments_updated_at
  before update on note_comments
  for each row execute function update_updated_at_column();

create trigger update_note_suggestions_updated_at
  before update on note_suggestions
  for each row execute function update_updated_at_column();

-- 顶层块在两篇笔记间原子移动。RLS 与显式 user_id 条件共同限制所有权。
create or replace function move_note_block(
  p_source_note_id uuid,
  p_target_note_id uuid,
  p_block_id text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_content jsonb;
  target_content jsonb;
  moving_block jsonb;
  source_blocks jsonb;
  target_blocks jsonb;
begin
  if p_source_note_id = p_target_note_id then
    raise exception 'Source and target notes must be different';
  end if;

  select content into source_content
  from notes
  where id = p_source_note_id and user_id = auth.uid()
  for update;

  select content into target_content
  from notes
  where id = p_target_note_id and user_id = auth.uid()
  for update;

  if source_content is null or target_content is null then
    raise exception 'Note not found or access denied';
  end if;

  source_blocks := coalesce(source_content->'content', '[]'::jsonb);
  target_blocks := coalesce(target_content->'content', '[]'::jsonb);

  select block into moving_block
  from jsonb_array_elements(source_blocks) as block
  where block->'attrs'->>'id' = p_block_id
  limit 1;

  if moving_block is null then
    raise exception 'Block not found';
  end if;

  select coalesce(jsonb_agg(block), '[]'::jsonb) into source_blocks
  from jsonb_array_elements(source_blocks) as block
  where block->'attrs'->>'id' is distinct from p_block_id;

  if jsonb_array_length(source_blocks) = 0 then
    source_blocks := '[{"type":"paragraph"}]'::jsonb;
  end if;

  update notes
  set content = jsonb_set(source_content, '{content}', source_blocks, true)
  where id = p_source_note_id and user_id = auth.uid();

  update notes
  set content = jsonb_set(target_content, '{content}', target_blocks || jsonb_build_array(moving_block), true)
  where id = p_target_note_id and user_id = auth.uid();

  -- 批注与建议跟随区块移动，避免在源笔记留下不可见的孤儿锚点。
  update note_comment_threads
  set note_id = p_target_note_id
  where note_id = p_source_note_id and block_id = p_block_id and user_id = auth.uid();

  update note_suggestions
  set note_id = p_target_note_id
  where note_id = p_source_note_id and block_id = p_block_id and user_id = auth.uid();
end;
$$;

revoke all on function move_note_block(uuid, uuid, text) from public;
grant execute on function move_note_block(uuid, uuid, text) to authenticated;
