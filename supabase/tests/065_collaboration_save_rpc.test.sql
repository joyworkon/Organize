-- 065 协作保存 RPC 分权 pgTAP（P5-02 卡 3/4）
--
-- 覆盖（节号与 065 文件头的承诺一一对应）：
--   1. 授权前只有属主存得进去；协作者路径一条都不放行
--   2. editor 授权后 B 真的写进了 A 的行：revision 递增、内容落库、属主行不被搬走
--   3. viewer 只读：读得到、存不进（逐资源边界，不因同空间而连带放开）
--   4. 无权限的人拿不到「这篇笔记存不存在」：不存在与无权限同形
--   5. 乐观锁跨账号成立：旧 revision 覆盖不了别人刚写的内容
--   6. 幂等重放按调用者记账，重放不再推进 revision
--   7. 任务链：改得到属主的任务、refs 写的是属主（复合外键），改不到自己或别人的任务
--   8. 051 的复选框「真实变迁」语义不因协作而退化
--   9. 垃圾箱里的共享笔记照样写不进
--  10. 版本触发器不再把协作者保存炸掉，且 056 的 prune 属主校验没被放松
--  11. 孤儿回收以属主为 scope
--  12. 结构断言：判定复用 + v1 未被改动 + 函数权限收口
--  13. 页面结构不放权：协作者搬不动属主的笔记树
--
-- 约定同 063 / 064：断言不依赖表级 GRANT 的错误文案；计数一律带 id 限定。
-- 另外两点本文专属的写法：
--   * revision / sync_version 轨迹一律先写进临时表 rev_watch（「调用前值」），断言时
--     只与 rev_watch 的派生值比 —— 绝不能把「读库」和「调用会改库的 RPC」当成同一个
--     表达式的两个参数，Postgres 不保证参数求值顺序，那样写会随机红。
--   * N1 / N5 刻意不预置 note_versions：第 10 节要靠「协作者保存后只留下第 1 条版本」
--     证明触发器真的走到了裁剪那一行，而不是被 5 分钟去抖提前 return 绕过。
BEGIN;
SELECT plan(94);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('65000001-0000-0000-0000-000000000001', 'p5_save_a@test', '{"full_name":"A 全名"}'),
    ('65000002-0000-0000-0000-000000000002', 'p5_save_b@test', '{"full_name":"B 全名"}'),
    ('65000003-0000-0000-0000-000000000003', 'p5_save_c@test', '{"full_name":"C 全名"}'),
    ('65000004-0000-0000-0000-000000000004', 'p5_save_d@test', '{"full_name":"D 全名"}'),
    ('65000005-0000-0000-0000-000000000005', 'p5_save_e@test', '{"full_name":"E 全名"}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- W1: A owner，B/C/D member（本文件唯一被授权的空间）；W2: E 自己的空间
INSERT INTO public.workspaces (id, name, kind, owner_id) VALUES
  ('65010000-0000-0000-0000-000000000001', 'SAVE-W1', 'team', '65000001-0000-0000-0000-000000000001'),
  ('65010000-0000-0000-0000-000000000002', 'SAVE-W2', 'team', '65000005-0000-0000-0000-000000000005');

INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('65010000-0000-0000-0000-000000000001', '65000001-0000-0000-0000-000000000001', 'owner'),
  ('65010000-0000-0000-0000-000000000001', '65000002-0000-0000-0000-000000000002', 'member'),
  ('65010000-0000-0000-0000-000000000001', '65000003-0000-0000-0000-000000000003', 'member'),
  ('65010000-0000-0000-0000-000000000001', '65000004-0000-0000-0000-000000000004', 'member'),
  ('65010000-0000-0000-0000-000000000002', '65000005-0000-0000-0000-000000000005', 'owner');

-- N1 主战场（A）；N2 给 W1 只读；N3 属于 E；N4 已进垃圾箱；N5 孤儿回收用
INSERT INTO public.notes (id, user_id, title, content, deleted_at) VALUES
  ('65020000-0000-0000-0000-000000000001', '65000001-0000-0000-0000-000000000001',
   'A的共享笔记',
   '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"blk-65-1","taskId":"65050000-0000-0000-0000-000000000001","checked":false}}]}',
   NULL),
  ('65020000-0000-0000-0000-000000000002', '65000001-0000-0000-0000-000000000001',
   'A的只读笔记', '{"type":"doc","content":[{"type":"paragraph"}]}', NULL),
  ('65020000-0000-0000-0000-000000000003', '65000005-0000-0000-0000-000000000005',
   'E的笔记', '{"type":"doc","content":[{"type":"paragraph"}]}', NULL),
  ('65020000-0000-0000-0000-000000000004', '65000001-0000-0000-0000-000000000001',
   'A的垃圾箱笔记', '{"type":"doc","content":[{"type":"paragraph"}]}', now() - interval '1 hour'),
  ('65020000-0000-0000-0000-000000000005', '65000001-0000-0000-0000-000000000001',
   'A的孤儿试验笔记',
   '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"blk-65-5","taskId":"65050000-0000-0000-0000-000000000005","checked":false}}]}',
   NULL);

INSERT INTO public.task_lists (id, user_id, name) VALUES
  ('65040000-0000-0000-0000-000000000001', '65000001-0000-0000-0000-000000000001', 'A清单'),
  ('65040000-0000-0000-0000-000000000002', '65000002-0000-0000-0000-000000000002', 'B清单'),
  ('65040000-0000-0000-0000-000000000003', '65000005-0000-0000-0000-000000000005', 'E清单');

-- T1: N1 里内联的任务（reference_managed）；T2: A 的普通任务（无引用，用来打
-- reference_managed 边界）；T3: E 的任务；T4/T6: B 名下的任务（T6 引用托管且无引用，
-- 只有「回收按调用者 scope」的错误实现才会误删它）
INSERT INTO public.tasks (id, user_id, list_id, title, status, reference_managed) VALUES
  ('65050000-0000-0000-0000-000000000001', '65000001-0000-0000-0000-000000000001',
   '65040000-0000-0000-0000-000000000001', 'A的内联任务', 'todo', true),
  ('65050000-0000-0000-0000-000000000002', '65000001-0000-0000-0000-000000000001',
   '65040000-0000-0000-0000-000000000001', 'A的普通任务', 'todo', false),
  ('65050000-0000-0000-0000-000000000003', '65000005-0000-0000-0000-000000000005',
   '65040000-0000-0000-0000-000000000003', 'E的任务', 'todo', false),
  ('65050000-0000-0000-0000-000000000004', '65000002-0000-0000-0000-000000000002',
   '65040000-0000-0000-0000-000000000002', 'B自己的任务', 'todo', false),
  ('65050000-0000-0000-0000-000000000005', '65000001-0000-0000-0000-000000000001',
   '65040000-0000-0000-0000-000000000001', 'A的孤儿任务', 'todo', true),
  ('65050000-0000-0000-0000-000000000006', '65000002-0000-0000-0000-000000000002',
   '65040000-0000-0000-0000-000000000002', 'B的托管任务', 'todo', true);

INSERT INTO public.task_item_refs (id, user_id, task_id, note_id, block_id) VALUES
  ('65070000-0000-0000-0000-000000000001', '65000001-0000-0000-0000-000000000001',
   '65050000-0000-0000-0000-000000000001', '65020000-0000-0000-0000-000000000001', 'blk-65-1'),
  ('65070000-0000-0000-0000-000000000005', '65000001-0000-0000-0000-000000000001',
   '65050000-0000-0000-0000-000000000005', '65020000-0000-0000-0000-000000000005', 'blk-65-5');

CREATE TEMP TABLE rev_watch (k text PRIMARY KEY, v integer);
-- 后续断言会在 SET ROLE authenticated 之后读写它：临时表默认只给属主权限，必须显式授
GRANT ALL ON rev_watch TO authenticated;

-- ========== 1. 授权前：只有属主存得进去 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    p_expected_note_revision := 0))->>'status',
  'forbidden', '未授权时 B 存不进 A 的笔记（连 revision 传对了也没用）');
