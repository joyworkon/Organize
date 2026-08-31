-- 064 协作可见性接入 + 用户档案 pgTAP（Stage 0 第二张卡）
--
-- 覆盖（对应 064 文件头逐项承诺，节号与下文 ========== 分节一致）：
--   1. 授权前协作者路径一条都不放行
--   2. 经 063 的 grant_resource 授权后，三张主表各自对协作者可见
--   3. 三档负例：无授权的同空间成员 / 完全无关的人 / 同空间内未被授权的另一条资源
--   4. 软删除对协作者不可见，恢复后重新可见（证明前一条不恒真）
--   5. 逐资源回收立刻生效，且不牵连同一空间里的其他授权
--   6. **没有**放开写：协作者直改 / 直删 / 冒充属主插入，数据都不动
--   7. 子资源（历史版本、任务↔笔记反链）对协作者为空，但行确实存在
--   8. 策略结构：可见性判定复用 resource_role()，零条写策略，shares 未被改写
--   9. user_profiles 可见集只有「自己 + 同空间成员」，且改不动别人的档案
--  10. 表级与函数级权限收口（has_*_privilege 断言，不依赖错误文案）
--  11. find_user_by_email 只能精确查人：不前缀、不通配、不列举，匿名拒
--  12. 镜像触发器：注册即建档、auth 更新跟得动、但冲不掉用户自设昵称
--
-- 断言风格沿 063 教训：**不依赖表级 GRANT 的错误文案**。CI 的全新库里 authenticated
-- 拿到的是默认全 DML，越权写会变成「0 行受影响」而不是报错，所以第 6 节一律改断
-- 「数据有没有变」，DO 块用 WHEN OTHERS 兜住两种环境。
-- 计数断言一律带 id 限定（本地 dev 库有存量账号，全局 count 不可依赖）。
BEGIN;
SELECT plan(73);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('64000001-0000-0000-0000-000000000001', 'p5_rls_a@test', '{"full_name":"A 全名"}'),
    ('64000002-0000-0000-0000-000000000002', 'p5_rls_b@test', '{"full_name":"B 全名"}'),
    ('64000003-0000-0000-0000-000000000003', 'p5_rls_c@test', '{"name":"C 名"}'),
    ('64000004-0000-0000-0000-000000000004', 'p5_rls_d@test', '{"full_name":"D 全名"}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- W1: A owner + B member（本文件唯一被授权的空间）
-- W2: A owner + C member（一条授权都没有 → 用来打「成员身份不给读权」）
-- D 与 A 无任何共同空间；三人的个人空间由 063 的 auth.users 触发器补建
INSERT INTO public.workspaces (id, name, kind, owner_id) VALUES
  ('64010000-0000-0000-0000-000000000001', 'RLS-W1', 'team', '64000001-0000-0000-0000-000000000001'),
  ('64010000-0000-0000-0000-000000000002', 'RLS-W2', 'team', '64000001-0000-0000-0000-000000000001');

INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('64010000-0000-0000-0000-000000000001', '64000001-0000-0000-0000-000000000001', 'owner'),
  ('64010000-0000-0000-0000-000000000001', '64000002-0000-0000-0000-000000000002', 'member'),
  ('64010000-0000-0000-0000-000000000002', '64000001-0000-0000-0000-000000000001', 'owner'),
  ('64010000-0000-0000-0000-000000000002', '64000003-0000-0000-0000-000000000003', 'member');

INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('64020000-0000-0000-0000-000000000001', '64000001-0000-0000-0000-000000000001',
   'A的笔记', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb),
  ('64020000-0000-0000-0000-000000000002', '64000001-0000-0000-0000-000000000001',
   'A的另一篇笔记', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb),
  ('64020000-0000-0000-0000-000000000003', '64000004-0000-0000-0000-000000000004',
   'D的笔记', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb);

INSERT INTO public.reading_items (id, user_id, url, title) VALUES
  ('64030000-0000-0000-0000-000000000001', '64000001-0000-0000-0000-000000000001',
   'https://example.com/rls-a', 'A的文章');

INSERT INTO public.task_lists (id, user_id, name) VALUES
  ('64040000-0000-0000-0000-000000000001', '64000001-0000-0000-0000-000000000001', 'RLS清单');

INSERT INTO public.tasks (id, user_id, list_id, title) VALUES
  ('64050000-0000-0000-0000-000000000001', '64000001-0000-0000-0000-000000000001',
   '64040000-0000-0000-0000-000000000001', 'A的任务');

-- 子资源：属主有，用来证明第 7 节「协作者 0 行」不是「表本来就是空的」
INSERT INTO public.note_versions (id, note_id, content, title) VALUES
  ('64060000-0000-0000-0000-000000000001', '64020000-0000-0000-0000-000000000001',
   '{"type":"doc"}'::jsonb, 'A的笔记');
INSERT INTO public.task_item_refs (id, user_id, task_id, note_id, block_id) VALUES
  ('64070000-0000-0000-0000-000000000001', '64000001-0000-0000-0000-000000000001',
   '64050000-0000-0000-0000-000000000001', '64020000-0000-0000-0000-000000000001', 'blk-64-1');

-- ========== 1. 授权前：协作者路径一条都不放行 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '64000001-0000-0000-0000-000000000001';  -- A
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000001'),
  1::bigint, '基线：属主 A 自己读得到（旧的 owner-only 策略没被改坏）');
