-- 085: 构思画布（idea-canvas，docs/idea-canvas-plan.md §6.3）
--
-- canvas_documents：无限画布文档（独立实体，不进 notes.content）。
-- content 为 Board→Section→Column→Block 结构 JSON（schemaVersion=1，
-- 客户端/服务器共用 lib/canvas/validation.ts 校验）。
-- revision 为并发修订号（从 1 起），PATCH 一律走 canvas_document_patch
-- 单条 UPDATE 原子 CAS（模板：073 synced_block_patch）。
-- 图片资产只存持久地址（/storage/...），禁止 blob:/data: 短期地址进文档。

create table if not exists public.canvas_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null default '',
  content jsonb not null,
  revision bigint not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_canvas_documents_user_updated
  on public.canvas_documents(user_id, updated_at desc);
create index if not exists idx_canvas_documents_user_deleted_at
  on public.canvas_documents(user_id, deleted_at);

create trigger update_canvas_documents_updated_at
  before update on public.canvas_documents
  for each row execute function update_updated_at_column();

alter table public.canvas_documents enable row level security;

drop policy if exists "Users can read own canvases" on public.canvas_documents;
create policy "Users can read own canvases"
  on public.canvas_documents for select
  using (auth.uid() = user_id and deleted_at is null);

drop policy if exists "Users can insert own canvases" on public.canvas_documents;
create policy "Users can insert own canvases"
  on public.canvas_documents for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own canvases" on public.canvas_documents;
create policy "Users can update own canvases"
  on public.canvas_documents for update
  using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id and deleted_at is null);

drop policy if exists "Users can delete own canvases" on public.canvas_documents;
create policy "Users can delete own canvases"
  on public.canvas_documents for delete
  using (auth.uid() = user_id);

revoke all on public.canvas_documents from anon, authenticated;
grant select, insert, update, delete on public.canvas_documents to authenticated;

-- ========== 原子保存：标题 + 内容 CAS（单条 UPDATE，非 SELECT 后 UPDATE） ==========
create or replace function public.canvas_document_patch(
  p_id uuid,
  p_title text,
  p_content jsonb,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.canvas_documents%rowtype;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_title is null or length(p_title) > 200 then
    raise exception using errcode = '22023', message = 'Invalid canvas title';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception using errcode = '22023', message = 'Invalid canvas content';
  end if;

  if p_expected_revision is null then
    -- 兜底：不比较，直接覆盖并递增（与 073 同口径）
    update public.canvas_documents
    set title = p_title, content = p_content, revision = revision + 1
    where id = p_id and user_id = v_user and deleted_at is null
    returning * into v_row;
  else
    update public.canvas_documents
    set title = p_title, content = p_content, revision = p_expected_revision + 1
    where id = p_id and user_id = v_user and deleted_at is null and revision = p_expected_revision
    returning * into v_row;
  end if;

  if v_row.id is null then
    -- 未命中：区分「revision 过期（冲突）」与「不存在/无权/已删除（404，不泄露存在性）」
    select * into v_row from public.canvas_documents
    where id = p_id and user_id = v_user;
    if v_row.id is null or v_row.deleted_at is not null then
      return jsonb_build_object('status', 'not_found');
    end if;
    return jsonb_build_object(
      'status', 'conflict',
      'current', jsonb_build_object('revision', v_row.revision, 'title', v_row.title)
    );
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'id', v_row.id,
    'title', v_row.title,
    'content', v_row.content,
    'revision', v_row.revision,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke execute on function public.canvas_document_patch(uuid, text, jsonb, bigint) from public, anon;
grant execute on function public.canvas_document_patch(uuid, text, jsonb, bigint) to authenticated, service_role;