SET request.jwt.claim.sub TO '65000003-0000-0000-0000-000000000003';  -- C
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    p_expected_note_revision := 0))->>'status',
  'forbidden', '未授权时 C 同样存不进');
SET request.jwt.claim.sub TO '65000005-0000-0000-0000-000000000005';  -- E
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    p_expected_note_revision := 0))->>'status',
  'forbidden', '与 A 无任何共同空间的 E 存不进');
SET request.jwt.claim.sub TO '65000001-0000-0000-0000-000000000001';  -- A
INSERT INTO rev_watch SELECT 'n5_pre', content_revision FROM public.notes
 WHERE id = '65020000-0000-0000-0000-000000000005';
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000005',
    p_content := '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"blk-65-5","taskId":"65050000-0000-0000-0000-000000000005","checked":true}}]}',
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n5_pre')))->>'status',
  'ok', '正向对照：属主 A 用自己的笔记走通 v2（否则上面三条负例可能是恒真）');
RESET ROLE;
SELECT is((SELECT content FROM public.notes WHERE id = '65020000-0000-0000-0000-000000000001'),
  '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"blk-65-1","taskId":"65050000-0000-0000-0000-000000000001","checked":false}}]}'::jsonb,
  '被拒的三次保存没留下任何内容改动');
SELECT is((SELECT count(*) FROM public.note_versions
           WHERE note_id = '65020000-0000-0000-0000-000000000001'),
  0::bigint, 'N1 此刻还没有历史版本（第 10 节的前提）');