SET request.jwt.claim.sub TO '64000002-0000-0000-0000-000000000002';  -- B
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000001'),
  0::bigint, '未授权时 B（W1 成员）读不到 A 的笔记');
SELECT is((SELECT count(*) FROM public.reading_items WHERE id = '64030000-0000-0000-0000-000000000001'),
  0::bigint, '未授权时 B 读不到 A 的文章');
SELECT is((SELECT count(*) FROM public.tasks WHERE id = '64050000-0000-0000-0000-000000000001'),
  0::bigint, '未授权时 B 读不到 A 的任务');
SET request.jwt.claim.sub TO '64000003-0000-0000-0000-000000000003';  -- C
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000001'),
  0::bigint, '未授权时 C 读不到 A 的笔记');
SET request.jwt.claim.sub TO '64000004-0000-0000-0000-000000000004';  -- D
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000001'),
  0::bigint, '未授权时 D 读不到 A 的笔记');
SET request.jwt.claim.sub TO '64000001-0000-0000-0000-000000000001';  -- A

-- ========== 2. 经 063 的 RPC 授权后，三张主表各自放行 ==========
SELECT lives_ok(
  $$SELECT public.grant_resource('note', '64020000-0000-0000-0000-000000000001',
        '64010000-0000-0000-0000-000000000001', 'editor')$$,
  'A 把笔记授权给 W1（editor）');
SELECT lives_ok(
  $$SELECT public.grant_resource('reading_item', '64030000-0000-0000-0000-000000000001',
        '64010000-0000-0000-0000-000000000001', 'viewer')$$,
  'A 把文章授权给 W1（viewer）');
SELECT lives_ok(
  $$SELECT public.grant_resource('task', '64050000-0000-0000-0000-000000000001',
        '64010000-0000-0000-0000-000000000001', 'editor')$$,
  'A 把任务授权给 W1（editor）');

SET request.jwt.claim.sub TO '64000002-0000-0000-0000-000000000002';  -- B
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000001'),
  1::bigint, 'editor 授权让 B 读到那条笔记');
SELECT is((SELECT count(*) FROM public.reading_items WHERE id = '64030000-0000-0000-0000-000000000001'),
  1::bigint, 'viewer 授权同样给读（viewer 与 editor 的可读集相同，差别在写）');
SELECT is((SELECT count(*) FROM public.tasks WHERE id = '64050000-0000-0000-0000-000000000001'),
  1::bigint, 'editor 授权让 B 读到那条任务');
