-- M3 数据库内核：db_databases（数据库/逻辑表）+ db_rows（数据行）
-- 一个 database 带一份 schema（属性列定义）和多份视图（views），
-- 行数据存在 db_rows.values jsonb 里（{propertyId: value}），按 sort 排序。
-- 支持软删除；行作为子资源跟随父库的可见性。

-- ──────────────────────────────────────────────────────────
-- db_databases
-- ──────────────────────────────────────────────────────────
create table if not exists db_databases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  -- 整页数据库挂在某笔记下（parent_note_id 指向笔记树）；行内数据库为 null
  parent_note_id uuid references notes(id) on delete set null,
  title text not null default '',
  icon text,
  -- 属性 schema：[{id,name,type,options?}]
  "schema" jsonb not null default '[]'::jsonb,
  -- 视图列表，至少包含一个默认 table 视图
  views jsonb not null default '[{"id":"default_view","type":"table","config":{}}]'::jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  deleted_at timestamptz
);

create index if not exists idx_db_databases_user_deleted
  on db_databases(user_id, deleted_at);
create index if not exists idx_db_databases_parent
  on db_databases(parent_note_id)
  where parent_note_id is not null and deleted_at is null;

alter table db_databases enable row level security;

-- select/insert/update 仅在未删除时可见/可写；物理 delete 由 trash 流程走
create policy "Users can view own active databases" on db_databases
  for select using (auth.uid() = user_id and deleted_at is null);
create policy "Users can insert own databases" on db_databases
  for insert with check (auth.uid() = user_id and deleted_at is null);
create policy "Users can update own active databases" on db_databases
  for update using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id and deleted_at is null);

-- trash 流程需要能看到软删除的库以恢复/彻底删除；soft-delete SQL 函数是 security definer，
-- 这里不给普通 API 物理 delete 权限
create trigger update_db_databases_updated_at
  before update on db_databases
  for each row execute function update_updated_at_column();

grant select, insert, update on db_databases to authenticated;

-- ──────────────────────────────────────────────────────────
-- db_rows
-- ──────────────────────────────────────────────────────────
create table if not exists db_rows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  database_id uuid references db_databases(id) on delete cascade not null,
  sort int not null default 0,
  -- {propertyId: value}
  "values" jsonb not null default '{}'::jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  deleted_at timestamptz
);

create index if not exists idx_db_rows_database_sort
  on db_rows(database_id, sort, created_at)
  where deleted_at is null;
create index if not exists idx_db_rows_user_deleted
  on db_rows(user_id, deleted_at);

alter table db_rows enable row level security;

-- 行作为子资源：只有当所属 database 未删除时才可读写
create policy "Users can view rows in own active databases" on db_rows
  for select using (
    auth.uid() = user_id
    and deleted_at is null
    and exists (
      select 1 from db_databases db
      where db.id = database_id
        and db.user_id = auth.uid()
        and db.deleted_at is null
    )
  );
create policy "Users can insert rows in own active databases" on db_rows
  for insert with check (
    auth.uid() = user_id
    and deleted_at is null
    and exists (
      select 1 from db_databases db
      where db.id = database_id
        and db.user_id = auth.uid()
        and db.deleted_at is null
    )
  );
create policy "Users can update rows in own active databases" on db_rows
  for update using (
    auth.uid() = user_id
    and deleted_at is null
    and exists (
      select 1 from db_databases db
      where db.id = database_id
        and db.user_id = auth.uid()
        and db.deleted_at is null
    )
  )
  with check (
    auth.uid() = user_id
    and deleted_at is null
    and exists (
      select 1 from db_databases db
      where db.id = database_id
        and db.user_id = auth.uid()
        and db.deleted_at is null
    )
  );

create trigger update_db_rows_updated_at
  before update on db_rows
  for each row execute function update_updated_at_column();

grant select, insert, update on db_rows to authenticated;
