-- 078 精确关系索引（B03/R10b）pgTAP
--
-- 覆盖（与 docs/note-relations-index-design.md 验收对照表一致的验收项）：
--   1. 权限：note_links 表对 authenticated/anon 无直查权；提取核心函数不可执行；匿名调 v2 拒绝
--   2. 提取合同：link mark 才成边；纯文本/代码块/外站同路径/非法形状不成边；
--      锚点/查询串变体折叠；百分号编码段解码命中；/library/ reading 边
--   3. 触发器 diff：删边/补边/幂等（重复保存不重置 created_at）；content null 清空
--   4. v2 读：keyset 游标分页取全（250 来源无重无漏）、并列 updated_at tie-break、
--      翻页中插入新来源不漂移；排序 (updated_at, id) desc
--   5. 可见性：授权共享来源进反链、撤权即时消失（标题/计数同步）；目标无权 42501；
--      软删来源排除；自链排除；移交归属后可见性切换
--   6. 删除语义：硬删来源 cascade 清边；硬删目标边保留（missing 态可复联）
--   7. v1（074）回归：仍可用
BEGIN;
SELECT plan(34);

-- ========== 数据准备（postgres 直插，绕过 RLS；触发器正常触发）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('78a00001-0000-0000-0000-000000000001', 'p78_a@test', '{}'),
    ('78a00002-0000-0000-0000-000000000002', 'p78_b@test', '{}'),
    ('78a00003-0000-0000-0000-000000000003', 'p78_c@test', '{}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- A 的目标笔记 T（反链查询对象）与 T2/T3/T4（分页/可见性/硬删目标）
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('78b00000-0000-0000-0000-000000000001', '78a00001-0000-0000-0000-000000000001', '目标T',  '{"type":"doc","content":[]}'::jsonb),
  ('78b00000-0000-0000-0000-000000000004', '78a00001-0000-0000-0000-000000000001', '目标T2', '{"type":"doc","content":[]}'::jsonb),
  ('78b00000-0000-0000-0000-000000000006', '78a00001-0000-0000-0000-000000000001', '目标T3', '{"type":"doc","content":[]}'::jsonb),
  ('78b00000-0000-0000-0000-000000000007', '78a00001-0000-0000-0000-000000000001', '目标T4', '{"type":"doc","content":[]}'::jsonb);

-- ========== 1. 权限负例 ==========
-- throws_ok 三参形式：第三参是期望错误消息（实测参与比较，errcode=NULL 时通配）
SET ROLE authenticated;
SELECT throws_ok(
  'SELECT * FROM public.note_links',
  '42501',
  'permission denied for table note_links'
);
SELECT throws_ok(
  'INSERT INTO public.note_links (source_note_id, target_type, target_id, href) VALUES (gen_random_uuid(), ''note'', gen_random_uuid(), ''/notes/78b00000-0000-0000-0000-000000000001'')',
  '42501',
  'permission denied for table note_links'
);
SELECT throws_ok(
  'SELECT public.note_links_extract(''{}''::jsonb)',
  '42501',
  'permission denied for function note_links_extract'
);
SELECT throws_ok(
  'SELECT public.note_links_pct_decode_ascii(''x'')',
  '42501',
  'permission denied for function note_links_pct_decode_ascii'
);
RESET ROLE;

SET ROLE anon;
SELECT throws_ok(
  'SELECT public.get_note_backlinks_v2(''78b00000-0000-0000-0000-000000000001'')',
  '42501',
  'permission denied for function get_note_backlinks_v2'
);
RESET ROLE;

-- ========== 2. 提取合同：变体源 V 一次插入，多形态并存 ==========
-- V 内容同时含：
--   a) plain mark /notes/T           b) mark /notes/T#anchor    c) mark /notes/T?q=1
--   d) mark /notes/T2 的百分号编码段（%31 = '1'）   e) mark /library/R（R 不存在，合法 missing）
--   f) 纯文本提到 /notes/T           g) code_block 文本含 /notes/T
--   h) mark 外站 https://x.test/notes/T            i) mark /notes/形状非法段
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('78b00000-0000-0000-0000-000000000003', '78a00001-0000-0000-0000-000000000001', '变体源V',
  (  '{"type":"doc","content":['
    || '{"type":"paragraph","content":['
      || '{"type":"text","text":"a","marks":[{"type":"link","attrs":{"href":"/notes/78b00000-0000-0000-0000-000000000001"}}]},'
      || '{"type":"text","text":"b","marks":[{"type":"link","attrs":{"href":"/notes/78b00000-0000-0000-0000-000000000001#anchor"}}]},'
      || '{"type":"text","text":"c","marks":[{"type":"link","attrs":{"href":"/notes/78b00000-0000-0000-0000-000000000001?q=1"}}]},'
      || '{"type":"text","text":"d","marks":[{"type":"link","attrs":{"href":"/notes/%378b00000-0000-0000-0000-000000000004"}}]},'
      || '{"type":"text","text":"e","marks":[{"type":"link","attrs":{"href":"/library/78c00000-0000-0000-0000-000000000009#x"}}]},'
      || '{"type":"text","text":"f 纯文本 /notes/78b00000-0000-0000-0000-000000000001 不算"}'
    || ']},'
    || '{"type":"code_block","content":[{"type":"text","text":"g /notes/78b00000-0000-0000-0000-000000000001"}]},'
    || '{"type":"paragraph","content":['
      || '{"type":"text","text":"h","marks":[{"type":"link","attrs":{"href":"https://x.test/notes/78b00000-0000-0000-0000-000000000001"}}]},'
      || '{"type":"text","text":"i","marks":[{"type":"link","attrs":{"href":"/notes/not-a-uuid"}}]}'
    || ']}' || ']}')::jsonb);

