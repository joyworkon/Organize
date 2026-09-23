-- 092 主题集合 pgTAP（阶段 3）
--
-- 覆盖：
--   1. RLS：B 看不到 A 的集合与引用行；anon 直读被拒（fail-closed）
--   2. 跨用户关联不可能：B 知道 A 的集合/阅读条目/速记/导入文件 id 也挂不进自己的集合
--      （四个复合外键）；三选一 check；重复加入幂等（部分唯一索引）
--   3. 删除语义：删除集合 cascade 清引用行但来源保留；硬删来源 cascade 清引用行
--   4. RPC collection_items_query：实时 join 标题、软删来源 available=false、
--      游标分页不重不漏、RLS 隔离（invoker）
--   5. GRANT / anon revoke

BEGIN;
SELECT plan(21);

DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('92000001-0000-0000-0000-000000000001', 'p92_a@test', '{}'),
    ('92000002-0000-0000-0000-000000000002', 'p92_b@test', '{}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- A：阅读条目 + 速记 + 导入文件 + 集合（三源各挂一条）
INSERT INTO public.reading_items (id, user_id, url, title, excerpt, content, reading_status) VALUES
  ('92000000-0000-0000-0000-0000000000b1', '92000001-0000-0000-0000-000000000001',
   'https://example.com/a', 'A 的文章', '摘要甲', '<p>正文</p>', 'unread');
INSERT INTO public.memos (id, user_id, content, tags) VALUES
  ('92000000-0000-0000-0000-0000000000d1', '92000001-0000-0000-0000-000000000001',
   'A 的速记 #测试', '{"测试"}');
INSERT INTO public.import_tasks (id, user_id, status) VALUES
  ('92000000-0000-0000-0000-0000000000a1', '92000001-0000-0000-0000-000000000001', 'saved');
INSERT INTO public.import_files (id, task_id, user_id, file_name, mime, size, kind, status, retry_key) VALUES
  ('92000000-0000-0000-0000-0000000000f1', '92000000-0000-0000-0000-0000000000a1',
   '92000001-0000-0000-0000-000000000001', '报告.pdf', 'application/pdf', 1024, 'pdf', 'saved', 'p92-1');
INSERT INTO public.collections (id, user_id, name) VALUES
  ('92000000-0000-0000-0000-0000000000c1', '92000001-0000-0000-0000-000000000001', '产品发布');
INSERT INTO public.collection_items (id, collection_id, user_id, reading_item_id) VALUES
  ('92000000-0000-0000-0000-0000000000e1', '92000000-0000-0000-0000-0000000000c1',
   '92000001-0000-0000-0000-000000000001', '92000000-0000-0000-0000-0000000000b1');
INSERT INTO public.collection_items (id, collection_id, user_id, memo_id) VALUES
  ('92000000-0000-0000-0000-0000000000e2', '92000000-0000-0000-0000-0000000000c1',
   '92000001-0000-0000-0000-000000000001', '92000000-0000-0000-0000-0000000000d1');
INSERT INTO public.collection_items (id, collection_id, user_id, import_file_id) VALUES
  ('92000000-0000-0000-0000-0000000000e3', '92000000-0000-0000-0000-0000000000c1',
   '92000001-0000-0000-0000-000000000001', '92000000-0000-0000-0000-0000000000f1');

-- B 的集合（跨用户挂载实验用）
INSERT INTO public.collections (id, user_id, name) VALUES
  ('92000000-0000-0000-0000-0000000000c2', '92000002-0000-0000-0000-000000000002', 'B 的集合');

-- ========== 1. RLS ==========
SET ROLE anon;
SELECT throws_ok($$SELECT count(*) FROM public.collections$$,
  'permission denied for table collections', '092: anon 直读 collections 被拒');
SELECT throws_ok($$SELECT count(*) FROM public.collection_items$$,
  'permission denied for table collection_items', '092: anon 直读 collection_items 被拒');
RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub TO '92000002-0000-0000-0000-000000000002';  -- B
SELECT is((SELECT count(*) FROM public.collections), 1::bigint,
  '092: B 只看到自己的集合');
SELECT is((SELECT count(*) FROM public.collection_items
  WHERE collection_id = '92000000-0000-0000-0000-0000000000c1'), 0::bigint,
  '092: B 看不到 A 的集合引用行');

-- ========== 2. 跨用户关联不可能 ==========
-- B 知道 A 的阅读条目 id：复合外键拒绝
SELECT throws_ok(
  $$INSERT INTO public.collection_items (collection_id, reading_item_id) VALUES
    ('92000000-0000-0000-0000-0000000000c2', '92000000-0000-0000-0000-0000000000b1')$$,
  'insert or update on table "collection_items" violates foreign key constraint "collection_items_reading_item_id_user_id_fkey"',
  '092: B 知道 A 的条目 id 也挂不进集合');
-- B 知道 A 的集合 id：复合外键拒绝
RESET ROLE;

-- B 的速记（供跨用户 memo 实验）+ 作为 A 的视角不存在
INSERT INTO public.memos (id, user_id, content) VALUES
  ('92000000-0000-0000-0000-0000000000d2', '92000002-0000-0000-0000-000000000002', 'B 的速记');
SELECT throws_ok(
  $$INSERT INTO public.collection_items (collection_id, memo_id) VALUES
    ('92000000-0000-0000-0000-0000000000c1', '92000000-0000-0000-0000-0000000000d2')$$,
  'insert or update on table "collection_items" violates foreign key constraint "collection_items_collection_id_user_id_fkey"',
  '092: B 知道 A 的集合 id 也挂不进（集合归属复合外键锁定，优先于其余约束）');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '92000002-0000-0000-0000-000000000002';
SELECT throws_ok(
  $$INSERT INTO public.collection_items (collection_id, memo_id) VALUES
    ('92000000-0000-0000-0000-0000000000c2', '92000000-0000-0000-0000-0000000000d1')$$,
  'insert or update on table "collection_items" violates foreign key constraint "collection_items_memo_id_user_id_fkey"',
  '092: B 知道 A 的速记 id 也挂不进');
SELECT throws_ok(
  $$INSERT INTO public.collection_items (collection_id, import_file_id) VALUES
    ('92000000-0000-0000-0000-0000000000c2', '92000000-0000-0000-0000-0000000000f1')$$,
  'insert or update on table "collection_items" violates foreign key constraint "collection_items_import_file_id_user_id_fkey"',
  '092: B 知道 A 的导入文件 id 也挂不进');

-- 三选一 check：两个来源同时给 → 拒
SELECT throws_ok(
  $$INSERT INTO public.collection_items (collection_id, reading_item_id, memo_id) VALUES
    ('92000000-0000-0000-0000-0000000000c2',
     '92000000-0000-0000-0000-0000000000b1', '92000000-0000-0000-0000-0000000000d2')$$,
  'new row for relation "collection_items" violates check constraint "collection_items_check"',
  '092: 多来源同时挂载被三选一 check 拒绝');

-- 幂等：A 重复加入同一阅读条目 → 部分唯一索引拒绝
SET request.jwt.claim.sub TO '92000001-0000-0000-0000-000000000001';  -- A
SELECT throws_ok(
  $$INSERT INTO public.collection_items (collection_id, reading_item_id) VALUES
    ('92000000-0000-0000-0000-0000000000c1', '92000000-0000-0000-0000-0000000000b1')$$,
  'duplicate key value violates unique constraint "collection_items_collection_reading_key"',
  '092: 重复加入幂等（部分唯一索引拒绝）');
RESET ROLE;

-- ========== 3. 删除语义 ==========
-- 删除集合 cascade 清引用行、来源保留
DELETE FROM public.collections WHERE id = '92000000-0000-0000-0000-0000000000c1';
SELECT is((SELECT count(*) FROM public.collection_items
  WHERE collection_id = '92000000-0000-0000-0000-0000000000c1'), 0::bigint,
  '092: 删除集合清空引用行');
SELECT is((SELECT count(*) FROM public.reading_items
  WHERE id = '92000000-0000-0000-0000-0000000000b1'), 1::bigint,
  '092: 删除集合不动来源（阅读条目保留）');
SELECT is((SELECT count(*) FROM public.memos
  WHERE id = '92000000-0000-0000-0000-0000000000d1'), 1::bigint,
  '092: 删除集合不动来源（速记保留）');

-- 重建集合并挂条目 → 硬删阅读条目 cascade 清引用行
INSERT INTO public.collections (id, user_id, name) VALUES
  ('92000000-0000-0000-0000-0000000000c3', '92000001-0000-0000-0000-000000000001', '回收实验');
INSERT INTO public.collection_items (id, collection_id, user_id, reading_item_id) VALUES
  ('92000000-0000-0000-0000-0000000000e4', '92000000-0000-0000-0000-0000000000c3',
   '92000001-0000-0000-0000-000000000001', '92000000-0000-0000-0000-0000000000b1');
DELETE FROM public.reading_items WHERE id = '92000000-0000-0000-0000-0000000000b1';
SELECT is((SELECT count(*) FROM public.collection_items
  WHERE id = '92000000-0000-0000-0000-0000000000e4'), 0::bigint,
  '092: 硬删来源 cascade 清引用行');

-- ========== 4. RPC（软删状态 + 分页 + RLS）==========
-- 重建数据：条目（活跃）、速记、软删速记
INSERT INTO public.reading_items (id, user_id, url, title, excerpt, content, reading_status) VALUES
  ('92000000-0000-0000-0000-0000000000b2', '92000001-0000-0000-0000-000000000001',
   'https://example.com/b2', 'RPC 文章', 'RPC 摘要', '<p>正文</p>', 'unread');
INSERT INTO public.memos (id, user_id, content) VALUES
  ('92000000-0000-0000-0000-0000000000d3', '92000001-0000-0000-0000-000000000001', '软删速记');
INSERT INTO public.collections (id, user_id, name) VALUES
  ('92000000-0000-0000-0000-0000000000c4', '92000001-0000-0000-0000-000000000001', 'RPC 集合');
INSERT INTO public.collection_items (id, collection_id, user_id, reading_item_id, created_at) VALUES
  ('92000000-0000-0000-0000-00000000001a', '92000000-0000-0000-0000-0000000000c4',
   '92000001-0000-0000-0000-000000000001', '92000000-0000-0000-0000-0000000000b2',
   now() - interval '3 min');
INSERT INTO public.collection_items (id, collection_id, user_id, memo_id, created_at) VALUES
  ('92000000-0000-0000-0000-00000000001b', '92000000-0000-0000-0000-0000000000c4',
   '92000001-0000-0000-0000-000000000001', '92000000-0000-0000-0000-0000000000d1',
   now() - interval '2 min');
INSERT INTO public.collection_items (id, collection_id, user_id, memo_id, created_at) VALUES
  ('92000000-0000-0000-0000-00000000001c', '92000000-0000-0000-0000-0000000000c4',
   '92000001-0000-0000-0000-000000000001', '92000000-0000-0000-0000-0000000000d3',
   now() - interval '1 min');

SET ROLE authenticated;
SET request.jwt.claim.sub TO '92000001-0000-0000-0000-000000000001';  -- A

-- 软删一条速记 → RPC available=false（引用行保留）
UPDATE public.memos SET deleted_at = now() WHERE id = '92000000-0000-0000-0000-0000000000d3';

SELECT is((
  SELECT count(*) FROM public.collection_items_query('92000000-0000-0000-0000-0000000000c4', 10)
), 3::bigint, '092: RPC 返回全部引用行（含不可用来源）');

SELECT is((
  SELECT bool_and(available = (source_type <> 'memo' OR source_id <> '92000000-0000-0000-0000-0000000000d3'))
  FROM public.collection_items_query('92000000-0000-0000-0000-0000000000c4', 10)
), true, '092: 软删来源 available=false，活跃来源 true');

SELECT is((
  SELECT title FROM public.collection_items_query('92000000-0000-0000-0000-0000000000c4', 10)
  WHERE source_type = 'reading'
), 'RPC 文章', '092: reading 来源实时 join 标题');

-- 分页：limit 2 翻两页不重不漏（created_at DESC）
SELECT is((
  WITH p1 AS (
    SELECT * FROM public.collection_items_query('92000000-0000-0000-0000-0000000000c4', 2)
  ),
  last_row AS (
    SELECT created_at, id FROM p1 ORDER BY created_at DESC LIMIT 1
  ),
  p2 AS (
    SELECT q.* FROM public.collection_items_query(
      '92000000-0000-0000-0000-0000000000c4', 2,
      (SELECT created_at FROM last_row),
      (SELECT id FROM last_row)
    ) q
  ),
  all_rows AS (
    SELECT id FROM p1 UNION SELECT id FROM p2
  )
  SELECT count(*) FROM all_rows
), 3::bigint, '092: RPC 游标分页两页合计 3 行不重不漏');

-- RLS（invoker）：B 查 A 的集合 → 空
SET request.jwt.claim.sub TO '92000002-0000-0000-0000-000000000002';  -- B
SELECT is((
  SELECT count(*) FROM public.collection_items_query('92000000-0000-0000-0000-0000000000c4', 10)
), 0::bigint, '092: RPC 对 B 返回空（security invoker + RLS）');
RESET ROLE;

-- ========== 5. GRANT ==========
SELECT is(has_table_privilege('authenticated', 'public.collections', 'INSERT'), true,
  '092: authenticated 可插 collections');
SELECT is(has_table_privilege('authenticated', 'public.collection_items', 'DELETE'), true,
  '092: authenticated 可删 collection_items');

SELECT * FROM finish();
ROLLBACK;
