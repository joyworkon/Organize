-- 用户级 AI 服务配置（OpenAI 兼容接口）：一处配置，全模块（笔记 AI / AI 速记 / 标签推荐）共用。
-- 配置存数据库而非环境变量，用户在「设置 › AI 服务」自助填写；服务端读取时回退到环境变量。

create table if not exists public.user_ai_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  base_url text not null,
  api_key text not null,
  text_model text,
  transcription_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_ai_settings enable row level security;

create policy "user_ai_settings_select_own" on public.user_ai_settings
  for select using (auth.uid() = user_id);
create policy "user_ai_settings_insert_own" on public.user_ai_settings
  for insert with check (auth.uid() = user_id);
create policy "user_ai_settings_update_own" on public.user_ai_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_ai_settings_delete_own" on public.user_ai_settings
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.user_ai_settings to authenticated;
