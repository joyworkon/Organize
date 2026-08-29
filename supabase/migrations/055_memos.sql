-- 055 速记（flomo 式碎片捕捉）
--
-- memos：随手记的碎片内容（纯文本），与 notes（成品笔记）区分。
-- 内容中的 #标签 解析进 tags 数组用于筛选（解析逻辑在应用层 lib/memos/tags.ts，
-- 真实路由与 mock shim 共用，保证两边行为一致）。
-- deleted_at 预留软删；垃圾箱体系暂不接入，后续按需接入 mutateTrash。

create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  content text not null,
  tags text[] not null default '{}',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_memos_user_created
  on public.memos(user_id, created_at desc);
create index if not exists idx_memos_tags
  on public.memos using gin (tags);

alter table public.memos enable row level security;

drop policy if exists "Users can read own memos" on public.memos;
create policy "Users can read own memos"
  on public.memos for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own memos" on public.memos;
create policy "Users can insert own memos"
  on public.memos for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own memos" on public.memos;
create policy "Users can update own memos"
  on public.memos for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own memos" on public.memos;
create policy "Users can delete own memos"
  on public.memos for delete
  using (auth.uid() = user_id);

revoke all on public.memos from anon, authenticated;
grant select, insert, update, delete on public.memos to authenticated;
