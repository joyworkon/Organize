# 笔记多人协同方案（Notion / 飞书文档风格）

> 状态：草稿 / 待确认关键分叉点后进入实施。  
> 相关审计基础：`001_initial_schema.sql`（RLS owner-only）、`006_sharing.sql` + `018_secure_public_shares.sql`（公开只读 token）、`031_save_note_with_tasks_rpc.sql`（security definer 原子保存 + 乐观锁）、`032_realtime_tasks_publication.sql`（tasks/task_item_refs 已加 publication）、`038_note_atomic_save_metadata.sql`（`last_edit_by` 预留列位）、`tiptap-editor.tsx` 的 `TransactionSource = "remote-sync"` 预留枚举。

## 1. 目标

把「笔记分享给他人后多人同时编辑」做成 Notion / 飞书文档级体验：

1. **分享与权限**：笔记顶部「分享」按钮可邀请指定用户（owner / editor / viewer），也可开公开链接（disabled / public_read / public_edit）+ 过期时间。
2. **可见性**：协作者登录后在「与我共享」分组看到笔记（不依赖 URL）。
3. **并发编辑**：
   - Stage 0：无实时推送，但各自保存走乐观锁 + 冲突 UI（覆盖 / 保留远端 / 另存冲突副本），绝不静默丢数据。
   - Stage 1：Supabase Realtime 推送 + 整页快照自动刷新 + Presence 头像栈 + 块级活跃徽章。
   - Stage 2：Yjs CRDT + 远程光标选区气泡（字符级无冲突合并）。
4. **最小改造原则**：复用现有 `shares` / `save_note_with_tasks` / `content_revision` / `note_versions` / Tiptap 的 `remote-sync` 来源；不重写编辑器保存主链；新权限走一张 ACL 表 + 若干 security definer RPC，不大面积改 RLS。

## 2. 现状审计结论

| 模块 | 当前能力 | 限制 | 改造方向 |
|---|---|---|---|
| `shares` 表（006 / 018） | owner 创建 token，**anon 只读**（通过 `get_public_share` RPC） | 无账号级 ACL，无 write 语义；018 删了 anon 对 notes 的直接 select | 新增 `access_mode`、`can_comment` 列；新增 `share_members` 成员表 |
| `save_note_with_tasks`（031） | 单事务 + `content_revision` 乐观锁 + `mutation_id` 幂等 + 任务 revision 校验 | **硬校验 `v_note_owner <> v_user → forbidden`**；任务必须 `tasks.user_id = v_user` | 新增 `_v2`：改成「owner 或 share_members(editor/owner) 均通过」；任务访问通过 note_ref 链条打通；不改老函数 |
| RLS（001 及各表） | 所有主表 `auth.uid() = user_id`，owner-only | 协作者根本 SELECT/UPDATE 不到笔记实体 | notes/tasks/readings 各加一条 share_members OR 策略；仍保留 security definer 写路径兜底，**不给 anon 直接写** |
| Realtime Publication（032） | 只把 `tasks` / `task_item_refs` 加入了 publication；前端**尚未有任何 `.channel(...).on('postgres_changes' ...)` 消费** | 本地 dev 的 Realtime 有签名错误已知问题（订阅 SUBSCRIBED 但收不到事件，见 `notes/[id]/page.tsx:431` 注释） | 066 把 `notes` 加入 publication + REPLICA IDENTITY FULL；Stage 1 前消费端在非本地才启用 Realtime，本地退化轮询 |
| 编辑器 Tiptap | `TransactionSource` 已有 `remote-sync`；`onUpdate(source=...)` 约定：非 `user` 不激活 legacy、不生成 task mutation、不进 Undo | 暂无 Yjs/CRDT 绑定 | Stage 1 直接以 `transactionSource = 'remote-sync'` 把远端快照推入；Stage 2 再接 Collaboration 扩展 |
| `save_mutation_log` 幂等表 | 唯一键 `(mutation_id, user_id)` | 协作者各自 `user_id` 不同 | 天然互不干扰，无需迁移 |
| 公开读链路 `get_public_share`（018） | security definer，stable，search_path 已收紧，execute 给 anon+authenticated | 只能读 title/content 等白名单字段；无 comment 能力；无 edit | public_edit 模式仍**要求登录**（本方案第 3.1 节分叉 B），避免 anon 直接写数据库；公开读 RPC 保持不变 |