-- ========== 2. editor 授权后，B 真的写进了 A 的行 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000001-0000-0000-0000-000000000001';  -- A 授权
SELECT lives_ok(
  $$SELECT public.grant_resource('note', '65020000-0000-0000-0000-000000000001',
        '65010000-0000-0000-0000-000000000001', 'editor')$$,
  'A 把 N1 以 editor 授权给 W1');
SELECT lives_ok(
  $$SELECT public.grant_resource('note', '65020000-0000-0000-0000-000000000002',
        '65010000-0000-0000-0000-000000000001', 'viewer')$$,
  'A 把 N2 以 viewer 授权给 W1');
SELECT lives_ok(
  $$SELECT public.grant_resource('note', '65020000-0000-0000-0000-000000000004',
        '65010000-0000-0000-0000-000000000001', 'editor')$$,
  'A 把垃圾箱里的 N4 也授权给 W1（第 9 节要用）');
SELECT lives_ok(
  $$SELECT public.grant_resource('note', '65020000-0000-0000-0000-000000000005',
        '65010000-0000-0000-0000-000000000001', 'editor')$$,
  'A 把 N5 以 editor 授权给 W1（第 11 节要用）');

SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
SELECT is(public.resource_role('note', '65020000-0000-0000-0000-000000000001'),
  'editor', 'B 视角：W1 成员 + editor 授权 → resource_role=editor');
SELECT is(public.resource_role('note', '65020000-0000-0000-0000-000000000002'),
  'viewer', 'B 视角：同一空间里的 N2 只有 viewer（授权逐资源，不随空间连坐）');
INSERT INTO rev_watch SELECT 'n1_pre', content_revision FROM public.notes
 WHERE id = '65020000-0000-0000-0000-000000000001';
-- 下面这一句同时是「版本触发器」的回归位：056 的 prune 只认 auth.uid()，
-- 修复前 B 的第一次内容变更保存会在这里整体失败。
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"paragraph"},{"type":"taskItem","attrs":{"id":"blk-65-1","taskId":"65050000-0000-0000-0000-000000000001","checked":false}}]}',
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n1_pre'),
    p_title := 'B改过的标题',
    p_note_snapshot := '{"icon":"🌱","full_width":true}'::jsonb))->>'status',
  'ok', 'editor B 保存 A 的笔记成功');
RESET ROLE;
SELECT is((SELECT content_revision FROM public.notes
           WHERE id = '65020000-0000-0000-0000-000000000001'),
  (SELECT v + 1 FROM rev_watch WHERE k = 'n1_pre'),
  '协作者保存同样推进乐观锁 revision（+1）');
SELECT is((SELECT title FROM public.notes WHERE id = '65020000-0000-0000-0000-000000000001'),
  'B改过的标题', 'editor 可改标题（共享页的标题属于页面本身）');
SELECT is((SELECT icon FROM public.notes WHERE id = '65020000-0000-0000-0000-000000000001'),
  '🌱', 'editor 可改页面表现层属性（icon/排版偏好按 Notion 口径放开）');
SELECT is((SELECT full_width FROM public.notes WHERE id = '65020000-0000-0000-0000-000000000001'),
  true, 'full_width 同样落库');
SELECT is((SELECT user_id FROM public.notes WHERE id = '65020000-0000-0000-0000-000000000001'),
  '65000001-0000-0000-0000-000000000001', '协作者改不动属主列：这行仍然是 A 的');

-- ========== 3. viewer 只读：读得到、存不进 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000003-0000-0000-0000-000000000003';  -- C
SELECT is((SELECT count(*) FROM public.notes
           WHERE id = '65020000-0000-0000-0000-000000000002'),
  1::bigint, 'viewer C 读得到 N2（064 的只读策略，与写权是两件事）');
INSERT INTO rev_watch SELECT 'n2_pre', content_revision FROM public.notes
 WHERE id = '65020000-0000-0000-0000-000000000002';
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000002',
    p_content := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n2_pre')))->>'status',
  'forbidden', 'viewer 存不进（resource_role 放行读，v2 只放行 owner/editor）');
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000002',
    p_content := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n2_pre')))->>'status',
  'forbidden', 'B 在 N1 上是 editor，但在 N2 上只是 viewer → 存不进（授权不跨资源）');
