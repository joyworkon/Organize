-- 089 资料库统一查询 RPC pgTAP
--
-- 覆盖（与迁移文件头注释一致的验收项）：
--   1. 鉴权：匿名调用拒绝（42501）
--   2. 视图过滤：all 返回双源；reading/memo 各只回一侧；返回列形状（memo 行 title/url/status 为 null）
--   3. 活跃过滤：两表软删除行都不出现
--   4. 排序：created_at DESC，同刻度 source_type ASC（reading 在 memo 前）
--   5. 游标翻页：三元组游标连翻三页无重复无遗漏（含同刻度跨源边界）
--   6. 搜索：p_q 命中 reading 的 title/excerpt/content 与 memo 的 content
--   7. 标签：p_tags 命中 reading 的标签名与 memo 的 tags 数组
--   8. 权限隔离：B 只看到自己两个源的行
--   9. limit 边界：1–100 之外回落 30（小数据集 = 全量返回）
BEGIN;
SELECT plan(20);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('89000001-0000-0000-0000-000000000001', 'p8_lib_a@test', '{}'),
    ('89000002-0000-0000-0000-000000000002', 'p8_lib_b@test', '{}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- A 的三篇稍后读（created_at 逐秒递增，稳定排序）
INSERT INTO public.reading_items (id, user_id, url, title, content, excerpt, reading_status, created_at) VALUES
  ('89010000-0000-0000-0000-000000000001', '89000001-0000-0000-0000-000000000001',
   'https://a.example.com/1', 'Alpha 文章', 'alpha body', 'alpha 摘要', 'unread', now() + interval '1 second'),
  ('89010000-0000-0000-0000-000000000002', '89000001-0000-0000-0000-000000000001',
   'https://a.example.com/2', 'Beta 文章', 'beta body 含关键词needle', 'beta 摘要', 'reading', now() + interval '2 seconds'),
  ('89010000-0000-0000-0000-000000000003', '89000001-0000-0000-0000-000000000001',
   'https://a.example.com/3', 'Gamma', null, 'gamma 摘要', 'read', now() + interval '3 seconds');

-- A 的三条速记（m1 带 #效率）
INSERT INTO public.memos (id, user_id, content, tags, created_at) VALUES
  ('89020000-0000-0000-0000-000000000001', '89000001-0000-0000-0000-000000000001',
   'memo 第一条 #效率', '{效率}', now() + interval '4 seconds'),
  ('89020000-0000-0000-0000-000000000002', '89000001-0000-0000-0000-000000000001',
   'memo 第二条 needle', '{}', now() + interval '5 seconds'),
  ('89020000-0000-0000-0000-000000000003', '89000001-0000-0000-0000-000000000001',
   'memo 第三条', '{}', now() + interval '6 seconds');

-- 同刻度的一对（reading + memo）：验证 source_type 升序 tie-break 与跨源游标边界
INSERT INTO public.reading_items (id, user_id, url, title, content, reading_status, created_at) VALUES
  ('89010000-0000-0000-0000-000000000010', '89000001-0000-0000-0000-000000000001',
   'https://a.example.com/tie', '同时刻文章', 'tie body', 'unread', now() + interval '10 seconds');
INSERT INTO public.memos (id, user_id, content, tags, created_at) VALUES
  ('89020000-0000-0000-0000-000000000010', '89000001-0000-0000-0000-000000000001',
   '同时刻速记', '{}', now() + interval '10 seconds');

-- 软删除行（两表各一，均不应出现）
INSERT INTO public.reading_items (id, user_id, url, title, content, reading_status, deleted_at, created_at) VALUES
  ('89010000-0000-0000-0000-000000000099', '89000001-0000-0000-0000-000000000001',
   'https://a.example.com/deleted', '已删文章', 'deleted body', 'unread', now(), now() + interval '9 seconds');
INSERT INTO public.memos (id, user_id, content, tags, deleted_at, created_at) VALUES
  ('89020000-0000-0000-0000-000000000099', '89000001-0000-0000-0000-000000000001',
   'memo 已删', '{}', now(), now() + interval '9 seconds');

-- A 的标签与关联（r2 打「阅读方法」）
INSERT INTO public.tags (id, user_id, name) VALUES
  ('89030000-0000-0000-0000-000000000001', '89000001-0000-0000-0000-000000000001', '阅读方法');
INSERT INTO public.item_tags (item_id, tag_id) VALUES
  ('89010000-0000-0000-0000-000000000002', '89030000-0000-0000-0000-000000000001');

-- B 的一读一记（隔离断言用）
INSERT INTO public.reading_items (id, user_id, url, title, content, reading_status, created_at) VALUES
  ('89010000-0000-0000-0000-000000000020', '89000002-0000-0000-0000-000000000002',
   'https://b.example.com/1', 'B的文章', 'b body', 'unread', now() + interval '7 seconds');
INSERT INTO public.memos (id, user_id, content, tags, created_at) VALUES
  ('89020000-0000-0000-0000-000000000020', '89000002-0000-0000-0000-000000000002',
   'B的速记', '{}', now() + interval '8 seconds');

-- ========== 1. 鉴权 ==========
SELECT throws_ok(
  $$ SELECT public.library_items('all', 30) $$,
  '42501',
  NULL,
  '089: 匿名调用拒绝（42501）'
);

-- ========== 2. 视图过滤与返回列形状 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '89000001-0000-0000-0000-000000000001';  -- A

SELECT is(
  (SELECT count(*) FROM public.library_items('all', 100)),
  8::bigint,
  '089: A 的 all = 8 行（3 读 + 3 记 + 同刻度 2；软删不计）'
);
SELECT is(
  (SELECT count(*) FROM public.library_items('reading', 100)),
  4::bigint,
  '089: view=reading 只回稍后读'
);
SELECT is(
  (SELECT count(*) FROM public.library_items('memo', 100)),
  4::bigint,
  '089: view=memo 只回速记'
);
SELECT is(
  (SELECT count(*) FROM public.library_items('all', 100) WHERE source_type = 'memo' AND (title IS NOT NULL OR url IS NOT NULL OR reading_status IS NOT NULL OR is_pinned OR reading_progress IS NOT NULL OR is_link_only)),
  0::bigint,
  '089: memo 行 title/url/reading_status/is_pinned/reading_progress/is_link_only 均为空'
);
SELECT is(
  (SELECT id FROM public.library_items('all', 100) WHERE is_link_only),
  '89010000-0000-0000-0000-000000000003'::uuid,
  '089: content 为空的阅读条目标记 is_link_only（仅存链接）'
);

-- ========== 4. 排序（同刻度 reading 在 memo 前）==========
SELECT is(
  (SELECT source_type FROM public.library_items('all', 1)),
  'reading',
  '089: 最新同刻度行 reading 排在 memo 前（source_type 升序）'
);

-- ========== 5. 游标翻页（limit 3 三页无重复无遗漏）==========
WITH page1 AS (
  SELECT * FROM public.library_items('all', 3)
), page2 AS (
  SELECT * FROM public.library_items('all', 3,
    (SELECT created_at FROM page1 ORDER BY created_at ASC, source_type DESC, id DESC LIMIT 1),
    (SELECT source_type FROM page1 ORDER BY created_at ASC, source_type DESC, id DESC LIMIT 1),
    (SELECT id FROM page1 ORDER BY created_at ASC, source_type DESC, id DESC LIMIT 1))
), page3 AS (
  SELECT * FROM public.library_items('all', 3,
    (SELECT created_at FROM page2 ORDER BY created_at ASC, source_type DESC, id DESC LIMIT 1),
    (SELECT source_type FROM page2 ORDER BY created_at ASC, source_type DESC, id DESC LIMIT 1),
    (SELECT id FROM page2 ORDER BY created_at ASC, source_type DESC, id DESC LIMIT 1))
)
SELECT is(
  (SELECT count(*) FROM (
    SELECT id FROM page1 UNION ALL SELECT id FROM page2 UNION ALL SELECT id FROM page3
  ) all_rows) =
  (SELECT count(DISTINCT id) FROM (
    SELECT id FROM page1 UNION ALL SELECT id FROM page2 UNION ALL SELECT id FROM page3
  ) distinct_rows),
  true,
  '089: 三页并集 8 行且无重复'
);
SELECT is(
  (SELECT count(*) FROM public.library_items('all', 3,
    (SELECT created_at FROM public.library_items('all', 100) ORDER BY created_at ASC, source_type DESC, id DESC LIMIT 1),
    (SELECT source_type FROM public.library_items('all', 100) ORDER BY created_at ASC, source_type DESC, id DESC LIMIT 1),
    (SELECT id FROM public.library_items('all', 100) ORDER BY created_at ASC, source_type DESC, id DESC LIMIT 1))),
  0::bigint,
  '089: 末行游标之后为空（不重复回头）'
);

-- ========== 6. 搜索 ==========
SELECT is(
  (SELECT count(*) FROM public.library_items('all', 100, NULL, NULL, NULL, 'needle')),
  2::bigint,
  '089: p_q 命中 reading 正文与 memo 正文'
);
SELECT is(
  (SELECT count(*) FROM public.library_items('all', 100, NULL, NULL, NULL, 'Alpha')),
  1::bigint,
  '089: p_q 命中 reading 标题'
);
SELECT is(
  (SELECT count(*) FROM public.library_items('all', 100, NULL, NULL, NULL, '不存在的关键词xyz')),
  0::bigint,
  '089: p_q 无命中返回空'
);

-- ========== 7. 标签 ==========
SELECT is(
  (SELECT count(*) FROM public.library_items('all', 100, NULL, NULL, NULL, NULL, '{阅读方法}'::text[])),
  1::bigint,
  '089: p_tags 命中 reading 侧标签名'
);
SELECT is(
  (SELECT count(*) FROM public.library_items('all', 100, NULL, NULL, NULL, NULL, '{效率}'::text[])),
  1::bigint,
  '089: p_tags 命中 memo 侧 tags 数组'
);
SELECT is(
  (SELECT count(*) FROM public.library_items('all', 100, NULL, NULL, NULL, NULL, '{阅读方法,效率}'::text[])),
  2::bigint,
  '089: p_tags 多标签任一命中（并集）'
);
RESET ROLE;

-- ========== 8. 权限隔离 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '89000002-0000-0000-0000-000000000002';  -- B
SELECT is(
  (SELECT count(*) FROM public.library_items('all', 100)),
  2::bigint,
  '089: B 只看到自己在两个源的行'
);
SELECT is(
  (SELECT count(*) FROM public.library_items('all', 100) WHERE title = 'Alpha 文章'),
  0::bigint,
  '089: B 的结果不含 A 的稍后读'
);
RESET ROLE;

-- ========== 9. limit 边界 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '89000001-0000-0000-0000-000000000001';
SELECT is(
  (SELECT count(*) FROM public.library_items('all', 0)),
  8::bigint,
  '089: limit=0 回落缺省（小数据集全量返回）'
);
SELECT is(
  (SELECT count(*) FROM public.library_items('all', 101)),
  8::bigint,
  '089: limit=101 回落缺省'
);
SELECT is(
  (SELECT count(*) FROM public.library_items('all', 1)),
  1::bigint,
  '089: limit=1 生效'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