## 3. 关键分叉点（实施前必须拍板）

### 分叉 1：仅个人点对点分享 vs 工作区/组织级共享

- **A. 点对点分享（MVP，默认推荐）**  
  只加 `share_members` 单张成员表，按邮箱 / 昵称找人，直接把笔记邀请给**具体个人账号**。  
  - 优点：改 RLS 面最小，`user_profiles` 表 1 张就够，列表查询走 `get_shared_notes_for_me()` 单 RPC。  
  - 风险：当同一团队 > 5 人频繁邀人时，角色管理散，没有「批量加整个组」。
- **B. 工作区级共享**  
  新增 `workspaces` / `workspace_members`，所有主表 `user_id` 变成 `workspace_id` + 一个成员角色表，RLS 全部重构。  
  - 优点：支持「整个工作区默认可见」「在 workspace 下搜索所有笔记」，和 Notion workspace 对齐。  
  - 缺点：工程量 ×2–3，迁移要把现存每一行的 user_id 挂到 workspace 并建立 owner 映射，pgTAP 覆盖量大。

> 方案文档先按 A（点对点）展开；若选 B，本页 §4.1 DB 部分按 §7 扩展即可。

### 分叉 2：公开链接是否允许「匿名可编辑」

- **A. 关闭：公开链接只能 public_read / public_comment（推荐）**  
  真正能 write 的必须是登录用户并被加入 `share_members`。  
  - 安全性好，和现有 `anon 只有 SELECT shares token` 语义一致；不引入防刷/会话/限流。
- **B. 打开：public_edit 支持未登录用户编辑**  
  需新建 `share_sessions(id, share_id, anon_id cookie, role, expires)`，服务端把 actor 记为 session，notes 加 `last_edit_by_session_id` 列；cron 清理过期 session。  
  - 灵活但风险大：防刷、abuse、RLS 穿透三条都要写 pgTAP 负例。

> 默认走 A。

### 分叉 3：Stage 2 传输层选型

- **A. y-webrtc（PeerJS）**：0 服务器，P2P，staging 最快；跨网段/NAT 失败率高，不适合生产。  
- **B. Hocuspocus（自搭 Tiptap Collab Server）**：业界最稳；新增一个独立服务（或 Vercel Edge Runtime websocket），要部署任务 + 域名 + 告警。  
- **C. Supabase Realtime Broadcast 直接转 y-protocol steps**：不引新服务，复用现有 Realtime 配额；但官方未生产化 y-supabase，要自己写封装。

> MVP 建议 Stage 1 先完全不依赖传输层（只做 Postgres changes +整页刷新），Stage 2 前再选 B 或 C。

---

## 4. Stage 0：权限底座 + 多人编辑（无实时）

### 4.1 数据库（迁移 063_collaboration_share_members.sql）

三张新增对象：

#### 4.1.1 `public.user_profiles`（跨用户看到对方姓名/头像的唯一入口）

```sql
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,                      -- 只读镜像，通过 auth trigger 回填
  display_name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS：任何人（authenticated）都能看到 profile，供分享面板搜索头像
alter table public.user_profiles enable row level security;
create policy "Authenticated can read any profile" on public.user_profiles
  for select using (auth.uid() is not null);
create policy "Users can update own profile only" on public.user_profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
grant select, insert, update on public.user_profiles to authenticated;

-- Trigger: auth.users 创建时自动镜像 profile（auth schema 需要 service role 才能建；
-- 这里在 migration 里按 Supabase 官方范式走 `auth.users` 表的 AFTER INSERT/UPDATE
-- 触发器，SET search_path=auth 后 execute，详见 Gist 附件）
```