SELECT is(
  (SELECT count(*) FROM public.note_links WHERE source_note_id = '78b00000-0000-0000-0000-000000000003')::text,
  '3',
  '078: V 恰好 3 条边（note:T 变体折叠 + note:T2 编码解码 + reading:R）；纯文本/代码块/外站/非法段不成边'
);
SELECT is(
  (SELECT bool_and(t.ok) FROM (
    SELECT EXISTS (SELECT 1 FROM public.note_links WHERE source_note_id = '78b00000-0000-0000-0000-000000000003' AND target_type = 'note' AND target_id = '78b00000-0000-0000-0000-000000000001') AS ok
    UNION ALL
    SELECT EXISTS (SELECT 1 FROM public.note_links WHERE source_note_id = '78b00000-0000-0000-0000-000000000003' AND target_type = 'note' AND target_id = '78b00000-0000-0000-0000-000000000004')
    UNION ALL
    SELECT EXISTS (SELECT 1 FROM public.note_links WHERE source_note_id = '78b00000-0000-0000-0000-000000000003' AND target_type = 'reading' AND target_id = '78c00000-0000-0000-0000-000000000009')
  ) t),
  true,
  '078: 三条边的类型/目标逐一正确（含合法 missing 的 reading 边）'
);

-- ========== 3. 触发器 diff 与幂等 ==========
-- 3.1 先链 T，再清空 → 0 边；再只链 T2 → T 边消失、T2 边新增
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('78b00000-0000-0000-0000-000000000005', '78a00001-0000-0000-0000-000000000001', 'diff源D',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"/notes/78b00000-0000-0000-0000-000000000001"}}]}]}]}'::jsonb);
SELECT is(
  (SELECT count(*) FROM public.note_links WHERE source_note_id = '78b00000-0000-0000-0000-000000000005')::text,
  '1', '078: D 插入即建边'
);
UPDATE public.notes SET content = '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb
WHERE id = '78b00000-0000-0000-0000-000000000005';
SELECT is(
  (SELECT count(*) FROM public.note_links WHERE source_note_id = '78b00000-0000-0000-0000-000000000005')::text,
  '0', '078: 链接移除后边被 diff 删除'
);
UPDATE public.notes
SET content = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"/notes/78b00000-0000-0000-0000-000000000004"}}]}]}]}'::jsonb
WHERE id = '78b00000-0000-0000-0000-000000000005';
SELECT is(
  (SELECT array_agg(target_id::text ORDER BY target_id) FROM public.note_links WHERE source_note_id = '78b00000-0000-0000-0000-000000000005'),
  ARRAY['78b00000-0000-0000-0000-000000000004'],
  '078: 换目标后旧边消失新边出现'
);
-- 3.2 幂等：原样重写 content，created_at（首见时间）不重置
UPDATE public.notes SET content = content WHERE id = '78b00000-0000-0000-0000-000000000005';
SELECT is(
  (SELECT count(DISTINCT created_at) FROM public.note_links WHERE source_note_id = '78b00000-0000-0000-0000-000000000005')::text,
  '1', '078: 重复保存同内容幂等，首见时间稳定'
);
-- 3.3 content null → 清空
UPDATE public.notes SET content = NULL WHERE id = '78b00000-0000-0000-0000-000000000005';
SELECT is(
  (SELECT count(*) FROM public.note_links WHERE source_note_id = '78b00000-0000-0000-0000-000000000005')::text,
  '0', '078: content 置空清空该来源全部边'
);