SET request.jwt.claim.sub TO '65000004-0000-0000-0000-000000000004';  -- D
SELECT is(public.resource_role('note', '65020000-0000-0000-0000-000000000002'),
  'viewer', 'D 也是 W1 成员：授权对象是空间，成员拿到的是同一档 viewer');
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000002',
    p_content := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n2_pre')))->>'status',
  'forbidden', 'D 同样存不进');
RESET ROLE;
SELECT is((SELECT content_revision FROM public.notes
           WHERE id = '65020000-0000-0000-0000-000000000002'),
  (SELECT v FROM rev_watch WHERE k = 'n2_pre'), '被拒的三次 viewer 保存没有推进 revision');

-- ========== 4. 无权限者拿不到「这篇笔记存不存在」 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000005-0000-0000-0000-000000000005';  -- E
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := 7))->>'status',
  'forbidden', 'E 无权限：即使猜对 id 也只拿到 forbidden');
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-0000000000ff',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := 7))->>'status',
  'forbidden', '不存在的 id 也是 forbidden —— 与上一条同形，v2 不是存在性探针');
SELECT is((public.save_note_with_tasks(
    p_note_id := '65020000-0000-0000-0000-0000000000ff',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := 7))->>'status',
  'not_found', '对照：v1 在这种情形下会区分出 not_found（v2 刻意收紧的差异点）');
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000003',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := 0))->>'status',
  'forbidden', 'B 存不进 E 的笔记：A 空间给的授权不产生碰别人资源的权利');
SET request.jwt.claim.sub TO '65000005-0000-0000-0000-000000000005';  -- E
INSERT INTO rev_watch SELECT 'n3_pre', content_revision FROM public.notes
 WHERE id = '65020000-0000-0000-0000-000000000003';
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000003',
    p_content := '{"type":"doc","content":[{"type":"heading"}]}'::jsonb,
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n3_pre')))->>'status',
  'ok', '正向对照：E 存自己的笔记照常通（v2 不是围着 A 写的特例）');
RESET ROLE;
SELECT is((SELECT content_revision FROM public.notes
           WHERE id = '65020000-0000-0000-0000-000000000003'),
  (SELECT v + 1 FROM rev_watch WHERE k = 'n3_pre'), 'E 自己的保存落库（属主路径无回归）');

-- ========== 5. 乐观锁跨账号成立 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n1_pre')))->>'status',
  'conflict_note', 'B 拿旧 revision 再存 → conflict_note（覆盖不了别人刚写的内容）');
SELECT is(((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n1_pre')))
    ->>'current_revision')::integer,
  (SELECT v + 1 FROM rev_watch WHERE k = 'n1_pre'),
  '冲突里回带的 current_revision 是真实当前值');
SET request.jwt.claim.sub TO '65000001-0000-0000-0000-000000000001';  -- A
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n1_pre')))->>'status',
  'conflict_note', '属主 A 用 B 保存前的 revision 存 → 也冲突（锁对双方同等生效）');
RESET ROLE;
SELECT is((SELECT content_revision FROM public.notes
           WHERE id = '65020000-0000-0000-0000-000000000001'),
  (SELECT v + 1 FROM rev_watch WHERE k = 'n1_pre'), '三次冲突尝试都没推进 revision');

-- ========== 6. 幂等重放按调用者记账 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
INSERT INTO rev_watch SELECT 'n1_replay', content_revision FROM public.notes
 WHERE id = '65020000-0000-0000-0000-000000000001';
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"p6"}},{"type":"taskItem","attrs":{"id":"blk-65-1","taskId":"65050000-0000-0000-0000-000000000001","checked":false}}]}',
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n1_replay'),
    p_mutation_id := '65060000-0000-0000-0000-000000000001'))->>'status',
  'ok', 'B 带 mutation_id 保存成功');
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"p6"}},{"type":"taskItem","attrs":{"id":"blk-65-1","taskId":"65050000-0000-0000-0000-000000000001","checked":false}}]}',
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n1_replay'),
    p_mutation_id := '65060000-0000-0000-0000-000000000001'))->>'status',
  'ok', '同一 mutation_id 重放：不报冲突（重试不该让用户看到冲突框）');
SELECT is(((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"p6"}},{"type":"taskItem","attrs":{"id":"blk-65-1","taskId":"65050000-0000-0000-0000-000000000001","checked":false}}]}',
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n1_replay'),
    p_mutation_id := '65060000-0000-0000-0000-000000000001'))
    ->>'note_revision')::integer,
  (SELECT v + 1 FROM rev_watch WHERE k = 'n1_replay'),
  '重放返回的是缓存结果里的同一个 revision');
