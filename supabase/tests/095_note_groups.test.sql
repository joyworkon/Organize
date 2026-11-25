-- 095 笔记分组（094 的 note_groups / note_group_members）pgTAP
--
-- 094 自身没有任何 pgTAP。这里按 AGENTS.md「新增鉴权 / RLS 必须有双用户越权 pgTAP」补齐：
--   1. 表级权限：authenticated 两张表读写齐备（分组是硬删除，客户端 lib/notes/groups.ts
--      会直接 delete），anon 一项权限都没有；RLS 已开启
--   2. anon 直读被拒（fail-closed）
--   3. A 的全流程：建组 → 归入 → 读取 → 改名 → 移出 → 删组（即客户端的读写路径）
--   4. B 越权：看不到、改不动、删不掉；知道 A 的组 / 笔记 id 也挂不进（两个复合外键）；
--      以 A 的身份写入被策略拒绝
--   5. 删除语义：删组 cascade 清成员行，笔记本身保留
--
-- CI 跑的 pgTAP 没有 rls_enabled()，结构断言直接查系统目录。

BEGIN;
SELECT plan(42);

DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('95000001-0000-0000-0000-000000000001', 'p95_a@test', '{}'),
    ('95000002-0000-0000-0000-000000000002', 'p95_b@test', '{}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- A、B 各一篇笔记：成员行的复合外键 (note_id, user_id) 指向 notes(id, user_id)
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('95000000-0000-0000-0000-0000000000a1', '95000001-0000-0000-0000-000000000001',
   'A的笔记', '{"type":"doc","content":[{"type":"paragraph"}]}'),
  ('95000000-0000-0000-0000-0000000000a2', '95000002-0000-0000-0000-000000000002',
   'B的笔记', '{"type":"doc","content":[{"type":"paragraph"}]}');

-- ========== 1. 表级权限 ==========
SELECT is(has_table_privilege('authenticated', 'public.note_groups', 'SELECT'), true,
  '095: authenticated 可读 note_groups');
SELECT is(has_table_privilege('authenticated', 'public.note_groups', 'INSERT'), true,
  '095: authenticated 可插 note_groups');
SELECT is(has_table_privilege('authenticated', 'public.note_groups', 'UPDATE'), true,
  '095: authenticated 可改 note_groups');
SELECT is(has_table_privilege('authenticated', 'public.note_groups', 'DELETE'), true,
  '095: authenticated 可删 note_groups');
SELECT is(has_table_privilege('authenticated', 'public.note_group_members', 'SELECT'), true,
  '095: authenticated 可读 note_group_members');
SELECT is(has_table_privilege('authenticated', 'public.note_group_members', 'INSERT'), true,
  '095: authenticated 可插 note_group_members');
SELECT is(has_table_privilege('authenticated', 'public.note_group_members', 'UPDATE'), true,
  '095: authenticated 可改 note_group_members');
SELECT is(has_table_privilege('authenticated', 'public.note_group_members', 'DELETE'), true,
  '095: authenticated 可删 note_group_members');

SELECT is(has_table_privilege('anon', 'public.note_groups', 'SELECT'), false,
  '095: anon 不可读 note_groups');
SELECT is(has_table_privilege('anon', 'public.note_groups', 'INSERT'), false,
  '095: anon 不可插 note_groups');
SELECT is(has_table_privilege('anon', 'public.note_groups', 'UPDATE'), false,
  '095: anon 不可改 note_groups');
SELECT is(has_table_privilege('anon', 'public.note_groups', 'DELETE'), false,
  '095: anon 不可删 note_groups');
SELECT is(has_table_privilege('anon', 'public.note_group_members', 'SELECT'), false,
  '095: anon 不可读 note_group_members');
SELECT is(has_table_privilege('anon', 'public.note_group_members', 'INSERT'), false,
  '095: anon 不可插 note_group_members');
SELECT is(has_table_privilege('anon', 'public.note_group_members', 'UPDATE'), false,
  '095: anon 不可改 note_group_members');
SELECT is(has_table_privilege('anon', 'public.note_group_members', 'DELETE'), false,
  '095: anon 不可删 note_group_members');

SELECT is((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'note_groups'), true,
  '095: note_groups 开启 RLS');
SELECT is((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'note_group_members'), true,
  '095: note_group_members 开启 RLS');

-- ========== 2. anon 直读被拒 ==========
SET ROLE anon;
SELECT throws_ok($$SELECT count(*) FROM public.note_groups$$,
  '42501', 'permission denied for table note_groups', '095: anon 直读 note_groups 被拒');
SELECT throws_ok($$SELECT count(*) FROM public.note_group_members$$,
  '42501', 'permission denied for table note_group_members', '095: anon 直读 note_group_members 被拒');
RESET ROLE;

-- ========== 3. A 的全流程（客户端的读写路径）==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '95000001-0000-0000-0000-000000000001';  -- A
SELECT lives_ok($$INSERT INTO public.note_groups (id, user_id, name, sort_order) VALUES
  ('95000000-0000-0000-0000-0000000000c1', '95000001-0000-0000-0000-000000000001', '项目', 0)$$,
  '095: A 可建组');
SELECT lives_ok($$INSERT INTO public.note_group_members (note_id, group_id, user_id) VALUES
  ('95000000-0000-0000-0000-0000000000a1', '95000000-0000-0000-0000-0000000000c1',
   '95000001-0000-0000-0000-000000000001')$$,
  '095: A 可把笔记归入分组');
SELECT is((SELECT count(*) FROM public.note_group_members
  WHERE group_id = '95000000-0000-0000-0000-0000000000c1'), 1::bigint,
  '095: A 读得到自己的成员关系');
SELECT lives_ok($$UPDATE public.note_groups SET name = '新名字'
  WHERE id = '95000000-0000-0000-0000-0000000000c1'$$,
  '095: A 可改组名');
SELECT is((SELECT name FROM public.note_groups
  WHERE id = '95000000-0000-0000-0000-0000000000c1'), '新名字',
  '095: 改名已生效（BEFORE UPDATE 触发器没有引用不存在的列）');
SELECT lives_ok($$DELETE FROM public.note_group_members
  WHERE note_id = '95000000-0000-0000-0000-0000000000a1'$$,
  '095: A 可把笔记移出分组');
SELECT lives_ok($$INSERT INTO public.note_group_members (note_id, group_id, user_id) VALUES
  ('95000000-0000-0000-0000-0000000000a1', '95000000-0000-0000-0000-0000000000c1',
   '95000001-0000-0000-0000-000000000001')$$,
  '095: A 可再次归入（后续越权实验需要这条成员行）');
SELECT lives_ok($$INSERT INTO public.note_groups (id, user_id, name) VALUES
  ('95000000-0000-0000-0000-0000000000c9', '95000001-0000-0000-0000-000000000001', '待删')$$,
  '095: A 可再建一个组');
SELECT lives_ok($$DELETE FROM public.note_groups
  WHERE id = '95000000-0000-0000-0000-0000000000c9'$$,
  '095: A 可删组（客户端直接 delete，不走 RPC）');

-- ========== 4. B 越权 ==========
SET request.jwt.claim.sub TO '95000002-0000-0000-0000-000000000002';  -- B
SELECT lives_ok($$INSERT INTO public.note_groups (id, user_id, name) VALUES
  ('95000000-0000-0000-0000-0000000000c2', '95000002-0000-0000-0000-000000000002', 'B 的组')$$,
  '095: B 可建自己的组');
SELECT is((SELECT count(*) FROM public.note_groups), 1::bigint,
  '095: B 只看到自己的组');
SELECT is((SELECT count(*) FROM public.note_group_members), 0::bigint,
  '095: B 看不到 A 的成员关系');
SELECT results_eq(
  $$WITH updated AS (UPDATE public.note_groups SET name = '劫持'
      WHERE id = '95000000-0000-0000-0000-0000000000c1' RETURNING 1)
    SELECT count(*) FROM updated$$,
  $$VALUES (0::bigint)$$,
  '095: B 改不了 A 的组名');
SELECT results_eq(
  $$WITH deleted AS (DELETE FROM public.note_group_members
      WHERE group_id = '95000000-0000-0000-0000-0000000000c1' RETURNING 1)
    SELECT count(*) FROM deleted$$,
  $$VALUES (0::bigint)$$,
  '095: B 删不掉 A 的成员关系');
-- 复合外键 (group_id, user_id) → note_groups(id, user_id)：B 知道 A 的组 id 也挂不进
SELECT throws_ok($$INSERT INTO public.note_group_members (note_id, group_id, user_id) VALUES
  ('95000000-0000-0000-0000-0000000000a2', '95000000-0000-0000-0000-0000000000c1',
   '95000002-0000-0000-0000-000000000002')$$,
  '23503', 'insert or update on table "note_group_members" violates foreign key constraint "note_group_members_group_fkey"',
  '095: B 知道 A 的组 id 也挂不进');
-- 复合外键 (note_id, user_id) → notes(id, user_id)：B 知道 A 的笔记 id 也归不进自己的组
SELECT throws_ok($$INSERT INTO public.note_group_members (note_id, group_id, user_id) VALUES
  ('95000000-0000-0000-0000-0000000000a1', '95000000-0000-0000-0000-0000000000c2',
   '95000002-0000-0000-0000-000000000002')$$,
  '23503', 'insert or update on table "note_group_members" violates foreign key constraint "note_group_members_note_fkey"',
  '095: B 知道 A 的笔记 id 也归不进自己的组');
-- 以 A 的身份写入：插入策略 with check (auth.uid() = user_id) 拒绝
SELECT throws_ok($$INSERT INTO public.note_groups (id, user_id, name) VALUES
  ('95000000-0000-0000-0000-0000000000c8', '95000001-0000-0000-0000-000000000001', '冒名')$$,
  '42501', 'new row violates row-level security policy for table "note_groups"',
  '095: B 不能以 A 的身份建组');
SELECT throws_ok($$INSERT INTO public.note_group_members (note_id, group_id, user_id) VALUES
  ('95000000-0000-0000-0000-0000000000a2', '95000000-0000-0000-0000-0000000000c2',
   '95000001-0000-0000-0000-000000000001')$$,
  '42501', 'new row violates row-level security policy for table "note_group_members"',
  '095: B 不能以 A 的身份写成员关系');
RESET ROLE;

-- 越权实验之后 A 的数据原样
SELECT is((SELECT name FROM public.note_groups
  WHERE id = '95000000-0000-0000-0000-0000000000c1'), '新名字',
  '095: A 的组名未被改动');
SELECT is((SELECT count(*) FROM public.note_group_members
  WHERE group_id = '95000000-0000-0000-0000-0000000000c1'), 1::bigint,
  '095: A 的成员关系未被删除');

-- ========== 5. 删除语义 ==========
DELETE FROM public.note_groups WHERE id = '95000000-0000-0000-0000-0000000000c1';
SELECT is((SELECT count(*) FROM public.note_group_members
  WHERE group_id = '95000000-0000-0000-0000-0000000000c1'), 0::bigint,
  '095: 删除分组 cascade 清成员行');
SELECT is((SELECT count(*) FROM public.notes
  WHERE id = '95000000-0000-0000-0000-0000000000a1'), 1::bigint,
  '095: 删除分组不动笔记');

SELECT * FROM finish();
ROLLBACK;