> 注意：anon 不给 select user_profiles，公开读链路仍然看不到其他账号名字（合理）。

#### 4.1.2 扩展 `public.shares`

```sql
alter table public.shares add column if not exists access_mode text not null
  default 'public_read'
  check (access_mode in ('disabled', 'public_read', 'public_edit'));

alter table public.shares add column if not exists can_comment boolean not null default true;

-- 现有 shares.is_public 与 access_mode 语义重叠：保留 is_public 避免旧前端炸，
-- 新增 check 保持两者一致：access_mode='disabled' => is_public=false；其他 => true
-- （先通过 backfill 一次性把老数据对齐，再加 constraint）
do $$ begin
  update public.shares
  set is_public = (access_mode <> 'disabled')
  where is_public is distinct from (access_mode <> 'disabled');
end $$;

alter table public.shares drop constraint if exists shares_access_mode_is_public_consistent;
alter table public.shares add constraint shares_access_mode_is_public_consistent check (
  (access_mode = 'disabled' and not is_public)
  or (access_mode <> 'disabled' and is_public)
);
```

#### 4.1.3 `public.share_members`（账号级 ACL）

```sql
create table if not exists public.share_members (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.shares(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer','editor','owner')),
  invited_by uuid references auth.users(id),
  invited_at timestamptz default now(),
  unique (share_id, user_id)
);
create index if not exists idx_share_members_user on public.share_members(user_id);

alter table public.share_members enable row level security;

-- owner 可改成员；viewer/editor 只可读（用于自己看到共享信息）
create policy "Share members visible to the member itself and share owner" on public.share_members
  for select using (
    auth.uid() = user_id
    or exists (
      select 1 from public.shares s
      where s.id = share_members.share_id and s.owner_id = auth.uid()
    )
  );
create policy "Share owner manages members" on public.share_members
  for insert with check (
    exists (
      select 1 from public.shares s
      where s.id = share_members.share_id and s.owner_id = auth.uid()
    )
  );
create policy "Share owner updates members" on public.share_members
  for update using (
    exists (
      select 1 from public.shares s
      where s.id = share_members.share_id and s.owner_id = auth.uid()
    )
  );
create policy "Share owner removes members" on public.share_members
  for delete using (
    exists (
      select 1 from public.shares s
      where s.id = share_members.share_id and s.owner_id = auth.uid()
    )
    or auth.uid() = user_id   -- 成员也能主动退出
  );

grant select, insert, update, delete on public.share_members to authenticated;
```

### 4.2 RLS 扩展（迁移 064_collaboration_rls.sql）

原则：`notes` / `reading_items` 等加一条「我在成员表中」的 SELECT/UPDATE 策略。多 policy 是 OR 关系，不会破坏旧 owner-only。