RESET ROLE;
SELECT is((SELECT content_revision FROM public.notes
           WHERE id = '65020000-0000-0000-0000-000000000001'),
  (SELECT v + 1 FROM rev_watch WHERE k = 'n1_replay'), '三次重放只落一次库');
SELECT is((SELECT user_id FROM public.save_mutation_log
           WHERE mutation_id = '65060000-0000-0000-0000-000000000001'),
  '65000002-0000-0000-0000-000000000002', '日志记的是调用者 B，不是笔记属主 A');
SELECT is((SELECT note_id FROM public.save_mutation_log
           WHERE mutation_id = '65060000-0000-0000-0000-000000000001'),
  '65020000-0000-0000-0000-000000000001', '日志按笔记限域（047 的口径在 v2 里保持）');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
SELECT is((SELECT count(*) FROM public.save_mutation_log
           WHERE mutation_id = '65060000-0000-0000-0000-000000000001'),
  1::bigint, 'B 自己看得到这条日志');
SET request.jwt.claim.sub TO '65000001-0000-0000-0000-000000000001';  -- A
SELECT is((SELECT count(*) FROM public.save_mutation_log
           WHERE mutation_id = '65060000-0000-0000-0000-000000000001'),
  0::bigint, '属主 A 看不到 B 的重试键（重试键属于每个会话自己）');

-- ========== 7. 任务链：写入 scope 是属主而不是调用者 ==========
-- 基线以 postgres 记：T1 是 A 未单独授权的任务，协作者 B 经 RLS 读不到它
RESET ROLE;
INSERT INTO rev_watch SELECT 't1_rev', sync_version FROM public.tasks
 WHERE id = '65050000-0000-0000-0000-000000000001';
INSERT INTO rev_watch SELECT 'n1_task', content_revision FROM public.notes
 WHERE id = '65020000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
SELECT is(((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"blk-65-1","taskId":"65050000-0000-0000-0000-000000000001","checked":true}}]}',
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n1_task'),
    p_task_mutations := '[{"task_id":"65050000-0000-0000-0000-000000000001","status":"done"}]'::jsonb))
    ->'task_revisions'->>'65050000-0000-0000-0000-000000000001')::integer,
  (SELECT v + 1 FROM rev_watch WHERE k = 't1_rev'),
  'B 勾选属主任务块：返回的 sync_version = 旧值 +1');
RESET ROLE;
SELECT is((SELECT sync_version FROM public.tasks
           WHERE id = '65050000-0000-0000-0000-000000000001'),
  (SELECT v + 1 FROM rev_watch WHERE k = 't1_rev'), '库里的任务 sync_version 与返回值一致');
SELECT is((SELECT status FROM public.tasks
           WHERE id = '65050000-0000-0000-0000-000000000001'),
  'done', 'A 的任务真的被协作者勾上了（共享笔记里的任务块可编辑）');
SELECT ok((SELECT completed_at IS NOT NULL FROM public.tasks
           WHERE id = '65050000-0000-0000-0000-000000000001'),
  'completed_at 随之写入（051 语义不因协作而退化）');
SELECT is((SELECT user_id FROM public.task_item_refs
           WHERE note_id = '65020000-0000-0000-0000-000000000001' AND block_id = 'blk-65-1'),
  '65000001-0000-0000-0000-000000000001',
  '反链行写的是属主 A：056 的 (note_id,user_id)/(task_id,user_id) 复合外键要求如此');
SELECT is((SELECT count(*) FROM public.task_activities
           WHERE task_id = '65050000-0000-0000-0000-000000000001'
             AND user_id = '65000001-0000-0000-0000-000000000001'),
  2::bigint, 'T1 的两条活动（seeding 的 created + 协作者造成的 status_changed）都记在属主 A 名下');
SELECT is((SELECT user_id FROM public.task_activities
           WHERE task_id = '65050000-0000-0000-0000-000000000001'
             AND action = 'status_changed'
           ORDER BY created_at DESC LIMIT 1),
  '65000001-0000-0000-0000-000000000001',
  '触发器用 new.user_id 记账，不是 auth.uid() → 协作保存不会把活动写到 B 名下');

SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
INSERT INTO rev_watch SELECT 'n1_own_task', content_revision FROM public.notes
 WHERE id = '65020000-0000-0000-0000-000000000001';
SELECT is(((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"blk-65-1","taskId":"65050000-0000-0000-0000-000000000001","checked":true}}]}',
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n1_own_task'),
    p_task_mutations := '[{"task_id":"65050000-0000-0000-0000-000000000004","status":"done"}]'::jsonb))
    ->>'reason'),
  'not_found_or_forbidden', 'B 想借 A 的笔记改自己账号下的任务 → 拒（写入 scope 是属主）');