SELECT is((SELECT public.resource_role('note', '64020000-0000-0000-0000-000000000001')), 'editor',
  'RLS 可见与 resource_role() 判定同一答案（策略没自己另算一份）');
SELECT is((SELECT public.resource_role('reading_item', '64030000-0000-0000-0000-000000000001')), 'viewer',
  '文章的判定同样是 viewer');

-- ========== 3. 三档负例 ==========
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000002'),
  0::bigint, '同空间内 A 的另一篇笔记不随授权外溢（逐资源粒度）');
SET request.jwt.claim.sub TO '64000001-0000-0000-0000-000000000001';  -- A
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000002'),
  1::bigint, '那篇笔记对属主仍可见（上一条不是数据准备错误）');
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000003'),
  0::bigint, '反向不成立：A 看不见 D 的笔记');
SET request.jwt.claim.sub TO '64000003-0000-0000-0000-000000000003';  -- C
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000001'),
  0::bigint, 'C 与 A 同处 W2 但 W2 没有授权 → 成员身份本身不给读权');
SELECT is((SELECT count(*) FROM public.tasks WHERE id = '64050000-0000-0000-0000-000000000001'),
  0::bigint, '同上，任务也不给读');
SET request.jwt.claim.sub TO '64000004-0000-0000-0000-000000000004';  -- D
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000001'),
  0::bigint, 'D 不是任何相关空间的成员 → 读不到');
SELECT is((SELECT public.resource_role('note', '64020000-0000-0000-0000-000000000001')), NULL::text,
  'D 的判定是 NULL，与「读不到」一致（不泄漏存在性）');

-- ========== 4. 软删除对协作者不可见，恢复后重新可见 ==========
RESET ROLE;
UPDATE public.notes SET deleted_at = now() WHERE id = '64020000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SET request.jwt.claim.sub TO '64000002-0000-0000-0000-000000000002';  -- B
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000001'),
  0::bigint, '属主把笔记放进垃圾箱后，协作者也读不到（协作策略带 deleted_at is null）');
SET request.jwt.claim.sub TO '64000001-0000-0000-0000-000000000001';  -- A
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000001'),
  0::bigint, '对属主的默认列表同样消失（垃圾箱语义未被协作策略绕过）');
RESET ROLE;
UPDATE public.notes SET deleted_at = NULL WHERE id = '64020000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SET request.jwt.claim.sub TO '64000002-0000-0000-0000-000000000002';  -- B
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000001'),
  1::bigint, '移出垃圾箱后重新可见 → 证明上一条不是恒真');

-- ========== 5. 逐资源回收立刻生效 ==========
SET request.jwt.claim.sub TO '64000001-0000-0000-0000-000000000001';  -- A
SELECT lives_ok(
  $$SELECT public.revoke_resource('reading_item', '64030000-0000-0000-0000-000000000001',
        '64010000-0000-0000-0000-000000000001')$$,
  'A 回收文章的授权');
SET request.jwt.claim.sub TO '64000002-0000-0000-0000-000000000002';  -- B
SELECT is((SELECT count(*) FROM public.reading_items WHERE id = '64030000-0000-0000-0000-000000000001'),
  0::bigint, '回收后协作者立刻读不到那篇文章');
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000001'),
  1::bigint, '回收一条不牵连同一空间里的另一条授权');

-- ========== 6. 没有放开写：三条业务表的数据都不动 ==========
-- 注意断言方式：CI 的全新库里 authenticated 有表级 UPDATE/DELETE，越权写静默 0 行；
-- 本地库可能报 insufficient_privilege。两种结果都算「拦住」，所以只断数据效果。
DO $$ BEGIN
  UPDATE public.notes SET title = '越权改写', content = '{"type":"doc"}'::jsonb
   WHERE id = '64020000-0000-0000-0000-000000000001';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'notes 直改被拒: %', SQLERRM; END $$;
DO $$ BEGIN
  UPDATE public.tasks SET title = '越权改写任务'
   WHERE id = '64050000-0000-0000-0000-000000000001';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'tasks 直改被拒: %', SQLERRM; END $$;
