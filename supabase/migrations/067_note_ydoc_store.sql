-- 067 笔记 CRDT 文档 blob 存储（P5-03 生产化卡，ADR 0003「持久化（生产化卡）」）
--
-- 背景：collab-server（apps/collab-server）此前把 Y.Doc 全量放在内存，进程重启即丢
-- 房间；客户端节流快照（save_note_with_tasks_v2）只能兜底「快照间隔」内的编辑。
-- 本迁移给服务端一个可回放的二进制存储：
--   onLoadDocument 回放 blob（服务器重启不丢房间）
--   onStoreDocument（Hocuspocus 内置防抖）经 save_note_ydoc 落库
--
-- 定位与边界（违反任何一条都会重新打开本卡的坑）：
--   1. **blob 是派生缓存，不是事实源**：notes.content（客户端 v2 节流快照 + 版本链）
--      才是可读事实源。blob 丢失可从 content 重新播种，因此刻意不进备份合同 v4
--      （导出 manifest 的 EXPORT_EXCLUSIONS 显式声明），恢复出的笔记由协作会话
--      重新播种/协商。表也刻意不进 mock（mock 下协作层整体不启用，见 BLOCKED）。
--   2. **新鲜度规则（数据安全的关键）**：正文还有非协作写入路径（离线 v1/v2 乐观锁
--      保存、/api/notes/[id]/move-block、恢复备份/垃圾箱恢复），它们只动 notes 行。
--      若 blob 无条件回放，重启后会用旧 CRDT 状态遮蔽新内容并被客户端快照反向
--      覆盖（丢数据）。因此 get_note_ydoc 仅在 blob.updated_at >= notes.updated_at
--      时返回 blob，否则返回 null → 走「从 content 播种」路径（等价本卡之前的
--      「会话开始时 notes.content 为准」语义；播种后 blob 重新落库自愈）。
--      两侧时间戳同为服务端 now()，可直接比较。
--   3. **无软删豁免**：notes 软删（deleted_at not null）后 get/save 一律拒绝；
--      硬删经 FK on delete cascade 清行，不留幽灵 blob。
--   4. **权限收口**：表对 anon/authenticated 无任何直接权限（仿 057：客户端不直查，
--      全部走 RPC）；读写 RPC 以调用者 JWT 复用 063 唯一判定链 resource_role：
--      读 = owner/editor/viewer（viewer 连接也要拿到文档），
--      写 = owner/editor（viewer 连接服务端本就 readOnly）。
--      「不存在 / 软删 / 无授权」的读一律返回 null，不可区分（对齐 065 口径）。
--   5. **base64 进出**：RPC 参数用 text（decode/encode 'base64'），不依赖 PostgREST
--      对 bytea 的 JSON 映射；encode 输出里的 MIME 换行 decode 会忽略，往返无损。
--   6. **大小护栏**：单 blob 上限 4MB（正文引用图片/附件只存引用不存本体，
--      正常远小于该值）；超限明确报 ydoc_too_large，不静默截断。

create table if not exists public.note_ydocs (
  note_id uuid primary key references public.notes(id) on delete cascade,
  ydoc bytea not null,
  updated_at timestamptz not null default now()
);

-- 仿 057：客户端角色无任何直接表权限，读写只能经下方 RPC
revoke select, insert, update, delete on public.note_ydocs from authenticated;
revoke select, insert, update, delete on public.note_ydocs from anon;
grant all on public.note_ydocs to service_role;

alter table public.note_ydocs enable row level security;

-- ============================================================
-- 读：有任意协作角色（owner/editor/viewer）即可取 blob（base64）
-- 仅当 blob 不落后于 notes.updated_at 才返回（新鲜度规则见文件头第 2 条）
-- ============================================================
create or replace function public.get_note_ydoc(p_note_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_result text;
begin
  if v_user is null or p_note_id is null then
    return null;
  end if;

  -- 不存在 / 软删 / 无授权 / blob 过期 → 一律 null，不可区分
  if public.resource_role('note', p_note_id) is null then
    return null;
  end if;

  select encode(y.ydoc, 'base64')
    into v_result
    from public.note_ydocs y
    join public.notes n on n.id = y.note_id
   where y.note_id = p_note_id
     and n.deleted_at is null
     and y.updated_at >= n.updated_at;

  return v_result;
end;
$$;

-- ============================================================
-- 写：仅 owner/editor；upsert 覆盖（CRDT 全量快照，无增量合并）
-- ============================================================
create or replace function public.save_note_ydoc(p_note_id uuid, p_ydoc_b64 text)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_ydoc bytea;
begin
  if v_user is null or p_note_id is null or p_ydoc_b64 is null or p_ydoc_b64 = '' then
    raise exception 'invalid_argument';
  end if;

  v_role := public.resource_role('note', p_note_id);
  if v_role not in ('owner', 'editor') then
    raise exception 'forbidden';
  end if;

  if exists (
    select 1 from public.notes
     where id = p_note_id and deleted_at is not null
  ) then
    raise exception 'forbidden';
  end if;

  v_ydoc := decode(p_ydoc_b64, 'base64');
  if v_ydoc is null or octet_length(v_ydoc) = 0 then
    raise exception 'invalid_argument';
  end if;
  if octet_length(v_ydoc) > 4 * 1024 * 1024 then
    raise exception 'ydoc_too_large';
  end if;

  insert into public.note_ydocs (note_id, ydoc, updated_at)
  values (p_note_id, v_ydoc, now())
  on conflict (note_id) do update
    set ydoc = excluded.ydoc,
        updated_at = excluded.updated_at;
end;
$$;

-- EXECUTE 分层（沿 056 约定）：collab-server 以用户 JWT 调用（authenticated），
-- service_role 同授以备服务端维护用途；public/anon 一律收回
revoke execute on function public.get_note_ydoc(uuid) from public, anon;
revoke execute on function public.save_note_ydoc(uuid, text) from public, anon;
grant execute on function public.get_note_ydoc(uuid) to authenticated, service_role;
grant execute on function public.save_note_ydoc(uuid, text) to authenticated, service_role;
