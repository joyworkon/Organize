-- 079 note_links 回填与对账 pgTAP（B03-3）
--
-- 覆盖（docs/note-relations-index-design.md §5）：
--   1. 权限：rebuild/reconcile 仅 service_role，authenticated 拒绝
--   2. rebuild 幂等：重跑零变化；边被误删后可重建（回填的自愈目标）
--   3. reconcile：一致时报 0；边被篡改后报漂移 + 样本；rebuild 修复归零
--   4. 分批游标：batch 截断 + p_after 续跑（按库内实际笔记动态锚定，
--      pgTAP 与开发库共存，不假设隔离总量）
BEGIN;
SELECT plan(12);

DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('79a00001-0000-0000-0000-000000000001', 'p79_a@test', '{}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- 目标 T 与两个来源：S1 链 T（期望 1 边），S2 无链接
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('79b00000-0000-0000-0000-000000000001', '79a00001-0000-0000-0000-000000000001', '目标T',
   '{"type":"doc","content":[]}'::jsonb),
  ('79b00000-0000-0000-0000-000000000002', '79a00001-0000-0000-0000-000000000001', '来源S1',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"链","marks":[{"type":"link","attrs":{"href":"/notes/79b00000-0000-0000-0000-000000000001"}}]}]}]}'::jsonb),
  ('79b00000-0000-0000-0000-000000000003', '79a00001-0000-0000-0000-000000000001', '来源S2',
   '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb);

-- ========== 1. 权限负例 ==========
SET ROLE authenticated;
SELECT throws_ok(
  'SELECT public.rebuild_note_links_batch(500, NULL)',
  '42501',
  'permission denied for function rebuild_note_links_batch'
);
SELECT throws_ok(
  'SELECT public.reconcile_note_links(500, NULL)',
  '42501',
  'permission denied for function reconcile_note_links'
);
RESET ROLE;

-- ========== 2. rebuild：幂等 + 自愈（计数按本测试播种行作用域）==========
SELECT is(
  (SELECT count(*) FROM public.note_links WHERE source_note_id = '79b00000-0000-0000-0000-000000000002')::text,
  '1', '079: 前置——触发器已为 S1 建边'
);
SELECT public.rebuild_note_links_batch(5000, NULL);
SELECT is(
  (SELECT count(*) FROM public.note_links WHERE source_note_id IN
     ('79b00000-0000-0000-0000-000000000002', '79b00000-0000-0000-0000-000000000003'))::text,
  '1', '079: rebuild 重跑幂等（S1 仍 1 边，S2 仍 0 边）'
);
-- 模拟历史缺口：postgres 直删边 → rebuild 恢复
DELETE FROM public.note_links WHERE source_note_id = '79b00000-0000-0000-0000-000000000002';
SELECT public.rebuild_note_links_batch(5000, NULL);
SELECT is(
  (SELECT count(*) FROM public.note_links WHERE source_note_id = '79b00000-0000-0000-0000-000000000002')::text,
  '1', '079: rebuild 重建缺失边（幂等回填的自愈语义）'
);

-- ========== 3. reconcile：一致 0 漂移 / 篡改后报漂移 / 修复归零 ==========
-- 上一步 rebuild 已使全库（含开发库存量笔记）与内容一致 → 全量对账确定性为 0
SELECT is(
  (public.reconcile_note_links(5000, NULL)->>'mismatched'),
  '0',
  '079: rebuild 后全量对账零漂移'
);
-- 篡改：把 S1 的边改指到不存在目标（模拟历史坏数据）
UPDATE public.note_links SET target_id = '79b00000-0000-0000-0000-00000000000f'
WHERE source_note_id = '79b00000-0000-0000-0000-000000000002';
SELECT is(
  (public.reconcile_note_links(5000, NULL)->>'mismatched'),
  '1',
  '079: 边被篡改后全量对账恰报 1 漂移'
);
SELECT is(
  (public.reconcile_note_links(5000, NULL)->'sample'->0->>'note_id'),
  '79b00000-0000-0000-0000-000000000002',
  '079: 漂移样本含问题笔记 id'
);
SELECT public.rebuild_note_links_batch(5000, NULL);
SELECT is(
  (public.reconcile_note_links(5000, NULL)->>'mismatched'),
  '0',
  '079: rebuild 修复后对账归零（回填可作对账的修复手段）'
);

-- ========== 4. 分批游标（动态锚定：批首 = 库内最小 id）==========
SELECT is(
  (public.reconcile_note_links(1, NULL)->>'checked'),
  '1',
  '079: batch=1 截断为 1 篇'
);
SELECT is(
  (public.reconcile_note_links(1, NULL)->>'last_id'),
  (SELECT id::text FROM public.notes ORDER BY id LIMIT 1),
  '079: batch 游标 = 本批末行 id（按 id keyset 首篇）'
);
SELECT is(
  (public.reconcile_note_links(1, (SELECT id FROM public.notes ORDER BY id LIMIT 1))->>'last_id'),
  (SELECT id::text FROM public.notes ORDER BY id LIMIT 1 OFFSET 1),
  '079: p_after 续跑推进到第二篇'
);

SELECT finish();
ROLLBACK;