```sql
-- Notes：viewer/editor/owner 可见；editor/owner 可写
create policy "Shared members can view notes via ACL" on public.notes
  for select using (
    exists (
      select 1 from public.share_members sm
      join public.shares s on s.id = sm.share_id
      where s.resource_type = 'note'
        and s.resource_id = notes.id
        and sm.user_id = auth.uid()
        and sm.role in ('viewer','editor','owner')
    )
  );
create policy "Shared editors can update notes via ACL" on public.notes
  for update using (
    exists (
      select 1 from public.share_members sm
      join public.shares s on s.id = sm.share_id
      where s.resource_type = 'note'
        and s.resource_id = notes.id
        and sm.user_id = auth.uid()
        and sm.role in ('editor','owner')
    )
  ) with check (
    -- 写仍要满足：要么是 owner，要么是 ACL 编辑者
    user_id = auth.uid() or exists (
      select 1 from public.share_members sm
      join public.shares s on s.id = sm.share_id
      where s.resource_type = 'note'
        and s.resource_id = notes.id
        and sm.user_id = auth.uid()
        and sm.role in ('editor','owner')
    )
  );

-- Reading items 同（view-only 权限先不做编辑器，仅允许查看分享的稍后读正文）
create policy "Shared members can view reading items via ACL" on public.reading_items
  for select using (
    exists (
      select 1 from public.share_members sm
      join public.shares s on s.id = sm.share_id
      where s.resource_type = 'reading_item'
        and s.resource_id = reading_items.id
        and sm.user_id = auth.uid()
        and sm.role in ('viewer','editor','owner')
    )
  );

-- Tasks：当任务通过 task_item_refs 挂在「我可编辑的 note」时，允许改状态/标题
-- （用于 note 内嵌 taskItem 勾选后 save_note_with_tasks 写 task）
create policy "Note collaborators can mutate tasks linked via refs" on public.tasks
  for select using (
    user_id = auth.uid() or exists (
      select 1 from public.task_item_refs r
      join public.notes n on n.id = r.note_id
      join public.share_members sm on true
      join public.shares s on s.id = sm.share_id
      where r.task_id = tasks.id
        and s.resource_type = 'note' and s.resource_id = n.id
        and sm.user_id = auth.uid() and sm.role in ('editor','owner')
    )
  );
-- update/delete 同条件。tasks 表级 GRANT authenticated 已存在（003/012）。

-- 其他实体：
--   note_tags / highlights / favorites：每个协作者「各人一份」——tag 归属 sm.user_id
--   自己，不加共享 RLS（允许 A 喜欢某笔记但 B 看不到，语义自然）；
--   note_versions：协作者查看时用 security definer `list_versions` RPC（见 4.3），
--   不依赖表级 select；
--   attachments/images bucket：已有 RLS/Policy 按 user_id 限定；共享笔记里的附件
--   先通过「用 owner 的 signed URL 短链生成」RPC 解决（下一 migration 单独补）。
```

> **性能注意**：上面 `exists (1 ... sm join shares)` 的 SQL，Supabase Postgres 上通常能走 `share_members.user_id` 索引 + `shares(owner_id, resource_type, resource_id)` 或 `idx_shares_owner_resource`。务必在 staging 上用 `explain analyze` 跑一遍 10k notes × 1k members 场景，确认 filter 不是 seq scan。如果慢，加物化视图/反范式：`notes` 加 `share_member_ids uuid[]` GIN 列，触发器同步。pgTAP 064 要包含「协作者查询 `notes` 不触发 seq scan」的断言。

### 4.3 保存 RPC（迁移 065_collaboration_save_note_v2.sql）

**不要直接改 031 的老函数**（单测 40+ 条 + 全部前端当前调用点）。新增 `_v2`：