DO $$ BEGIN
  DELETE FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000001';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'notes 直删被拒: %', SQLERRM; END $$;
DO $$ BEGIN
  INSERT INTO public.notes (id, user_id, title, content) VALUES
    ('64020000-0000-0000-0000-000000000099', '64000001-0000-0000-0000-000000000001',
     '冒充属主插入', '{"type":"doc"}'::jsonb);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '冒充插入被拒: %', SQLERRM; END $$;
RESET ROLE;
SELECT is((SELECT title FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000001'),
  'A的笔记', 'editor 协作者直改 notes 不生效（写权收口在 065 的 RPC，不经表）');
SELECT is((SELECT title FROM public.tasks WHERE id = '64050000-0000-0000-0000-000000000001'),
  'A的任务', 'editor 协作者直改 tasks 不生效（绕不开 sync_version 乐观锁）');
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000001'),
  1::bigint, '协作者直删共享笔记不生效');
SELECT is((SELECT count(*) FROM public.notes WHERE id = '64020000-0000-0000-0000-000000000099'),
  0::bigint, '协作者不能冒充属主插行（INSERT 策略仍只认 auth.uid() = user_id）');

-- ========== 7. 子资源对协作者仍为空（共享笔记能打开，历史与反链为空）==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '64000002-0000-0000-0000-000000000002';  -- B
SELECT is((SELECT count(*) FROM public.note_versions WHERE note_id = '64020000-0000-0000-0000-000000000001'),
  0::bigint, '共享笔记的历史版本对协作者为空');
SELECT is((SELECT count(*) FROM public.task_item_refs WHERE task_id = '64050000-0000-0000-0000-000000000001'),
  0::bigint, '协作者看不到属主的任务↔笔记反链');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.note_versions WHERE note_id = '64020000-0000-0000-0000-000000000001'),
  1::bigint, '版本行确实存在 → 上一条不是「表本来就空」');
SELECT is((SELECT count(*) FROM public.task_item_refs WHERE task_id = '64050000-0000-0000-0000-000000000001'),
  1::bigint, '反链行确实存在 → 上一条同理');

-- ========== 8. 策略结构：判定复用 + 一条写策略都没加 ==========
-- 只断「谓词里出现了 resource_role」，不断全文文本：pg_get_expr 的输出格式随 PG 版本变
SELECT ok((SELECT count(*) FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'notes'
              AND policyname LIKE 'Collaborators%' AND qual LIKE '%resource_role%') = 1,
  'notes 的协作读策略调用 resource_role()（ADR 0002：064 不得重写等价判定）');
SELECT ok((SELECT count(*) FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'reading_items'
              AND policyname LIKE 'Collaborators%' AND qual LIKE '%resource_role%') = 1,
  'reading_items 的协作读策略同样复用');
SELECT ok((SELECT count(*) FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'tasks'
              AND policyname LIKE 'Collaborators%' AND qual LIKE '%resource_role%') = 1,
  'tasks 的协作读策略同样复用');
SELECT is((SELECT count(*) FROM pg_policy pol
             JOIN pg_class c ON c.oid = pol.polrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname IN ('notes', 'reading_items', 'tasks')
              AND pol.polcmd = 'u'
              AND pg_get_expr(pol.polqual, pol.polrelid) LIKE '%resource_role%'),
  0::bigint, '三张主表都没有引用 resource_role 的 UPDATE 策略（写权收口在 065 的 RPC）');
SELECT is((SELECT count(*) FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'shares'
              AND (qual LIKE '%resource_role%' OR with_check LIKE '%resource_role%')),
  0::bigint, 'shares 未被协作判定改写（Stage 0 无消费者，见 064 文件头）');

-- ========== 9. user_profiles 可见集：只有「自己 + 同空间成员」 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '64000002-0000-0000-0000-000000000002';  -- B
SELECT is((SELECT count(*) FROM public.user_profiles WHERE id = '64000002-0000-0000-0000-000000000002'),
  1::bigint, 'B 读得到自己的档案');