RESET ROLE;
SELECT is((SELECT status FROM public.tasks
           WHERE id = '65050000-0000-0000-0000-000000000004'),
  'todo', 'B 自己的任务没被这次尝试改动');
SELECT is((SELECT content_revision FROM public.notes
           WHERE id = '65020000-0000-0000-0000-000000000001'),
  (SELECT v FROM rev_watch WHERE k = 'n1_own_task'),
  '任务冲突时整笔回滚：笔记内容也没落库（原子性沿用 v1）');

SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
INSERT INTO rev_watch SELECT 'n1_foreign_task', content_revision FROM public.notes
 WHERE id = '65020000-0000-0000-0000-000000000001';
SELECT is(((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n1_foreign_task'),
    p_task_mutations := '[{"task_id":"65050000-0000-0000-0000-000000000003","status":"done"}]'::jsonb))
    ->>'reason'),
  'not_found_or_forbidden', 'B 也改不到 E 的任务');
RESET ROLE;
SELECT is((SELECT status FROM public.tasks
           WHERE id = '65050000-0000-0000-0000-000000000003'),
  'todo', 'E 的任务没被动过');

-- ========== 8. 051 的复选框「真实变迁」语义在协作下同样成立 ==========
-- 051 的口径：勾选（done）= 从非 done 真实完成；取消勾选（todo）= 仅把已完成的回退。
-- 所以 in_progress / cancelled 只受「取消勾选」保护，勾选仍会把它们完成。
UPDATE public.tasks SET status = 'in_progress'
 WHERE id = '65050000-0000-0000-0000-000000000001';
UPDATE public.tasks SET status = 'cancelled'
 WHERE id = '65050000-0000-0000-0000-000000000002';
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
INSERT INTO rev_watch SELECT 'n1_status', content_revision FROM public.notes
 WHERE id = '65020000-0000-0000-0000-000000000001';
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"blk-65-1","taskId":"65050000-0000-0000-0000-000000000001","checked":false}}]}',
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n1_status'),
    p_task_mutations := ('[{"task_id":"65050000-0000-0000-0000-000000000001","status":"todo"},'
      || '{"task_id":"65050000-0000-0000-0000-000000000002","status":"todo"}]')::jsonb))->>'status',
  'ok', 'B 取消勾选一个进行中 + 一个已放弃的任务：保存本身成功');
RESET ROLE;
SELECT is((SELECT status FROM public.tasks
           WHERE id = '65050000-0000-0000-0000-000000000001'),
  'in_progress', '取消勾选不把 in_progress 抹回 todo（051 结论在 v2 里保持）');
SELECT is((SELECT status FROM public.tasks
           WHERE id = '65050000-0000-0000-0000-000000000002'),
  'cancelled', '取消勾选也不把 cancelled 抹回 todo（同一条边界覆盖两态）');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
INSERT INTO rev_watch SELECT 'n1_status2', content_revision FROM public.notes
 WHERE id = '65020000-0000-0000-0000-000000000001';
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"blk-65-1","taskId":"65050000-0000-0000-0000-000000000001","checked":false}}]}',
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n1_status2'),
    p_task_mutations := '[{"task_id":"65050000-0000-0000-0000-000000000002","status":"done"}]'::jsonb))->>'status',
  'ok', 'B 勾选那个已放弃的任务：保存成功');
RESET ROLE;
SELECT is((SELECT status FROM public.tasks
           WHERE id = '65050000-0000-0000-0000-000000000002'),
  'done', '勾选=真实完成：即使此前是 cancelled 也会被勾成 done（051 的原样语义，v2 不改）');
SELECT ok((SELECT completed_at IS NOT NULL FROM public.tasks
           WHERE id = '65050000-0000-0000-0000-000000000002'),
  '随之写入 completed_at');

-- ========== 9. 垃圾箱里的共享笔记照样写不进 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B（N4 也是 editor）
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000004',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := 0))->>'status',
  'not_found', 'editor 存不进垃圾箱里的笔记；因确有权限而拿到 not_found');
SET request.jwt.claim.sub TO '65000001-0000-0000-0000-000000000001';  -- A
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000004',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := 0))->>'status',
  'not_found', '属主存自己的垃圾箱笔记同样 not_found（与 v1 同形）');
SELECT is((public.save_note_with_tasks(
    p_note_id := '65020000-0000-0000-0000-000000000004',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := 0))->>'status',
  'not_found', '对照：v1 在同一场景下给出同一个状态');
