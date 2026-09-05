-- 074 反向链接分页 RPC pgTAP
--
-- 覆盖（与迁移文件头注释一致的验收项）：
--   1. 鉴权：匿名调用拒绝（42501）
--   2. 完整性：151 篇笔记中散布 3 个来源链接（含排序靠后的旧笔记），分页（page size 100）
--      两页取全；total 与 rows 一致；不下发 content 字段
--   3. 权限：跨账号隔离——B 的笔记提到 A 的笔记 id，A 查询不到 B 的行；B 查询只回 B 自己的行
--   4. 软删除：来源被软删后不再返回
--   5. 无关笔记：内容不含该 uuid 的不返回
BEGIN;
SELECT plan(9);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('74000001-0000-0000-0000-000000000001', 'p7_bk_a@test', '{}'),
    ('74000002-0000-0000-0000-000000000002', 'p7_bk_b@test', '{}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- 目标笔记（A 的）：被 151 篇引用其中的 3 篇
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('74030000-0000-0000-0000-000000000001', '74000001-0000-0000-0000-000000000001',
   '目标笔记', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb);

-- 150 篇 A 的普通笔记（无链接），其中 #10/#100/#150 三篇含指向目标笔记的内链
INSERT INTO public.notes (id, user_id, title, content)
SELECT
  ('74040000-0000-0000-0000-' || lpad(g.i::text, 12, '0'))::uuid,
  '74000001-0000-0000-0000-000000000001',
  '来源 ' || g.i,
  CASE WHEN g.i IN (10, 100, 150)
    THEN jsonb_build_object('type', 'doc', 'content',
      jsonb_build_array(jsonb_build_object(
        'type', 'paragraph',
        'content', jsonb_build_array(jsonb_build_object(
          'type', 'text',
          'marks', jsonb_build_array(jsonb_build_object(
            'type', 'link',
            'attrs', jsonb_build_object('href', '/notes/74030000-0000-0000-0000-000000000001'))),
          'text', '链接')))))
    ELSE '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb
  END
FROM generate_series(1, 150) AS g(i);

-- updated_at 逐条唯一：保证 order by 稳定，翻页断言确定（生产行间时间本就不同）
UPDATE public.notes SET updated_at = now() + g.i * (interval '1 second')
FROM generate_series(1, 150) AS g(i)
WHERE public.notes.id = ('74040000-0000-0000-0000-' || lpad(g.i::text, 12, '0'))::uuid;

-- B 的笔记也提到 A 的目标笔记 uuid（跨账号隔离用）
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('74040000-0000-0000-0000-000000000201', '74000002-0000-0000-0000-000000000002',
   'B的笔记', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","marks":[{"type":"link","attrs":{"href":"/notes/74030000-0000-0000-0000-000000000001"}}],"text":"链接"}]}]}'::jsonb);

-- ========== 1. 鉴权 ==========
SELECT throws_ok(
  $$ SELECT public.get_note_backlinks('74030000-0000-0000-0000-000000000001', 100, 0) $$,
  '42501',
  NULL,
  '074: 匿名调用拒绝（42501）'
);

-- ========== 2. 完整性 + 分页 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '74000001-0000-0000-0000-000000000001';  -- A
SELECT is(
  public.get_note_backlinks('74030000-0000-0000-0000-000000000001', 100, 0)->>'total',
  '3',
  '074: 150 篇中 3 个真实来源全量计数（无 100 上限截断）'
);
SELECT is(
  jsonb_array_length(public.get_note_backlinks('74030000-0000-0000-0000-000000000001', 100, 0)->'rows'),
  3,
  '074: 第一页返回全部命中（3 ≤ page size）'
);
RESET ROLE;

-- 补一个软删除来源：先插入再软删，total 应从 3 → 排除后不变（该行本来就不该计入）
INSERT INTO public.notes (id, user_id, title, content, deleted_at) VALUES
  ('74040000-0000-0000-0000-000000000301', '74000001-0000-0000-0000-000000000001',
   '已删除来源', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","marks":[{"type":"link","attrs":{"href":"/notes/74030000-0000-0000-0000-000000000001"}}],"text":"链接"}]}]}'::jsonb,
   now());

-- ========== 3. 权限（跨账号隔离）==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '74000002-0000-0000-0000-000000000002';  -- B
SELECT is(
  public.get_note_backlinks('74030000-0000-0000-0000-000000000001', 100, 0)->>'total',
  '1',
  '074: B 查询只回 B 自己提到该笔记的行（隔离）'
);
RESET ROLE;

-- A 的 total 仍为 3（B 的行不出现）
SET ROLE authenticated;
SET request.jwt.claim.sub TO '74000001-0000-0000-0000-000000000001';  -- A
SELECT is(
  public.get_note_backlinks('74030000-0000-0000-0000-000000000001', 100, 0)->>'total',
  '3',
  '074: A 的结果不含 B 的行'
);

-- 软删除来源不计入
SELECT is(
  (SELECT NOT (public.get_note_backlinks('74030000-0000-0000-0000-000000000001', 100, 0)::text LIKE '%已删除来源%')),
  true,
  '074: 软删除来源不返回'
);

-- 不下发 content（只回 id/title/created_at）
SELECT is(
  (SELECT NOT (public.get_note_backlinks('74030000-0000-0000-0000-000000000001', 100, 0)::text LIKE '%"content"%')),
  true,
  '074: 返回行不含正文（只回元数据）'
);
RESET ROLE;

-- ========== 4. 分页翻页（page size 2，页 0/页 1 无重复且并集=3）==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '74000001-0000-0000-0000-000000000001';
SELECT is(
  jsonb_array_length(public.get_note_backlinks('74030000-0000-0000-0000-000000000001', 2, 0)->'rows'),
  2,
  '074: 翻页 page0 按页大小返回 2 条'
);
SELECT is(
  jsonb_array_length(public.get_note_backlinks('74030000-0000-0000-0000-000000000001', 2, 1)->'rows'),
  1,
  '074: 翻页 page1 返回剩余 1 条'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