-- ========== 4. v2 分页：250 来源 + 并列时间 + 稳定性 ==========
-- 250 篇来源链 T2：updated_at = 2020-01-01 + i 分钟（i=1..250，升序唯一）
-- 其中 i=100 与 i=101 并列同一时间戳（tie-break 用 id desc）
INSERT INTO public.notes (id, user_id, title, content, updated_at)
SELECT
  ('78d00000-0000-0000-0000-' || lpad(g.i::text, 12, '0'))::uuid,
  '78a00001-0000-0000-0000-000000000001',
  '来源' || g.i,
  jsonb_build_object('type','doc','content', jsonb_build_array(jsonb_build_object(
    'type','paragraph','content', jsonb_build_array(jsonb_build_object(
      'type','text','text','链','marks', jsonb_build_array(jsonb_build_object(
        'type','link','attrs', jsonb_build_object('href','/notes/78b00000-0000-0000-0000-000000000004')))))))),
  '2020-01-01 00:00:00+00'::timestamptz + make_interval(mins => CASE WHEN g.i IN (100, 101) THEN 100 ELSE g.i END)
FROM generate_series(1, 250) g(i);

SET ROLE authenticated;
SET request.jwt.claim.sub TO '78a00001-0000-0000-0000-000000000001';  -- A