```sql
create or replace function public.save_note_with_tasks_v2(
  p_note_id uuid,
  p_content jsonb,
  p_expected_note_revision integer,     -- null 表示跳过 revision 检查（Stage 2 Yjs 模式）
  p_title text default null,
  p_task_mutations jsonb default null,
  p_expected_task_revisions jsonb default null,
  p_mutation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;  -- 'owner' | 'editor' | 'viewer' | null (forbidden)
  v_note_owner uuid;
  v_cur_rev integer;
  v_task_id uuid; v_task_rev integer; v_exp_rev integer;
  v_new_task_rev integer;
  v_title text; v_status text; v_task_revisions jsonb := '{}'::jsonb;
  v_m record; v_mutation_result jsonb;
begin
  if v_user is null then return jsonb_build_object('status','forbidden','reason','anonymous'); end if;

  -- 1) 幂等：same user + same mutation_id => hit cache
  if p_mutation_id is not null then
    select result into v_mutation_result
      from public.save_mutation_log
     where mutation_id = p_mutation_id and user_id = v_user;
    if found then return v_mutation_result; end if;
  end if;

  -- 2) 解析角色（owner 或 成员）
  select user_id, content_revision into v_note_owner, v_cur_rev
    from public.notes where id = p_note_id for update;
  if not found then return jsonb_build_object('status','not_found'); end if;

  if v_note_owner = v_user then
    v_role := 'owner';
  else
    select sm.role into v_role
      from public.share_members sm
      join public.shares s on s.id = sm.share_id
     where s.resource_type = 'note'
       and s.resource_id = p_note_id
       and sm.user_id = v_user;
  end if;

  if v_role is null or v_role not in ('editor','owner') then
    return jsonb_build_object('status','forbidden','reason','not_editor_or_owner');
  end if;

  -- 3) Revision check（允许 p_expected_note_revision is null 跳过）
  if p_expected_note_revision is not null and v_cur_rev <> p_expected_note_revision then
    return jsonb_build_object('status','conflict_note','current_revision',v_cur_rev,'actor',v_user);
  end if;

  -- 4) 任务校验：与 v1 同，但 user_id 条件改成「任务 owner 自己 OR 任务被 ref 挂在本 note 且 v_role in editor/owner」
  --    （此处略，完整 SQL 与 031 §3 结构一致，只替换 EXISTS 子查询）
  -- 5) 写 notes + note_revision + task_item_refs 重建 + tasks 更新
  --    （与 v1 同，但更新 notes 时顺便写 last_edit_by = v_user，见 038 列位）
  -- 6) 返回 {status, note_revision, task_revisions, actor_id, saved_at}
end
$$;
revoke all on function public.save_note_with_tasks_v2(...) from public;
grant execute on function public.save_note_with_tasks_v2(...) to authenticated;
```

配套：
- 新增 security definer RPC `get_shared_notes_for_me()` 返回 `(note, role, owner_name, last_edit_at, last_edit_by_name)` 给「与我共享」列表页，避免前端用 OR 大 join 查 notes 表触发非预期计划。
- 新增 security definer RPC `list_shared_versions(p_note_id uuid, limit int, offset int)`：只有 viewer 以上成员能看历史版本（note_versions 表没有 share RLS，全走 RPC）。

### 4.4 前端接入

#### 4.4.1 分享对话框 `components/notes/share-dialog.tsx`

- 入口：笔记页右上角「更多」→ 分享；或 Tiptap 标题栏右侧新增 Share 按钮。
- Tab 分「成员」/「公开链接」两段：
  - 成员：输入邮箱或昵称，debounce `GET /api/users/search?q=xxx` → 返回列表（来自 `public.user_profiles`，service role 查不到的用户显示「发邀请邮件」）；角色下拉（viewer / editor / owner）；成员行右侧有 Kebab 删除/角色变更。
  - 公开链接：开关 access_mode（关闭 / 只读 / 可编辑）；过期日期选择；复制 `/s/<token>` 按钮。
- 状态：只有 `owner` 能改成员或公开链接设置。viewer 或 editor 只能看到面板只读。
- 只读模式提醒：如果 `my_role == 'viewer'` 或 public_read 匿名访问，Tiptap 传 `editable={false}`；显示角标「只读模式」，BubbleMenu 全灰，保存按钮隐藏。

#### 4.4.2 API 路由扩展

| 路由 | 入参 | 出参 | 用途 |
|---|---|---|---|
| `GET /api/users/search?q=` | q（≥2 字符）、limit=20 | `[{id, email, display_name, avatar_url}]` | 分享面板搜人 |
| `POST /api/share`（扩展） | resource_type/resource_id/expires_at/**access_mode**/**members**[] | `{token, url, members, access_mode}` | 创建+邀请一步完成 |
| `PATCH /api/share` | share_id/token + access_mode + expires_at | 更新公开设置 | |
| `POST /api/share/members` | share_id + email + role | 加入成员（若 profile 不存在则返回 pending） | |
| `PATCH /api/share/members` | member_id + role | 改角色 | |
| `DELETE /api/share/members` | member_id | 踢人 | |
| `GET /api/notes/shared-with-me` | 无 | `get_shared_notes_for_me()` 返回 | 「与我共享」列表 |