SELECT is((public.save_note_with_tasks(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := 0))->>'status',
  'conflict_note', '对照：v1 的乐观锁照常在工作（本卡没有把它改松）');
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
SELECT is((public.save_note_with_tasks(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := (SELECT v + 1 FROM rev_watch WHERE k = 'n1_status')
      ))->>'status',
  'forbidden', '并存期 v1 仍然只认属主：B 拿准当前 revision 走 v1 也进不去');

-- ========== 10. 版本触发器：协作者保存不再被 prune 的属主校验炸掉 ==========
-- 这是本卡真正的坑：056 给 prune_note_versions 加了 notes.user_id = auth.uid() 校验，
-- 而 save_note_version 触发器在协作者保存上下文里 auth.uid()=B、NEW.user_id=A。
-- 修复前，第 2 节 B 的第一次保存就会整体失败。
-- 注意：note_versions 对协作者不可见（064 子资源仍属主专属），数版本行必须回到
-- postgres / 属主视角，否则会把「RLS 看不见」误读成「行没了」。
RESET ROLE;
SELECT is((SELECT count(*) FROM public.note_versions
           WHERE note_id = '65020000-0000-0000-0000-000000000001'),
  1::bigint, 'N1 只有第 2 节那一次保存留下的 1 条版本（后续保存被 5 分钟去抖合并）');
SELECT is((SELECT title FROM public.note_versions
           WHERE note_id = '65020000-0000-0000-0000-000000000001'),
  'A的共享笔记', '版本存的是那次保存前的旧标题（快照语义不变）');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
SELECT throws_ok(
  $$SELECT public.prune_note_versions('65020000-0000-0000-0000-000000000001')$$,
  'Note not found or access denied',
  '056 的属主校验没被放松：B 直调 prune 仍然被拒');
SET request.jwt.claim.sub TO '65000001-0000-0000-0000-000000000001';  -- A
SELECT lives_ok(
  $$SELECT public.prune_note_versions('65020000-0000-0000-0000-000000000001')$$,
  'A 直调自己的 prune 仍然可用（对外签名与行为不变）');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.note_versions
           WHERE note_id = '65020000-0000-0000-0000-000000000001'),
  1::bigint, 'A 的裁剪没有误删（只有一条版本，属主上下文正确）');
SELECT is((SELECT count(*) FROM public.note_versions
           WHERE note_id = '65020000-0000-0000-0000-000000000005'),
  1::bigint, 'N5 也有 1 条版本：第 1 节 A 的保存（属主上下文）同样正常');

-- ========== 11. 孤儿回收以属主为 scope ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
INSERT INTO rev_watch SELECT 'n5_orphan', content_revision FROM public.notes
 WHERE id = '65020000-0000-0000-0000-000000000005';
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000005',
    p_content := '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
    p_expected_note_revision := (SELECT v FROM rev_watch WHERE k = 'n5_orphan')))->>'status',
  'ok', 'B 把 N5 里的任务块整块删掉');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.task_item_refs
           WHERE note_id = '65020000-0000-0000-0000-000000000005'),
  0::bigint, 'N5 的反链随之清空');
SELECT ok((SELECT deleted_at IS NOT NULL FROM public.tasks
           WHERE id = '65050000-0000-0000-0000-000000000005'),
  'A 的 reference_managed 任务被回收');
SELECT is((SELECT deleted_reason FROM public.tasks
           WHERE id = '65050000-0000-0000-0000-000000000005'),
  'orphaned', '回收原因与 v1 一致');
SELECT ok((SELECT deleted_at IS NULL FROM public.tasks
           WHERE id = '65050000-0000-0000-0000-000000000006'),
  'B 名下同样「引用托管且无引用」的任务不被牵连 —— 回收 scope 是属主而非调用者');
SELECT ok((SELECT deleted_at IS NULL FROM public.tasks
           WHERE id = '65050000-0000-0000-0000-000000000002'),
  'A 名下非托管任务不被牵连（reference_managed 边界照旧）');

-- ========== 12. 结构：判定复用 + v1 未动 + 权限收口 ==========
SELECT ok((SELECT prosrc FROM pg_proc WHERE proname = 'save_note_with_tasks_v2' LIMIT 1)
  LIKE '%public.resource_role(%', 'v2 的权限判定调用 063 的 resource_role()');
SELECT ok(POSITION('resource_acl' IN
  (SELECT prosrc FROM pg_proc WHERE proname = 'save_note_with_tasks_v2' LIMIT 1)) = 0,
  'v2 里没有自己 join resource_acl（不得重写等价判定 SQL）');
SELECT ok(POSITION('workspace_members' IN
  (SELECT prosrc FROM pg_proc WHERE proname = 'save_note_with_tasks_v2' LIMIT 1)) = 0,
  'v2 里没有自己 join workspace_members（同上）');
