-- 036 笔记版本历史 pgTAP 测试（适配 054 时间分级语义）
-- 覆盖：写入去抖（5 分钟内连续编辑只记一次）、去抖窗口后可再记、无变化不记、
--       时间分级裁剪（90 天前删除 / 7~90 天每天留最新 / 7 天内每小时留最新 / 命名版本永不清理）
BEGIN;
SELECT plan(12);

DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('47000001-0000-0000-0000-000000000001', 'nv_a@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

INSERT INTO notes (id, user_id, title, content) VALUES
('48000001-0000-0000-0000-000000000001','47000001-0000-0000-0000-000000000001','版本测试',
 '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"v0"}]}]}')
ON CONFLICT (id) DO NOTHING;

-- ========== 1. 连续编辑（5 分钟去抖窗口内）只记一次 ==========
UPDATE notes SET content='{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"v1"}]}]}'
WHERE id='48000001-0000-0000-0000-000000000001';
UPDATE notes SET content='{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"v2"}]}]}'
WHERE id='48000001-0000-0000-0000-000000000001';
UPDATE notes SET content='{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"v3"}]}]}'
WHERE id='48000001-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM note_versions WHERE note_id='48000001-0000-0000-0000-000000000001'),
  1, '连续编辑 3 次（5 分钟内）只产生 1 个版本'
);

SELECT is(
  (SELECT content->'content'->0->'content'->0->>'text' FROM note_versions WHERE note_id='48000001-0000-0000-0000-000000000001'),
  'v0', '快照存的是修改前内容（v0）'
);

-- ========== 2. 距上次快照超 5 分钟后可再记 ==========
-- 65 分钟前：既越过 5 分钟去抖窗口，又与 now() 分属不同小时桶，
-- 时间分级裁剪后两个版本都保留，计数断言与运行时刻无关（确定态）
UPDATE note_versions SET created_at = now() - interval '65 minutes'
WHERE note_id='48000001-0000-0000-0000-000000000001';
UPDATE notes SET content='{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"v4"}]}]}'
WHERE id='48000001-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM note_versions WHERE note_id='48000001-0000-0000-0000-000000000001'),
  2, '距上次快照超 5 分钟后再编辑 → 产生新版本'
);

-- ========== 3. 无实际变化不记 ==========
UPDATE notes SET title=title WHERE id='48000001-0000-0000-0000-000000000001';
SELECT is(
  (SELECT count(*)::int FROM note_versions WHERE note_id='48000001-0000-0000-0000-000000000001'),
  2, '无实际变化的 UPDATE 不产生新版本'
);

-- ========== 4~10. 时间分级裁剪（054）：直插历史快照后调用 prune，断言确定态 ==========
-- 用独立笔记隔离，绕过触发器直插 note_versions（触发器只挂 AFTER UPDATE ON notes）
INSERT INTO notes (id, user_id, title, content) VALUES
('48000001-0000-0000-0000-000000000002','47000001-0000-0000-0000-000000000001','裁剪测试',
 '{"type":"doc","content":[]}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO note_versions (note_id, content, title, message, created_at) VALUES
  -- 90 天前：未命名版本应全删
  ('48000001-0000-0000-0000-000000000002','{"type":"doc","content":[]}','旧一', now() - interval '100 days'),
  ('48000001-0000-0000-0000-000000000002','{"type":"doc","content":[]}','旧二', now() - interval '95 days'),
  -- 命名版本：100 天前也不清理
  ('48000001-0000-0000-0000-000000000002','{"type":"doc","content":[]}','里程碑', now() - interval '100 days', '手动保存'),
  -- 7~90 天：同一天两版（只留最新）+ 另一天一版（保留）
  ('48000001-0000-0000-0000-000000000002','{"type":"doc","content":[]}','中期', date_trunc('day', now()) - interval '30 days' + interval '10 hours'),
  ('48000001-0000-0000-0000-000000000002','{"type":"doc","content":[]}','中期', date_trunc('day', now()) - interval '30 days' + interval '11 hours'),
  ('48000001-0000-0000-0000-000000000002','{"type":"doc","content":[]}','中期', date_trunc('day', now()) - interval '31 days' + interval '10 hours'),
  -- 7 天内：同一小时两版（只留最新）+ 另两个不同小时各一版（都保留）
  ('48000001-0000-0000-0000-000000000002','{"type":"doc","content":[]}','近期', date_trunc('hour', now()) - interval '2 hours' + interval '10 minutes'),
  ('48000001-0000-0000-0000-000000000002','{"type":"doc","content":[]}','近期', date_trunc('hour', now()) - interval '2 hours' + interval '20 minutes'),
  ('48000001-0000-0000-0000-000000000002','{"type":"doc","content":[]}','近期', date_trunc('hour', now()) - interval '1 hour'),
  ('48000001-0000-0000-0000-000000000002','{"type":"doc","content":[]}','近期', now());

SELECT public.prune_note_versions('48000001-0000-0000-0000-000000000002');

SELECT is(
  (SELECT count(*)::int FROM note_versions
   WHERE note_id='48000001-0000-0000-0000-000000000002'
     AND message IS NULL AND created_at < now() - interval '90 days'),
  0, '90 天前的未命名版本全部删除'
);

SELECT is(
  (SELECT count(*)::int FROM note_versions
   WHERE note_id='48000001-0000-0000-0000-000000000002' AND message IS NOT NULL),
  1, '命名版本不受时间分级清理影响'
);

SELECT is(
  (SELECT count(*)::int FROM note_versions
   WHERE note_id='48000001-0000-0000-0000-000000000002'
     AND created_at = date_trunc('day', now()) - interval '30 days' + interval '10 hours'),
  0, '7~90 天内同一天较旧的版本被裁掉'
);

SELECT is(
  (SELECT count(*)::int FROM note_versions
   WHERE note_id='48000001-0000-0000-0000-000000000002'
     AND created_at = date_trunc('day', now()) - interval '30 days' + interval '11 hours'),
  1, '7~90 天内同一天只保留最新一版'
);

SELECT is(
  (SELECT count(*)::int FROM note_versions
   WHERE note_id='48000001-0000-0000-0000-000000000002'
     AND created_at = date_trunc('day', now()) - interval '31 days' + interval '10 hours'),
  1, '7~90 天内每天各自的版本都保留'
);

SELECT is(
  (SELECT count(*)::int FROM note_versions
   WHERE note_id='48000001-0000-0000-0000-000000000002'
     AND created_at = date_trunc('hour', now()) - interval '2 hours' + interval '10 minutes'),
  0, '7 天内同一小时较旧的版本被裁掉'
);

SELECT is(
  (SELECT count(*)::int FROM note_versions
   WHERE note_id='48000001-0000-0000-0000-000000000002'
     AND created_at = date_trunc('hour', now()) - interval '2 hours' + interval '20 minutes'),
  1, '7 天内同一小时只保留最新一版'
);

SELECT is(
  (SELECT count(*)::int FROM note_versions
   WHERE note_id='48000001-0000-0000-0000-000000000002'
     AND created_at >= date_trunc('hour', now()) - interval '1 hour'),
  2, '7 天内不同小时的版本都保留'
);

SELECT * FROM finish();
ROLLBACK;