SELECT is((SELECT count(*) FROM public.user_profiles WHERE id = '64000001-0000-0000-0000-000000000001'),
  1::bigint, 'B 读得到同处 W1 的 A（分享面板与冲突对话框要显示协作者名字）');
SELECT is((SELECT count(*) FROM public.user_profiles WHERE id = '64000004-0000-0000-0000-000000000004'),
  0::bigint, 'B 读不到与自己没有任何共同空间的 D（目录不整体开放）');
SET request.jwt.claim.sub TO '64000003-0000-0000-0000-000000000003';  -- C
SELECT is((SELECT count(*) FROM public.user_profiles WHERE id = '64000002-0000-0000-0000-000000000002'),
  0::bigint, 'C 读不到 B：两人各自与 A 同空间，但彼此没有共同空间（可见性不传递）');
SELECT is(public.shares_workspace_with('64000001-0000-0000-0000-000000000001'), true,
  'C 与 A 确实同处 W2（档案可见性与该判定同口径）');
SELECT is(public.shares_workspace_with('64000004-0000-0000-0000-000000000004'), false,
  'C 与 D 无共同空间');
DO $$ BEGIN
  UPDATE public.user_profiles SET display_name = '越权改名'
   WHERE id = '64000001-0000-0000-0000-000000000001';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '改别人档案被拒: %', SQLERRM; END $$;
DO $$ BEGIN
  INSERT INTO public.user_profiles (id, display_name)
  VALUES ('64000002-0000-0000-0000-000000000002', '替别人建档');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '替别人建档被拒: %', SQLERRM; END $$;
DO $$ BEGIN
  DELETE FROM public.user_profiles
   WHERE id = '64000001-0000-0000-0000-000000000001';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '删别人档案被拒: %', SQLERRM; END $$;
RESET ROLE;
SELECT is((SELECT display_name FROM public.user_profiles
            WHERE id = '64000001-0000-0000-0000-000000000001'), 'A 全名',
  '非本人改档案不生效');
SELECT is((SELECT display_name FROM public.user_profiles
            WHERE id = '64000002-0000-0000-0000-000000000002'), 'B 全名',
  '不能替别人建档（档案行只由触发器与 backfill 产生）');
SELECT is((SELECT count(*) FROM public.user_profiles
            WHERE id = '64000001-0000-0000-0000-000000000001'), 1::bigint,
  '删不掉同空间成员的档案');

-- ========== 10. 权限收口（用权限目录断言，不依赖错误文案）==========
SELECT is(has_table_privilege('anon', 'public.user_profiles', 'SELECT'), false,
  '目录不给匿名可读');
SELECT is(has_table_privilege('authenticated', 'public.user_profiles', 'SELECT'), true,
  '登录用户可查（再由 RLS 收到「自己 + 同空间」）');
SELECT is(has_table_privilege('authenticated', 'public.user_profiles', 'INSERT'), false,
  '显式收回 INSERT，而不是靠「不建 insert 策略」');
SELECT is(has_table_privilege('authenticated', 'public.user_profiles', 'DELETE'), false,
  '显式收回 DELETE');
SELECT hasnt_column('public.user_profiles', 'email',
  '档案表不缓存邮箱：本表允许本人 UPDATE，缓存邮箱等于让用户自填别人的地址');
SELECT is(has_function_privilege('anon', 'find_user_by_email(text)', 'EXECUTE'), false,
  '匿名不可查人');
SELECT is(has_function_privilege('authenticated', 'find_user_by_email(text)', 'EXECUTE'), true,
  '登录用户可查人（邀请流程需要）');
SELECT is(has_function_privilege('authenticated', 'mirror_user_profile()', 'EXECUTE'), false,
  '触发器函数不对客户端开放（它能写任意人的档案）');
SELECT is(has_function_privilege('authenticated', 'shares_workspace_with(uuid)', 'EXECUTE'), true,
  '同空间判定可调用（RLS 策略本身要以 authenticated 求值）');
