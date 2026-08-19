-- 036 笔记版本历史时间节流 pgTAP 测试
-- 覆盖：连续编辑只记一次、节流窗口后可再记、无变化不记、超 50 个剪最旧
BEGIN;
SELECT plan(6);

DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('47000001-0000-0000-0000-000000000001', 'nv_a@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

INSERT INTO notes (id, user_id, title, content) VALUES
('48000001-0000-0000-0000-000000000001','47000001-0000-0000-0000-000000000001','版本测试',
 '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"v0"}]}]}')
ON CONFLICT (id) DO NOTHING;

-- ========== 1. 连续编辑（60 秒节流窗口内）只记一次 ==========
UPDATE notes SET content='{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"v1"}]}]}'
WHERE id='48000001-0000-0000-0000-000000000001';
UPDATE notes SET content='{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"v2"}]}]}'
WHERE id='48000001-0000-0000-0000-000000000001';
UPDATE notes SET content='{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"v3"}]}]}'
WHERE id='48000001-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM note_versions WHERE note_id='48000001-0000-0000-0000-000000000001'),
  1, '连续编辑 3 次（60 秒内）只产生 1 个版本'
);

SELECT is(
  (SELECT content->'content'->0->'content'->0->>'text' FROM note_versions WHERE note_id='48000001-0000-0000-0000-000000000001'),
  'v0', '快照存的是修改前内容（v0）'
);

-- ========== 2. 距上次快照超 60 秒后可再记 ==========
UPDATE note_versions SET created_at = now() - interval '61 seconds'
WHERE note_id='48000001-0000-0000-0000-000000000001';
UPDATE notes SET content='{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"v4"}]}]}'
WHERE id='48000001-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM note_versions WHERE note_id='48000001-0000-0000-0000-000000000001'),
  2, '距上次快照超 60 秒后再编辑 → 产生新版本'
);

-- ========== 3. 无实际变化不记 ==========
UPDATE notes SET title=title WHERE id='48000001-0000-0000-0000-000000000001';
SELECT is(
  (SELECT count(*)::int FROM note_versions WHERE note_id='48000001-0000-0000-0000-000000000001'),
  2, '无实际变化的 UPDATE 不产生新版本'
);

-- ========== 4. 超 50 个版本剪最旧 ==========
-- 直接造 50 个历史快照（最旧的一个带标记），再把最近快照时间改到 61 秒前触发新增
INSERT INTO note_versions (note_id, content, title, created_at)
SELECT '48000001-0000-0000-0000-000000000001',
       '{"type":"doc","content":[]}', '填充',
       now() - (g || ' minutes')::interval
FROM generate_series(2, 50) AS g;
-- 此时共 52 个版本（2 + 50）；把最新的改到 61 秒前，让下一次编辑能触发插入
UPDATE note_versions SET created_at = now() - interval '61 seconds'
WHERE note_id='48000001-0000-0000-0000-000000000001'
  AND created_at = (SELECT max(created_at) FROM note_versions WHERE note_id='48000001-0000-0000-0000-000000000001');

UPDATE notes SET content='{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"v5"}]}]}'
WHERE id='48000001-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM note_versions WHERE note_id='48000001-0000-0000-0000-000000000001'),
  50, '触发剪枝后版本数恒为 50'
);

SELECT is(
  (SELECT count(*)::int FROM note_versions WHERE note_id='48000001-0000-0000-0000-000000000001'
    AND created_at < now() - interval '50 minutes'),
  0, '最旧的版本已被剪掉'
);

SELECT * FROM finish();
ROLLBACK;
