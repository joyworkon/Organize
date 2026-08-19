-- 037 笔记全文搜索 pgTAP 测试
-- 覆盖：search_text 提取正文（含嵌套）、随更新自动维护、ilike 命中、
--       非数组 content 不报错、跨用户 RLS 不可见
BEGIN;
SELECT plan(6);

DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('49000001-0000-0000-0000-000000000001', 'fs_a@test'),
    ('49000002-0000-0000-0000-000000000002', 'fs_b@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

INSERT INTO notes (id, user_id, title, content) VALUES
('4a000001-0000-0000-0000-000000000001','49000001-0000-0000-0000-000000000001','搜索测试笔记',
 '{"type":"doc","content":[
    {"type":"paragraph","content":[{"type":"text","text":"外层文字"}]},
    {"type":"callout","attrs":{"emoji":"💡"},"content":[
      {"type":"paragraph","content":[{"type":"text","text":"独特关键词藏在嵌套块里"}]}
    ]}
  ]}')
ON CONFLICT (id) DO NOTHING;

-- ========== 1. 生成列提取正文（含嵌套块） ==========
SELECT ok(
  (SELECT search_text LIKE '%外层文字%' FROM notes WHERE id='4a000001-0000-0000-0000-000000000001'),
  'search_text 提取顶层段落文字'
);
SELECT ok(
  (SELECT search_text LIKE '%独特关键词藏在嵌套块里%' FROM notes WHERE id='4a000001-0000-0000-0000-000000000001'),
  'search_text 提取嵌套块（callout）里的文字'
);

-- ========== 2. ilike 全文命中 ==========
SELECT is(
  (SELECT count(*)::int FROM notes
   WHERE user_id='49000001-0000-0000-0000-000000000001'
     AND (title ILIKE '%独特关键词%' OR search_text ILIKE '%独特关键词%')),
  1, '正文关键词可被搜索命中（标题不含该词）'
);

-- ========== 3. 更新 content 后生成列自动维护 ==========
UPDATE notes SET content='{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"换了全新的内容"}]}]}'
WHERE id='4a000001-0000-0000-0000-000000000001';
SELECT ok(
  (SELECT search_text LIKE '%换了全新的内容%' AND search_text NOT LIKE '%独特关键词%'
   FROM notes WHERE id='4a000001-0000-0000-0000-000000000001'),
  'content 更新后 search_text 自动更新'
);

-- ========== 4. 非数组 content 不报错 ==========
INSERT INTO notes (id, user_id, title, content) VALUES
('4a000002-0000-0000-0000-000000000002','49000001-0000-0000-0000-000000000001','畸形内容',
 '{"type":"doc","content":{"unexpected":"object"}}')
ON CONFLICT (id) DO NOTHING;
SELECT is(
  (SELECT (search_text IS NOT NULL)::int FROM notes WHERE id='4a000002-0000-0000-0000-000000000002'),
  1, 'content 非数组结构时生成列不报错（返回空文本）'
);

-- ========== 5. 跨用户 RLS：B 搜不到 A 的正文 ==========
DO $$
BEGIN
  set role authenticated;
  set request.jwt.claim.sub to '49000002-0000-0000-0000-000000000002';
END $$;
SELECT is(
  (SELECT count(*)::int FROM notes WHERE search_text ILIKE '%换了全新的内容%'),
  0, 'RLS: 跨用户搜不到别人的正文'
);
DO $$ BEGIN reset role; END $$;

SELECT * FROM finish();
ROLLBACK;