SELECT is(has_function_privilege('anon', 'shares_workspace_with(uuid)', 'EXECUTE'), false,
  '匿名不可调用该判定');

-- ========== 11. find_user_by_email：只能精确查人 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '64000001-0000-0000-0000-000000000001';  -- A
SELECT is((SELECT user_id FROM public.find_user_by_email(' P5_RLS_B@Test ')),
  '64000002-0000-0000-0000-000000000002', 'btrim + lower 后精确命中（邀请方大小写随便填）');
SELECT is((SELECT count(*) FROM public.find_user_by_email('p5_rls_b@test')), 1::bigint,
  '命中恰好一行');
SELECT is((SELECT display_name FROM public.find_user_by_email('p5_rls_d@test')), 'D 全名',
  '查人返回昵称供邀请确认；这一行不经档案 RLS，是 RPC 的既定用途');
SELECT is((SELECT count(*) FROM public.find_user_by_email('p5_rls_b')), 0::bigint,
  '前缀不命中：不能拿它遍历目录');
SELECT is((SELECT count(*) FROM public.find_user_by_email('%@%')), 0::bigint,
  '通配符按字面量处理，不拼成 LIKE');
SELECT is((SELECT count(*) FROM public.find_user_by_email('')), 0::bigint, '空串不命中');
SELECT is((SELECT count(*) FROM public.find_user_by_email('p5_rls_b@test@')), 0::bigint,
  '@ 结尾的畸形输入不命中');
SELECT is((SELECT count(*) FROM public.find_user_by_email('nobody@nowhere.test')), 0::bigint,
  '未注册与不匹配都返回空集，调用方分不出来');
SET request.jwt.claim.sub TO '';
SELECT throws_ok(
  $$SELECT count(*) FROM public.find_user_by_email('p5_rls_b@test')$$,
  'anonymous', 'auth.uid() 为空时直接拒，不查表');

-- ========== 12. 镜像触发器：建档、跟得动 auth、但冲不掉自设昵称 ==========
RESET ROLE;
DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('64000005-0000-0000-0000-000000000005', 'p5_rls_e@test', '{"full_name":"E 全名"}'),
    ('64000006-0000-0000-0000-000000000006', 'p5_rls_f@test', '{"name":"F 名"}');
END $$;
SELECT is((SELECT display_name FROM public.user_profiles
            WHERE id = '64000005-0000-0000-0000-000000000005'), 'E 全名',
  '注册即建档（取 full_name）');
SELECT is((SELECT display_name FROM public.user_profiles
            WHERE id = '64000006-0000-0000-0000-000000000006'), 'F 名',
  '没有 full_name 时回退到 name');
UPDATE public.user_profiles SET display_name = NULL
 WHERE id = '64000005-0000-0000-0000-000000000005';
UPDATE auth.users SET raw_user_meta_data = '{"full_name":"E 改名"}'::jsonb
 WHERE id = '64000005-0000-0000-0000-000000000005';
SELECT is((SELECT display_name FROM public.user_profiles
            WHERE id = '64000005-0000-0000-0000-000000000005'), 'E 改名',
  '档案为空时 auth.users 更新会跟着走 → 证明 UPDATE 路径的触发器真的在跑');
UPDATE public.user_profiles SET display_name = '自设昵称'
 WHERE id = '64000005-0000-0000-0000-000000000005';
UPDATE auth.users SET raw_user_meta_data = '{"full_name":"冲掉试试"}'::jsonb
 WHERE id = '64000005-0000-0000-0000-000000000005';
SELECT is((SELECT display_name FROM public.user_profiles
            WHERE id = '64000005-0000-0000-0000-000000000005'), '自设昵称',
  '用户自设昵称不被后续 auth 更新冲掉（coalesce 方向是档案优先）');
SELECT is((SELECT count(*) FROM public.user_profiles
            WHERE id = '64000005-0000-0000-0000-000000000005'), 1::bigint,
  '反复镜像不产生重复行（幂等 upsert）');

SELECT * FROM finish();
ROLLBACK;