SELECT is(
  (public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000004', 100, NULL)->>'total'),
  '251', '078: T2 的 total = 251（250 来源 + V 编码边；索引读，非 LIKE 全扫）'
);
SELECT is(
  (jsonb_array_length(public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000004', 100, NULL)->'rows'))::text,
  '100', '078: 第一页 100 行'
);
SELECT is(
  ((public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000004', 100, NULL)->'rows'->>0)::jsonb->>'id'),
  '78b00000-0000-0000-0000-000000000003',
  '078: 排序按 updated_at desc，首行为插入时间最新的 V'
);
SELECT is(
  ((public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000004', 100, NULL)->'rows'->>1)::jsonb->>'id'),
  '78d00000-0000-0000-0000-000000000250',
  '078: 第二行为 i=250（250 来源中最新）'
);

-- 游标翻页取全（防御：next_cursor 缺失或 JSON null 均判停——两者语义不同，
-- 服务端合同是取尽时省略键，此处防御性双判避免回归时死循环）
CREATE TEMP TABLE walk_ids (id uuid PRIMARY KEY);
DO $$
DECLARE
  v_cursor jsonb := NULL;
  v_page jsonb;
  v_guard int := 0;
BEGIN
  LOOP
    v_guard := v_guard + 1;
    IF v_guard > 20 THEN
      RAISE EXCEPTION 'pagination guard tripped: cursor never exhausted';
    END IF;
    v_page := public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000004', 100, v_cursor);
    INSERT INTO walk_ids (id)
    SELECT x.id FROM jsonb_to_recordset(v_page->'rows') AS x(id uuid)
    ON CONFLICT DO NOTHING;
    v_cursor := v_page->'next_cursor';
    EXIT WHEN v_cursor IS NULL OR jsonb_typeof(v_cursor) <> 'object';
  END LOOP;
END $$;

SELECT is((SELECT count(*) FROM walk_ids)::text, '251', '078: 游标翻页取全 251 个来源');
SELECT is((SELECT count(DISTINCT id) FROM walk_ids)::text, '251', '078: 翻页无重复');
-- 游标合同：单来源目标取尽后响应省略 next_cursor 键
SELECT is(
  (SELECT EXISTS (SELECT 1 FROM jsonb_each(public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000001', 100, NULL)) WHERE key = 'next_cursor')),
  false,
  '078: 取尽时响应省略 next_cursor 键（缺失 = 判停合同）'
);

-- 并列时间 tie-break：i=100/101 同 updated_at，id desc → 101 在 100 前
-- 全序（V 计入后）：k=0→V, k=1→i250 … k=149→i102, k=150→i101, k=151→i100（页 2 本地第 50/51 行）
CREATE TEMP TABLE p2_ids (id uuid, idx int);
DO $$
DECLARE
  v_page jsonb;
  v_cursor jsonb;
  r record;
  k int := 0;
BEGIN
  v_cursor := (public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000004', 100, NULL) -> 'next_cursor');
  v_page := public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000004', 100, v_cursor);
  FOR r IN SELECT x.id FROM jsonb_to_recordset(v_page->'rows') AS x(id uuid) LOOP
    INSERT INTO p2_ids VALUES (r.id, k);
    k := k + 1;
  END LOOP;
END $$;
SELECT is(
  (SELECT id::text FROM p2_ids WHERE idx = 50),
  '78d00000-0000-0000-0000-000000000101',
  '078: 并列 updated_at 按 id desc tie-break（页 2 第 50 行为 i=101）'
);
SELECT is(
  (SELECT id::text FROM p2_ids WHERE idx = 51),
  '78d00000-0000-0000-0000-000000000100',
  '078: tie 对另一成员 i=100 紧随其后'
);

-- keyset 稳定性：记录第 1 页返回的游标与第 2 页内容，插入新最新来源后用同一游标再取，内容不漂移
CREATE TEMP TABLE p2_before (id uuid);
CREATE TEMP TABLE keep_cursor (c jsonb);
DO $$
DECLARE
  v_page jsonb;
  v_cursor jsonb;
BEGIN
  v_page := public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000004', 100, NULL);
  v_cursor := v_page->'next_cursor';
  INSERT INTO keep_cursor (c) VALUES (v_cursor);
  v_page := public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000004', 100, v_cursor);
  INSERT INTO p2_before SELECT x.id FROM jsonb_to_recordset(v_page->'rows') AS x(id uuid);
END $$;
RESET ROLE;

INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('78d00000-0000-0000-0000-000000000251', '78a00001-0000-0000-0000-000000000001', '翻页中途新来源',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"链","marks":[{"type":"link","attrs":{"href":"/notes/78b00000-0000-0000-0000-000000000004"}}]}]}]}'::jsonb);

SET ROLE authenticated;
SET request.jwt.claim.sub TO '78a00001-0000-0000-0000-000000000001';
SELECT is(
  (SELECT count(*) FROM (
    SELECT x.id FROM jsonb_to_recordset(
      public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000004', 100, (SELECT c FROM keep_cursor))->'rows'
    ) AS x(id uuid)
    EXCEPT
    SELECT id FROM p2_before
  ) d)::text,
  '0',
  '078: 翻页中插入新来源，已翻页结果不漂移（keyset）'
);
SELECT is(
  (public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000004', 100, NULL)->>'total'),
  '252', '078: 新来源即时计入 total'
);
RESET ROLE;

-- ========== 5. 可见性：共享来源 / 撤权 / 门槛 / 软删 / 自链 ==========
-- 5.1 B 的来源链 A 的 T3：A 默认看不见
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('78b00000-0000-0000-0000-000000000008', '78a00002-0000-0000-0000-000000000002', 'B的来源',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"链","marks":[{"type":"link","attrs":{"href":"/notes/78b00000-0000-0000-0000-000000000006"}}]}]}]}'::jsonb);
-- C 的来源链 T3（C 对 T3 无权 → 目标门槛 42501）
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('78b00000-0000-0000-0000-000000000009', '78a00003-0000-0000-0000-000000000003', 'C的来源',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"链","marks":[{"type":"link","attrs":{"href":"/notes/78b00000-0000-0000-0000-000000000006"}}]}]}]}'::jsonb);
-- A 自己的来源链 T3（含自链源）
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('78b00000-0000-0000-0000-00000000000a', '78a00001-0000-0000-0000-000000000001', 'A的自链源',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"自链","marks":[{"type":"link","attrs":{"href":"/notes/78b00000-0000-0000-0000-00000000000a"}}]},{"type":"text","text":"链T3","marks":[{"type":"link","attrs":{"href":"/notes/78b00000-0000-0000-0000-000000000006"}}]}]}]}'::jsonb);

