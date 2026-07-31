-- G1 pgTAP 测试:save_note_with_tasks RPC + task_item_refs RLS
-- 运行:supabase test db
-- 覆盖:基本ok / revision冲突 / 跨用户禁止 / 幂等重放 / 引用对齐 / orphaned回收
--
-- 说明:RPC 用 auth.uid() 读 JWT claim。测试会话以 postgres 身份运行,
-- 用 "set role authenticated; set request.jwt.claim.sub to '<uid>'" 模拟用户,
-- 调完 reset role。pgTAP 的 is() 包不了多条 set 语句,所以每个场景用
-- DO 块把结果塞进临时表,再 is() 断言。

BEGIN;
SELECT plan(10);

-- ========== 公共数据 ==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('11111111-0000-0000-0000-000000000001', 'g1a@test'),
    ('22222222-0000-0000-0000-000000000002', 'g1b@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

INSERT INTO notes (id, user_id, title, content, content_revision) VALUES
  ('31000001-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','noteA',
   '{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"id":"blkA1","checked":false,"taskId":"32000001-0000-0000-0000-000000000001"}}]}]}'::jsonb, 0)
  ON CONFLICT (id) DO UPDATE SET content_revision=0, content=EXCLUDED.content;
INSERT INTO tasks (id, user_id, title, status, reference_managed, sync_version) VALUES
  ('32000001-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','taskA1','todo',true,0)
  ON CONFLICT (id) DO UPDATE SET status='todo', sync_version=0, deleted_at=null, deleted_reason=null, reference_managed=true;

-- 结果收集临时表
CREATE TEMP TABLE _r(status text, note_rev int, task_status text, task_sync int, refs int, deleted int, reason text);

-- ========== 1. 基本 ok ==========
DO $$
DECLARE res jsonb;
BEGIN
  set role authenticated;
  set request.jwt.claim.sub to '11111111-0000-0000-0000-000000000001';
  res := save_note_with_tasks(
    '31000001-0000-0000-0000-000000000001',
    '{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"id":"blkA1","checked":true,"taskId":"32000001-0000-0000-0000-000000000001"}}]}]}'::jsonb,
    0, null,
    '[{"task_id":"32000001-0000-0000-0000-000000000001","title":"taskA1","status":"done"}]'::jsonb,
    '{"32000001-0000-0000-0000-000000000001":0}'::jsonb, null);
  reset role;
  INSERT INTO _r SELECT res->>'status', null, null, null, null, null, null;
END $$;
SELECT is((SELECT status FROM _r), 'ok', '基本保存:status=ok');
TRUNCATE _r;

SELECT is((SELECT status FROM tasks WHERE id='32000001-0000-0000-0000-000000000001'), 'done', 'task status 同步为 done');
SELECT is((SELECT count(*)::int FROM task_item_refs WHERE note_id='31000001-0000-0000-0000-000000000001'), 1, 'ref 对齐:1 条绑定块');

-- ========== 2. revision 冲突(note_revision 已是 1,预期传 0) ==========
DO $$
DECLARE res jsonb;
BEGIN
  set role authenticated;
  set request.jwt.claim.sub to '11111111-0000-0000-0000-000000000001';
  res := save_note_with_tasks('31000001-0000-0000-0000-000000000001',
    '{"type":"doc","content":[]}'::jsonb, 0, null, null, null, null);
  reset role;
  INSERT INTO _r SELECT res->>'status', null,null,null,null,null,null;
END $$;
SELECT is((SELECT status FROM _r), 'conflict_note', 'revision 冲突返回 conflict_note(不覆盖)');
TRUNCATE _r;

-- ========== 3. 跨用户禁止 ==========
DO $$
DECLARE res jsonb;
BEGIN
  set role authenticated;
  set request.jwt.claim.sub to '22222222-0000-0000-0000-000000000002';
  res := save_note_with_tasks('31000001-0000-0000-0000-000000000001',
    '{"type":"doc","content":[]}'::jsonb, 1, null, null, null, null);
  reset role;
  INSERT INTO _r SELECT res->>'status', null,null,null,null,null,null;
END $$;
SELECT is((SELECT status FROM _r), 'forbidden', '跨用户伪造:B 保存 A 的笔记返回 forbidden');
TRUNCATE _r;

-- ========== 4. 幂等重放 ==========
DO $$
DECLARE res jsonb; cur_rev int;
BEGIN
  SELECT content_revision INTO cur_rev FROM notes WHERE id='31000001-0000-0000-0000-000000000001';
  set role authenticated;
  set request.jwt.claim.sub to '11111111-0000-0000-0000-000000000001';
  res := save_note_with_tasks('31000001-0000-0000-0000-000000000001',
    (SELECT content FROM notes WHERE id='31000001-0000-0000-0000-000000000001'),
    cur_rev, null, null, null, '41000000-0000-0000-0000-000000000001');
  reset role;
  INSERT INTO _r SELECT res->>'status', null,null,null,null,null,null;
END $$;
SELECT is((SELECT status FROM _r), 'ok', '幂等:首次带 mutation_id 保存 ok');
TRUNCATE _r;
-- 再用同 mutation_id 二次调,预期返回缓存(仍是 ok,且 note_revision 不再涨)
DO $$
DECLARE res jsonb; rev_before int; rev_after int;
BEGIN
  SELECT content_revision INTO rev_before FROM notes WHERE id='31000001-0000-0000-0000-000000000001';
  set role authenticated;
  set request.jwt.claim.sub to '11111111-0000-0000-0000-000000000001';
  res := save_note_with_tasks('31000001-0000-0000-0000-000000000001',
    (SELECT content FROM notes WHERE id='31000001-0000-0000-0000-000000000001'),
    rev_before, null, null, null, '41000000-0000-0000-0000-000000000001');
  SELECT content_revision INTO rev_after FROM notes WHERE id='31000001-0000-0000-0000-000000000001';
  reset role;
  INSERT INTO _r SELECT res->>'status', rev_before, null, null, null, null, null;
  -- 校验 rev 没涨:用 reason 字段塞 rev_before=rev_after 标记
  UPDATE _r SET reason = (rev_before = rev_after)::text WHERE reason IS NULL;
END $$;
SELECT is((SELECT status FROM _r), 'ok', '幂等:同 mutation_id 二次返回缓存结果');
SELECT is((SELECT reason FROM _r), 'true', '幂等:二次调用 note_revision 未变(走缓存)');
TRUNCATE _r;

-- ========== 5. orphaned 回收 ==========
DO $$
DECLARE cur_rev int;
BEGIN
  SELECT content_revision INTO cur_rev FROM notes WHERE id='31000001-0000-0000-0000-000000000001';
  set role authenticated;
  set request.jwt.claim.sub to '11111111-0000-0000-0000-000000000001';
  PERFORM save_note_with_tasks('31000001-0000-0000-0000-000000000001',
    '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    cur_rev, null, null, null, null);
  reset role;
END $$;
SELECT is((SELECT count(*)::int FROM task_item_refs WHERE note_id='31000001-0000-0000-0000-000000000001'), 0, 'ref 全清(content 无 taskItem)');
SELECT is((SELECT deleted_reason FROM tasks WHERE id='32000001-0000-0000-0000-000000000001'), 'orphaned', 'orphaned 回收:末引用消失→deleted_reason=orphaned');

SELECT * FROM finish();
ROLLBACK;