#### 4.4.3 保存管线接入点（`lib/notes/save-client.ts` 或 `notes/[id]/page.tsx` 的 `flushSave`）

```ts
// 保存前判断：如果我不是这篇笔记的 owner → 走 v2
const { data: role } = await supabase
  .rpc("get_my_role_for_note", { p_note_id: noteId }); // 新增小 RPC
const client = role === "owner"
  ? save_note_with_tasks(/* 原 v1 调用 */)
  : save_note_with_tasks_v2(/* 新签名，expected_revision 传 ref.current */);
```

- 冲突 UI 保持现有 `conflict_note` → 弹对话框（覆盖 / 保留远端 / 另存冲突副本）。内容与 Stage 0 以前一致，只是对话框标题可以按「来自协作者 A」+ `actor_id` 查 profile 显示名字。
- `actor_id` 映射：新增 React Context `<NoteActorContext>`，在 notes/[id]/page.tsx 初始化时建立 `userId -> profile` LRU cache，冲突弹窗 + Stage 1 的 presence 头像共享。

#### 4.4.4 「与我共享」分组与路由

- 路由 `/(main)/shared` 页面，结构仿 `/(main)/notes`：顶部搜索框、网格视图 + 列表视图切换；每行显示 owner 头像 + my_role 徽章 + last_edit_at。
- Sidebar 在「工作台 / 稍后读 / 笔记 / 待办 / 速记 / … / 垃圾箱」之间，加一个「与我共享」入口（条件：`get_shared_notes_for_me().length > 0` 才显示，避免空状态烦人）。

#### 4.4.5 备份/恢复链（迁移 062 的 restore RPC）

- `restore_backup_v2_with_pages` 里 shares/share_members 恢复时，只恢复 `owner_id = v_user` 的 share，绝不把 A 账号邀请的成员照搬到 B 账号下。
- 导出时 schema 白名单（`lib/backup/schema.ts`）要同步加：`shares: array({shareId, token, accessMode, canComment, expiresAt, members: array({userId, role})})`。
- pgTAP 062/063 加 5 条：导出含 shares → 空账号恢复 → 恢复出来的 share_members 不包含非 owner 侧成员。

### 4.5 Stage 0 验收

| # | 场景 | 期望 |
|---|---|---|
| S0-01 | A 邀请 B 为 editor → B 打开 shared 页 → 笔记出现 + 能编辑 + 保存 200 | 通过 |
| S0-02 | A 邀请 B 为 viewer → B 编辑器不响应输入、保存按钮隐藏、手动打 PATCH 保存 403 | 通过 |
| S0-03 | 陌生人 C 直接 GET `/api/notes/...` 未分享笔记 → 404/0 行（RLS 生效） | 通过 |
| S0-04 | A/B 同时编辑，A 先存 → B 点保存 → 返回 conflict_note → 三选一对齐期望（覆盖 A 最新 / 保留 B / 另存副本 revision 自增） | 通过 |
| S0-05 | 公开 token + public_read anon → 正文可看，无法保存；POST v1/v2 RPC forbidden | 通过 |
| S0-06 | 导出/恢复往返（staging 恢复演练 §3）：协作者成员不泄露到另一账号 | 通过 |
| S0-07 | `tsc --noEmit` 0 err；新增 pgTAP 063/064/065 ≥ 30 断言（角色矩阵 × 资源 × 动作） | 通过 |
| S0-08 | Playwright smoke 全部通过（`apps/web/e2e/smoke.spec.ts` 仍走 mock，不受 RLS 影响） | 通过 |

---

## 5. Stage 1：Realtime 推送（整页快照 + Presence + 冲突预警）

### 5.1 DB（迁移 066_collaboration_realtime.sql）

```sql
-- 把 notes 加入 publication（tasks/task_item_refs 已在 032 加入）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notes'
  ) then
    alter publication supabase_realtime add table public.notes;
  end if;
end $$;

-- REPLICA IDENTITY FULL，让 UPDATE 事件带完整 record
alter table public.notes replica identity full;

-- 列级过滤：notes.content 是 jsonb 大字段，只在 content/content_revision/title 变化时发事件
-- （Supabase Realtime 有 REPLICA IDENTITY + filter 语法，按文档配置）
```