SET ROLE authenticated;
SET request.jwt.claim.sub TO '78a00001-0000-0000-0000-000000000001';
SELECT is(
  (public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000006', 100, NULL)->>'total'),
  '1', '078: A 查 T3 只见自己的来源（B/C 的默认不可见；自链源排除）'
);
RESET ROLE;

-- 5.2 B 把自己的来源笔记共享给 A（workspace + acl viewer）→ A 可见，标题/计数出现
INSERT INTO public.workspaces (id, name, kind, owner_id)
VALUES ('78e00000-0000-0000-0000-000000000001', 'B空间', 'team', '78a00002-0000-0000-0000-000000000002');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('78e00000-0000-0000-0000-000000000001', '78a00001-0000-0000-0000-000000000001', 'member');
INSERT INTO public.resource_acl (workspace_id, resource_type, resource_id, access_role, created_by) VALUES
  ('78e00000-0000-0000-0000-000000000001', 'note', '78b00000-0000-0000-0000-000000000008', 'viewer', '78a00002-0000-0000-0000-000000000002');

SET ROLE authenticated;
SET request.jwt.claim.sub TO '78a00001-0000-0000-0000-000000000001';
SELECT is(
  (public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000006', 100, NULL)->>'total'),
  '2', '078: 授权共享来源计入（own + 共享 viewer）'
);
SELECT is(
  ((SELECT rows FROM (SELECT public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000006', 100, NULL) AS rows) s)::text LIKE '%B的来源%'),
  true, '078: 共享来源标题可见（对 A 本就可读，无新泄露）'
);
RESET ROLE;

-- 5.3 撤权（删成员行）→ 查询时 resource_role 现算，即时消失
DELETE FROM public.workspace_members WHERE workspace_id = '78e00000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SET request.jwt.claim.sub TO '78a00001-0000-0000-0000-000000000001';
SELECT is(
  (public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000006', 100, NULL)->>'total'),
  '1', '078: 撤权后共享来源即时从 total/rows 消失（不泄露）'
);
RESET ROLE;

-- 5.4 目标门槛：C 对 T3 无权 → 42501
SET ROLE authenticated;
SET request.jwt.claim.sub TO '78a00003-0000-0000-0000-000000000003';
SELECT throws_ok(
  'SELECT public.get_note_backlinks_v2(''78b00000-0000-0000-0000-000000000006'')',
  '42501',
  'Note not found or access denied'
);
RESET ROLE;

-- 5.5 软删来源排除：A 软删自己的 T3 来源
UPDATE public.notes SET deleted_at = now() WHERE id = '78b00000-0000-0000-0000-00000000000a';
SET ROLE authenticated;
SET request.jwt.claim.sub TO '78a00001-0000-0000-0000-000000000001';
SELECT is(
  (public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000006', 100, NULL)->>'total'),
  '0', '078: 软删来源不计入'
);
RESET ROLE;

-- ========== 6. 移交 / 硬删 / v1 回归 ==========
-- 6.1 移交：A 的来源链 T3 的另一篇转给 B —— 边不变，A 的可见性随之收敛
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('78b00000-0000-0000-0000-00000000000b', '78a00001-0000-0000-0000-000000000001', '待移交源',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"链","marks":[{"type":"link","attrs":{"href":"/notes/78b00000-0000-0000-0000-000000000006"}}]}]}]}'::jsonb);
SET ROLE authenticated;
SET request.jwt.claim.sub TO '78a00001-0000-0000-0000-000000000001';
RESET ROLE;
-- 068 合同：接收方须先持有 editor+ 访问权（063 判定链 = acl 行 + B 是该空间成员）
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('78e00000-0000-0000-0000-000000000001', '78a00002-0000-0000-0000-000000000002', 'owner');
INSERT INTO public.resource_acl (workspace_id, resource_type, resource_id, access_role, created_by) VALUES
  ('78e00000-0000-0000-0000-000000000001', 'note', '78b00000-0000-0000-0000-00000000000b', 'editor', '78a00002-0000-0000-0000-000000000002');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '78a00001-0000-0000-0000-000000000001';
SELECT public.transfer_note_ownership('78b00000-0000-0000-0000-00000000000b', '78a00002-0000-0000-0000-000000000002');
RESET ROLE;
SELECT is(
  (SELECT count(*) FROM public.note_links WHERE source_note_id = '78b00000-0000-0000-0000-00000000000b')::text,
  '1', '078: 移交不改内容派生边'
);
SET ROLE authenticated;
SET request.jwt.claim.sub TO '78a00001-0000-0000-0000-000000000001';
SELECT is(
  (public.get_note_backlinks_v2('78b00000-0000-0000-0000-000000000006', 100, NULL)->>'total'),
  '0', '078: 移交后原主不再看见该来源'
);
RESET ROLE;

-- 6.2 硬删来源 → cascade 清边；硬删目标 → 边保留（missing 态）
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('78b00000-0000-0000-0000-00000000000c', '78a00001-0000-0000-0000-000000000001', '硬删源',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"链","marks":[{"type":"link","attrs":{"href":"/notes/78b00000-0000-0000-0000-000000000006"}}]}]}]}'::jsonb),
  ('78b00000-0000-0000-0000-00000000000d', '78a00001-0000-0000-0000-000000000001', '指向T4的源',
   '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"链","marks":[{"type":"link","attrs":{"href":"/notes/78b00000-0000-0000-0000-000000000007"}}]}]}]}'::jsonb);
DELETE FROM public.notes WHERE id = '78b00000-0000-0000-0000-00000000000c';
SELECT is(
  (SELECT count(*) FROM public.note_links WHERE source_note_id = '78b00000-0000-0000-0000-00000000000c')::text,
  '0', '078: 硬删来源边级联清除'
);
DELETE FROM public.notes WHERE id = '78b00000-0000-0000-0000-000000000007';
SELECT is(
  (SELECT count(*) FROM public.note_links WHERE target_id = '78b00000-0000-0000-0000-000000000007')::text,
  '1', '078: 硬删目标边保留（missing 态，恢复后自动复联）'
);

-- 6.3 v1 回归：074 RPC 仍可用（回退读路径健在）
SET ROLE authenticated;
SET request.jwt.claim.sub TO '78a00001-0000-0000-0000-000000000001';
SELECT is(
  (SELECT (public.get_note_backlinks('78b00000-0000-0000-0000-000000000001', 100, 0)->>'total')::int >= 1),
  true, '078: v1 get_note_backlinks 保留可用（变体源 V 的 plain 变体 LIKE 可见）'
);
RESET ROLE;

SELECT finish();
ROLLBACK;
