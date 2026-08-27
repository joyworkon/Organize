-- 046 版本恢复递增 content_revision pgTAP 测试
-- 覆盖：恢复后 revision +1、内容/标题替换、他人版本不可恢复、版本不存在报 version_not_found
BEGIN;
SELECT plan(6);

DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('48000001-0000-0000-0000-000000000001', 'rv_a@test'),
    ('48000002-0000-0000-0000-000000000002', 'rv_b@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- 准备用户 A 的笔记与两个历史版本
INSERT INTO notes (id, user_id, title, content, content_revision) VALUES
  ('48010000-0000-0000-0000-000000000001', '48000001-0000-0000-0000-000000000001',
   '当前标题', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb, 7);

INSERT INTO note_versions (id, note_id, title, content) VALUES
  ('48020000-0000-0000-0000-000000000001', '48010000-0000-0000-0000-000000000001',
   '旧标题A', '{"type":"doc","content":[{"type":"heading","attrs":{"level":1}}]}'::jsonb),
  ('48020000-0000-0000-0000-000000000002', '48010000-0000-0000-0000-000000000001',
   '旧标题B', '{"type":"doc","content":[]}'::jsonb);

-- 用户 B 的笔记（跨用户用例）
INSERT INTO notes (id, user_id, title, content, content_revision) VALUES
  ('48010000-0000-0000-0000-000000000002', '48000002-0000-0000-0000-000000000002',
   'B的笔记', '{"type":"doc","content":[]}'::jsonb, 1);
INSERT INTO note_versions (id, note_id, title, content) VALUES
  ('48020000-0000-0000-0000-000000000003', '48010000-0000-0000-0000-000000000002',
   'B的旧版', '{"type":"doc","content":[]}'::jsonb);

-- ========== 1. 正常恢复：revision 7 → 8 ==========
set role authenticated;
set request.jwt.claim.sub to '48000001-0000-0000-0000-000000000001';

SELECT is(
  restore_note_version(
    '48010000-0000-0000-0000-000000000001',
    '48020000-0000-0000-0000-000000000001'
  ) ->> 'status',
  'ok',
  '恢复成功返回 ok'
);

reset role;

SELECT is(
  (SELECT content_revision FROM notes WHERE id = '48010000-0000-0000-0000-000000000001'),
  8,
  '恢复后 revision 递增为 8'
);

-- 内容与标题确实换成旧版本的
SELECT is(
  (SELECT title FROM notes WHERE id = '48010000-0000-0000-0000-000000000001'),
  '旧标题A',
  '恢复后标题变为历史版本标题'
);
SELECT is(
  (SELECT (content -> 'content' -> 0 ->> 'type') FROM notes WHERE id = '48010000-0000-0000-0000-000000000001'),
  'heading',
  '恢复后正文换为历史版本内容'
);

-- ========== 2. 恢复不存在的版本 → version_not_found ==========
set role authenticated;
set request.jwt.claim.sub to '48000001-0000-0000-0000-000000000001';

SELECT is(
  (restore_note_version(
    '48010000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000009'
  ) ->> 'status'),
  'version_not_found',
  '版本不存在时返回 version_not_found'
);

reset role;

-- ========== 3. 不能恢复别人笔记的版本（RLS 先隐藏他人版本行）==========
set role authenticated;
set request.jwt.claim.sub to '48000001-0000-0000-0000-000000000001';

SELECT is(
  restore_note_version(
    '48010000-0000-0000-0000-000000000002',
    '48020000-0000-0000-0000-000000000003'
  ) ->> 'status',
  'version_not_found',
  '恢复他人笔记的版本被 RLS 拦截为 version_not_found'
);

reset role;

SELECT * FROM finish();
ROLLBACK;
