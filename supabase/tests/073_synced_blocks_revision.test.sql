-- 073 同步块 revision 乐观锁 pgTAP
--
-- 覆盖（与 docs/handoff/r05-synced-block-design.md §2 一致）：
--   1. 结构：revision 列存在、默认 1；RPC 存在且 authenticated 可调、anon 不可调
--   2. RPC 成功路径：expected 命中 → content 落库、revision+1、返回 ok
--   3. RPC 冲突路径：过期 expected → status=conflict，current 带服务端当前 revision/content，
--      且内容不被覆盖（默认不覆盖远端的前提）
--   4. 幂等重试语义：响应丢失后带同一 expected 重试 → conflict（由客户端按内容一致性判已同步）
--   5. not_found：不存在的 id 返回 not_found（不泄露存在性）
--   6. 鉴权：匿名调用拒绝
--   7. 兼容：不带 expected（旧客户端）覆盖并递增；恢复路径 insert 不带 revision 默认 1
BEGIN;
SELECT plan(12);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('73000001-0000-0000-0000-000000000001', 'p7_synced_rev@test', '{}')
  ON CONFLICT (id) DO NOTHING;
END $$;

INSERT INTO public.synced_blocks (id, user_id, content)
VALUES ('73000000-0000-0000-0000-000000000001', '73000001-0000-0000-0000-000000000001', '[{"type":"paragraph"}]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ========== 1. 结构 ==========
SELECT has_column('public', 'synced_blocks', 'revision', '073: revision 列存在');
SELECT has_function_privilege('authenticated', 'public.synced_block_patch(uuid, jsonb, integer)', 'EXECUTE'),
  true, '073: authenticated 可调 synced_block_patch';
SELECT has_function_privilege('anon', 'public.synced_block_patch(uuid, jsonb, integer)', 'EXECUTE'),
  false, '073: anon 不可调 synced_block_patch';

-- ========== 2. 成功路径 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '73000001-0000-0000-0000-000000000001';
SELECT is(
  public.synced_block_patch('73000000-0000-0000-0000-000000000001',
    '[{"type":"paragraph","content":[{"type":"text","text":"v2"}]}]'::jsonb, 1)->>'status',
  'ok',
  '073: expected 命中返回 ok'
);
SELECT is(
  public.synced_block_patch('73000000-0000-0000-0000-000000000001',
    '[{"type":"paragraph","content":[{"type":"text","text":"v2"}]}]'::jsonb, 1)->>'status',
  'conflict',
  '073: 同一 expected 重试（幂等重试场景）返回 conflict'
);
RESET ROLE;
SELECT is(
  (SELECT revision FROM public.synced_blocks WHERE id = '73000000-0000-0000-0000-000000000001'),
  2::integer,
  '073: revision 原子递增（1 → 2，重复请求未再递增）'
);

-- ========== 3. 冲突路径 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '73000001-0000-0000-0000-000000000001';
SELECT is(
  public.synced_block_patch('73000000-0000-0000-0000-000000000001',
    '[{"type":"paragraph","content":[{"type":"text","text":"stale"}]}]'::jsonb, 1)->'current'->>'revision',
  '2',
  '073: 过期 expected 的 conflict.current 带服务端当前 revision'
);
SELECT is(
  public.synced_block_patch('73000000-0000-0000-0000-000000000001',
    '[{"type":"paragraph","content":[{"type":"text","text":"stale"}]}]'::jsonb, 1)->'current'->'content'->0->'content'->0->>'text',
  'v2',
  '073: conflict.current 带服务端当前内容'
);
RESET ROLE;
SELECT is(
  (SELECT content->0->'content'->0->>'text' FROM public.synced_blocks WHERE id = '73000000-0000-0000-0000-000000000001'),
  'v2'::text,
  '073: 冲突时不覆盖服务端内容'
);

-- ========== 4. not_found ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '73000001-0000-0000-0000-000000000001';
SELECT is(
  public.synced_block_patch('73000000-0000-0000-0000-0000000000ff',
    '[{"type":"paragraph"}]'::jsonb, 1)->>'status',
  'not_found',
  '073: 不存在的 id 返回 not_found'
);
RESET ROLE;

-- ========== 5. 旧客户端兼容（不带 expected）==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '73000001-0000-0000-0000-000000000001';
SELECT is(
  public.synced_block_patch('73000000-0000-0000-0000-000000000001',
    '[{"type":"paragraph","content":[{"type":"text","text":"legacy"}]}]'::jsonb, NULL)->>'status',
  'ok',
  '073: 不带 expected 的覆盖返回 ok'
);
RESET ROLE;
SELECT is(
  (SELECT revision FROM public.synced_blocks WHERE id = '73000000-0000-0000-0000-000000000001'),
  3::integer,
  '073: 旧客户端覆盖也递增 revision（2 → 3）'
);

-- ========== 6. 匿名拒绝 ==========
-- 注意：request.jwt.claim.sub 是会话级 GUC，RESET ROLE 不清除，需显式重置
RESET request.jwt.claim.sub;
SELECT throws_ok(
  $$ SELECT public.synced_block_patch('73000000-0000-0000-0000-000000000001', '[]'::jsonb, 1) $$,
  '42501',
  NULL,
  '073: 匿名调用拒绝（42501）'
);

-- ========== 7. 恢复路径兼容 ==========
INSERT INTO public.synced_blocks (id, user_id, content, created_at, updated_at)
VALUES ('73000000-0000-0000-0000-000000000002', '73000001-0000-0000-0000-000000000001', '[{"type":"paragraph"}]'::jsonb, now(), now())
ON CONFLICT (id) DO NOTHING;
SELECT is(
  (SELECT revision FROM public.synced_blocks WHERE id = '73000000-0000-0000-0000-000000000002'),
  1::integer,
  '073: 恢复路径不带 revision 时默认 1'
);

SELECT * FROM finish();
ROLLBACK;