SELECT has_function('public', 'save_note_with_tasks',
  'v1 保留：前端接入是下一张卡，并存期间 v1 仍只放行属主');
SELECT has_column('public', 'notes', 'last_edit_by',
  '归属列已由 066 补齐（本卡的 hasnt_column 钉子按计划翻转：加列须连带备份合同与 mock seed）');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '';  -- auth.uid() 为空
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '65020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := 99))->>'status',
  'forbidden', '匿名（auth.uid() 为空）直接 forbidden');
RESET ROLE;
SELECT is(has_function_privilege('authenticated',
  'save_note_with_tasks_v2(uuid,jsonb,integer,text,jsonb,jsonb,uuid,jsonb)', 'EXECUTE'),
  true, 'authenticated 可调 v2');
SELECT is(has_function_privilege('anon',
  'save_note_with_tasks_v2(uuid,jsonb,integer,text,jsonb,jsonb,uuid,jsonb)', 'EXECUTE'),
  false, 'anon 不可调 v2');
SELECT is(has_function_privilege('authenticated',
  'prune_note_versions_for(uuid,uuid)', 'EXECUTE'),
  false, '客户端不可直调「按属主裁剪」的内核（否则等于给别人笔记的版本库装删除按钮）');
SELECT is(has_function_privilege('authenticated',
  'prune_note_versions(uuid)', 'EXECUTE'),
  true, '对外的 prune_note_versions 权限与 056 时代一致');

-- ========== 13. 页面结构不放权 ==========
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('65020000-0000-0000-0000-000000000006', '65000002-0000-0000-0000-000000000002',
   'B自己的笔记', '{"type":"doc","content":[{"type":"paragraph"}]}');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000002-0000-0000-0000-000000000002';  -- B
INSERT INTO rev_watch SELECT 'n1_parent', content_revision FROM public.notes
 WHERE id = '65020000-0000-0000-0000-000000000001';
SELECT throws_ok(
  format('SELECT public.save_note_with_tasks_v2(p_note_id := %L::uuid, p_content := %L::jsonb, '
    || 'p_expected_note_revision := %s, p_note_snapshot := %L::jsonb)',
    '65020000-0000-0000-0000-000000000001',
    '{"type":"doc","content":[{"type":"paragraph"}]}',
    (SELECT v FROM rev_watch WHERE k = 'n1_parent'),
    '{"parent_note_id":"65020000-0000-0000-0000-000000000006"}'),
  'Parent note must belong to the same user',
  'B 不能把 A 的笔记挂到自己树下（validate_note_parent 要求父子同属主）');
RESET ROLE;
SELECT is((SELECT parent_note_id FROM public.notes
           WHERE id = '65020000-0000-0000-0000-000000000001'),
  NULL, '越权移动失败：N1 仍在原处');
SELECT is((SELECT content_revision FROM public.notes
           WHERE id = '65020000-0000-0000-0000-000000000001'),
  (SELECT v FROM rev_watch WHERE k = 'n1_parent'), '整笔回滚，revision 未推进');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '65000001-0000-0000-0000-000000000001';  -- A
INSERT INTO rev_watch SELECT 'n5_parent', content_revision FROM public.notes
 WHERE id = '65020000-0000-0000-0000-000000000005';
SELECT lives_ok(
  format('SELECT public.save_note_with_tasks_v2(p_note_id := %L::uuid, p_content := %L::jsonb, '
    || 'p_expected_note_revision := %s, p_note_snapshot := %L::jsonb)',
    '65020000-0000-0000-0000-000000000005',
    '{"type":"doc","content":[{"type":"paragraph"}]}',
    (SELECT v FROM rev_watch WHERE k = 'n5_parent'),
    '{"parent_note_id":"65020000-0000-0000-0000-000000000002"}'),
  '正向对照：A 把 N5 挂到自己的 N2 下面没问题（上一条不是恒真）');
RESET ROLE;
SELECT is((SELECT parent_note_id FROM public.notes
           WHERE id = '65020000-0000-0000-0000-000000000005'),
  '65020000-0000-0000-0000-000000000002', '属主的层级移动照常生效');
SELECT is((SELECT count(*) FROM public.task_item_refs
           WHERE note_id = '65020000-0000-0000-0000-000000000001'),
  1::bigint, 'N1 的反链仍在（回收只针对本次保存的那篇笔记）');
SELECT is((SELECT user_id FROM public.notes
           WHERE id = '65020000-0000-0000-0000-000000000001'),
  '65000001-0000-0000-0000-000000000001', '全篇结束时 N1 的属主仍是 A（终局校验）');

SELECT * FROM finish();
ROLLBACK;