### 5.2 前端 hook：`hooks/use-note-realtime-collab.ts`

```ts
useEffect(() => {
  if (mockBackend) return;  // mock 下没有 realtime
  const channel = supabase.channel(`note:${noteId}`, {
    config: { broadcast: { ack: true }, presence: { key: userId } }
  });

  // 1) Presence：头像栈
  channel.track({
    userId, email, displayName, avatarUrl,
    activeBlock: null,  // 由 selectionUpdate 事件填入
  });

  channel.on("presence", { event: "sync" }, () => {
    setPresenceState(channel.presenceState());  // → 页顶头像栈
  });

  // 2) 块级 presence：光标所在的块路径
  const onSelectionUpdate = (editor) => {
    const path = getBlockPath(editor.state.selection.$from);
    channel.track({ activeBlock: path });  // 更新 presence key
  };

  // 3) postgres_changes：整页快照推送
  channel
    .on<Row<Note>>(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "notes",
        filter: `id=eq.${noteId}` },
      (payload) => {
        if (payload.record.last_edit_by === userId) return;   // 忽略自己写回
        const remoteRev = payload.record.content_revision;
        const haveUnsaved = revisionRef.current !== remoteRev && pendingLocalChangesRef.current.size > 0;
        if (haveUnsaved) {
          setConflictBanner(`协作者更新了内容，revision ${remoteRev}`);
        } else {
          // 自动整页刷新，remote-sync 事务不进 Undo
          applyRemoteContent(payload.record.content, payload.record.title, remoteRev);
        }
      }
    )
    .subscribe();

  return () => { channel.untrack(); supabase.removeChannel(channel); };
}, [noteId, userId]);
```

- 和现有单用户 BroadcastChannel（`synced-block.tsx`）的互斥：
  - Broadcast 只处理 `broadcast.last_edit_by_user_id === currentUserId` 的消息（跨 Tab 自同步）；
  - Realtime 只处理 `record.last_edit_by !== currentUserId` 的消息（跨用户）。两者互不回环。
- 本地 dev 的 Realtime `signature_error` 已知问题：本地退化 3s 轮询（复用 `notes/[id]/page.tsx:431` 现在就有的轮询 pattern，升级成 poll for last_edit_by/revision），只在 staging/生产打开 Realtime。

### 5.3 Stage 1 UI 新增

| 组件 | 位置 | 功能 |
|---|---|---|
| `NotePresenceBar.tsx` | 标题栏右侧 | 头像栈（最多 5，超过显示 +N），悬停弹人名 + 角色 |
| `BlockPresenceBadge.tsx` | 各块 NodeView 右上角 | 该块有其他协作者光标时显示其姓名首字彩色徽标 |
| `CollaborationBanner.tsx` | Tiptap 顶部 | 黄色提示「协作者 A 正在编辑，最近一次保存 X 秒前」；红色提示「你本地有未保存改动，点击合并 / 刷新」 |

### 5.4 Stage 1 验收

| # | 场景 | 期望 |
|---|---|---|
| S1-01 | A/B 同时打开同一笔记 → A 输入 + 保存 → B < 500ms 自动更新，B Undo 栈无 A 输入（remote-sync） | 通过 |
| S1-02 | A 关 Tab → 1s 内 B Presence 头栈消失 | 通过 |
| S1-03 | B 本地有未保存输入时 A 保存 → Banner 变黄，不静默覆盖 | 通过 |
| S1-04 | 本地开发（supabase dev 的 signature_error）→ 自动退化 3s 轮询，仍能在 3s 内看到更新 | 通过 |
| S1-05 | pgTAP 066：notes 在 publication 内 + replica identity full + 触发器检查 ≥ 6 断言 | 通过 |

---

