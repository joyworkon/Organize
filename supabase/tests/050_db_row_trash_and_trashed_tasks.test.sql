-- 050 db_rows 单行软删除 + 已删任务列表 pgTAP 测试
-- 覆盖：database_row 软删/恢复/物理删除；直接 UPDATE db_rows 仍被拒（设计护栏）；
-- list_trashed_tasks 只返回当前用户的已删任务且含 tags；database 整库删除分支回归。
BEGIN;
SELECT plan(9);

DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('49000010-0000-0000-0000-000000000001', 'trash_fix_a@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- 准备：一个库 + 两行；两个任务（其一软删并带标签）
INSERT INTO db_databases (id, user_id, title) VALUES
  ('49040000-0000-0000-0000-000000000001', '49000010-0000-0000-0000-000000000001', '测试库A');
INSERT INTO db_rows (id, user_id, database_id, sort, values) VALUES
  ('49040000-0000-0000-0000-000000000002', '49000010-0000-0000-0000-000000000001',
   '49040000-0000-0000-0000-000000000001', 0, '{"name":"行1"}'::jsonb),
  ('49040000-0000-0000-0000-000000000003', '49000010-0000-0000-0000-000000000001',
   '49040000-0000-0000-0000-000000000001', 1, '{"name":"行2"}'::jsonb);

-- ========== 场景一：直接 UPDATE db_rows 设置 deleted_at 仍被拒（护栏不变） ==========
set role authenticated;
set request.jwt.claim.sub to '49000010-0000-0000-0000-000000000001';

SELECT throws_ok(
  $$UPDATE db_rows SET deleted_at = now() WHERE id = '49040000-0000-0000-0000-000000000002'$$,
  NULL,
  '直接 UPDATE db_rows 设置 deleted_at 被拒（42501）——必须走 mutate_trash'
);

-- ========== 场景二：database_row 软删 / 恢复 ==========
SELECT is(
  mutate_trash('soft_delete', 'database_row', ARRAY['49040000-0000-0000-0000-000000000002']::uuid[]),
  1,
  'database_row 软删单行成功'
);

reset role;

SELECT is(
  (SELECT count(*)::int FROM db_rows WHERE id = '49040000-0000-0000-0000-000000000002' AND deleted_at IS NOT NULL),
  1,
  '行 2 已软删（属主视角断言）'
);

SELECT is(
  (SELECT count(*)::int FROM db_rows WHERE database_id = '49040000-0000-0000-0000-000000000001' AND deleted_at IS NULL),
  1,
  '同库其余行不受影响'
);

set role authenticated;
set request.jwt.claim.sub to '49000010-0000-0000-0000-000000000001';

SELECT is(
  mutate_trash('restore', 'database_row', ARRAY['49040000-0000-0000-0000-000000000002']::uuid[]),
  1,
  'database_row 恢复成功'
);

reset role;

-- ========== 场景三：database_row 物理删除（仅删已软删行） ==========
set role authenticated;
set request.jwt.claim.sub to '49000010-0000-0000-0000-000000000001';
SELECT mutate_trash('soft_delete', 'database_row', ARRAY['49040000-0000-0000-0000-000000000003']::uuid[]);
reset role;

set role authenticated;
set request.jwt.claim.sub to '49000010-0000-0000-0000-000000000001';

SELECT is(
  mutate_trash('permanent_delete', 'database_row', ARRAY['49040000-0000-0000-0000-000000000003']::uuid[]),
  1,
  'database_row 物理删除已软删行成功'
);

reset role;

SELECT is(
  (SELECT count(*)::int FROM db_rows WHERE id = '49040000-0000-0000-0000-000000000003'),
  0,
  '行 3 已物理删除'
);

-- ========== 场景四：list_trashed_tasks 返回已删任务（含 tags） ==========
INSERT INTO tasks (id, user_id, title, status, category, deleted_at) VALUES
  ('49040000-0000-0000-0000-000000000004', '49000010-0000-0000-0000-000000000001',
   '已删任务', 'todo', 'work', now());
INSERT INTO tags (id, user_id, name) VALUES
  ('49040000-0000-0000-0000-000000000005', '49000010-0000-0000-0000-000000000001', '测试标签');
INSERT INTO task_tags (task_id, tag_id) VALUES
  ('49040000-0000-0000-0000-000000000004', '49040000-0000-0000-0000-000000000005');

set role authenticated;
set request.jwt.claim.sub to '49000010-0000-0000-0000-000000000001';

SELECT is(
  (SELECT jsonb_array_length(list_trashed_tasks())),
  1,
  'list_trashed_tasks 只含已删任务（活跃任务不在内）'
);

SELECT is(
  (SELECT list_trashed_tasks() -> 0 -> 'tags' -> 0 ->> 'name'),
  '测试标签',
  '已删任务的 tags 聚合正确'
);

reset role;

SELECT * FROM finish();
ROLLBACK;