## 6. Stage 2：Yjs CRDT + 远程光标选区气泡

### 6.1 依赖与架构

- `pnpm --filter @organize/web add yjs y-prosemirror @tiptap/extension-collaboration @tiptap/extension-collaboration-cursor`
- Provider 选型：`Hocuspocus`（Edge Runtime / Fly.io 独立服务）或 `Supabase Broadcast 自定义 y-protocol handler`
- 内容源：**只在 Yjs 初始化时** 从 DB 读 JSON snapshot 建 Y.Doc；之后所有本地/远端改动走 Y.update；持久化走节流的 `save_note_with_tasks_v2( expected_note_revision = null )` 直接写 DB 整页快照（因 CRDT 天然可合并，跳过乐观锁冲突），revision 仍递增，note_versions 保持可用

### 6.2 编辑器绑定

```tsx
// 组件 <TiptapEditor> 新增 useYProvider(noteId) hook
const ydoc = useMemo(() => new Y.Doc(), [noteId]);
const yXmlFragment = ydoc.getXmlFragment("prosemirror");
const awareness = new Awareness(ydoc); awareness.setLocalState({ user: profile });

extensions: [
  Collaboration.configure({ document: ydoc }),
  CollaborationCursor.configure({
    provider,
    user: { name: profile.displayName, color: colorFromUserId(profile.id) }
  }),
  ...原 extensions,
]
```

- `transactionSource = 'remote-sync'` 语义维持：Stage 2 的远端事务也标这个，不进 Undo、不触发 task mutation（task 由 Y.Doc snapshot + save_note_with_tasks_v2 重建 task_item_refs 完成）。

### 6.3 Stage 2 验收

| # | 场景 | 期望 |
|---|---|---|
| S2-01 | 3 账号并发输入同段落 60s → 最终三人文本字节级完全一致（无重复无丢字） | 通过 |
| S2-02 | 断网 30s 内 A/B 各自输入 → 联网 3s 自动合并无弹框 | 通过 |
| S2-03 | 远程光标跟随 + 气泡显示姓名 + 选区色块正确显示 | 通过 |
| S2-04 | 历史版本功能保持可用（整页快照 + revision，打开时按 snapshot 回显） | 通过 |
| S2-05 | Stage 0/1 的所有 E2E 与 pgTAP 仍然 green（降级「未开 Yjs」路径必须保留） | 通过 |

---

## 7. 如果选工作区级共享（分叉 1-B）的扩展点

- 新增 `workspaces(id, name, avatar_url, created_at)` + `workspace_members(workspace_id, user_id, role text check in ('owner','member','guest'))`；RLS 先看 workspace_members.role。
- 所有主表 user_id 新增 `workspace_id uuid references workspaces(id)` + backfill：每一个现存 user 建一个默认 Personal Workspace，所有行 user_id.workspace_id 指向它。
- `shares` 加 `workspace_id`，新增 `workspace_default_access` 枚举（private / workspace_view / workspace_edit）。
- `save_note_with_tasks_v2` 角色解析段改为：`owner OR share_members.editor OR workspace_members.member AND workspace_default_access.editor`。

---

## 8. 工程量 & 里程碑估算

| Stage | PR 数 | 迁移数 | 新增 pgTAP 断言（≥） | 人天估算（1 个 Agent） |
|---|---|---|---|---|
| 0 权限底座 + 多人编辑（无实时） | 3–4 | 063/064/065 + user_profiles trigger | 35 | 2 |
| 1 Realtime + Presence | 1–2 | 066 | 10 | 1 |
| 2 Yjs + 远程光标 | 3–5 | 可选（无 schema 变更） | 20 | 4–7 |

**建议推进顺序：** 先拍板 §3 的 3 条分叉（默认选 A/A/暂不定 B/C）→ 落 Stage 0 的第一个 PR（user_profiles + shares access_mode 两张表 + 负例 pgTAP）→ 合 master 后再接 members/RLS/RPC/前端四块。
