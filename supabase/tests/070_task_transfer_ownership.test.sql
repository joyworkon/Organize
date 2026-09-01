-- 070 任务属主移交 transfer_task_ownership pgTAP
--
-- 覆盖（与 070 文件头的拍板一一对应）：
--   1. 结构：EXECUTE 分层（transfer_task_ownership → authenticated/service_role）
--   2. 拒绝矩阵（fail-closed，全部显式报错）：匿名 / 非属主（viewer 的 C、editor 的 B
--      对任务但缺笔记授权）/ 接收人无任务 editor / 接收人对某篇涉及笔记无 editor /
--      自移自 / 接收人不存在 / 任务在垃圾箱 / 涉及笔记在垃圾箱 / 涉及笔记有父页面 /
--      涉及笔记有子页面 / 涉及笔记被集合外任务反向引用 / 依赖边跨界
--   3. 同转 happy path（A → B）：任务 + 后代 + 引用笔记随迁；reminders/attachments/
--      activities/dependencies/task_item_refs 随迁；tags 同名复制复用；根任务脱离
--      父任务与清单；reading_item_id 置空；指向集合外的 note_id / series_id /
--      source_id 置空；评论线程随笔记；favorites / shares 清除；highlights / lessons
--      反向引用解除；task_mutations 删除
--   4. 转移后写路径：B（新属主）v2 保存 ok；A（editor 授权保留）v2 保存 ok
--   5. 反向移交（B → A）：对称可行，tags_copied = 0
--
-- 约定同 068/069：ACL 以 postgres 直插；「先读后调」不放进同一个表达式；
-- throws_ok 断言错误消息全文。
BEGIN;
SELECT plan(55);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('70000000-0000-0000-0000-000000000001', 'p70_a@test', '{"full_name":"A"}'),
    ('70000000-0000-0000-0000-000000000002', 'p70_b@test', '{"full_name":"B"}'),
    ('70000000-0000-0000-0000-000000000003', 'p70_c@test', '{"full_name":"C"}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- W1: A owner + B member；W2: C owner（viewer 走它）
INSERT INTO public.workspaces (id, name, kind, owner_id) VALUES
  ('70010000-0000-0000-0000-000000000001', 'T70-W1', 'team', '70000000-0000-0000-0000-000000000001'),
  ('70010000-0000-0000-0000-000000000002', 'T70-W2', 'team', '70000000-0000-0000-0000-000000000003');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('70010000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'owner'),
  ('70010000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'member'),
  ('70010000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000003', 'owner');

-- 阅读条目（highlights 锚点 + 任务的 reading_item_id 解除验证）
INSERT INTO public.reading_items (id, user_id, url, title) VALUES
  ('70090000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
   'https://example.com/a70', 'A的阅读');

-- 任务清单（验证移交后 list_id → null）
INSERT INTO public.task_lists (id, user_id, name) VALUES
  ('70040000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'A单'),
  ('70040000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 'B单');

-- 笔记：N1 = 移交目标 T1 的引用笔记（随迁）；N2 = 普通笔记（不动）；N3 = 垃圾箱笔记
-- （拒绝矩阵用）；N4 = 有父页面的笔记（拒绝矩阵用）；N5 = 父页面；N6 = 有子页面的
-- 笔记（拒绝矩阵用，N7 是其子）；N7 = N6 的子；N8 = 跨集引用笔记（拒绝矩阵用）；
-- N9 = 接收人访问缺失的笔记（拒绝矩阵用）
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('70020000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
   'A的移交笔记',
   '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"b1","taskId":"70050000-0000-0000-0000-000000000002","checked":false}}]}'),
  ('70020000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001',
   'A的普通笔记', '{"type":"doc","content":[]}'),
  ('70020000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001',
   'A的垃圾箱笔记',
   '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"b3","taskId":"70050000-0000-0000-0000-000000000003","checked":false}}]}'),
  ('70020000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000001',
   'A的有父笔记',
   '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"b4","taskId":"70050000-0000-0000-0000-000000000004","checked":false}}]}'),
  ('70020000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-000000000001',
   'A的父页面', '{"type":"doc","content":[]}'),
  ('70020000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000001',
   'A的有子笔记',
   '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"b6","taskId":"70050000-0000-0000-0000-000000000005","checked":false}}]}'),
  ('70020000-0000-0000-0000-000000000007', '70000000-0000-0000-0000-000000000001',
   'A的子页笔记', '{"type":"doc","content":[]}'),
  ('70020000-0000-0000-0000-000000000008', '70000000-0000-0000-0000-000000000001',
   'A的跨集引用笔记',
   '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"b8","taskId":"70050000-0000-0000-0000-000000000006","checked":false}}]}'),
  ('70020000-0000-0000-0000-000000000009', '70000000-0000-0000-0000-000000000001',
   'A的B无授权笔记',
   '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"b9","taskId":"70050000-0000-0000-0000-000000000007","checked":false}}]}');

UPDATE public.notes SET deleted_at = now()
 WHERE id = '70020000-0000-0000-0000-000000000003';
UPDATE public.notes SET parent_note_id = '70020000-0000-0000-0000-000000000005'
 WHERE id = '70020000-0000-0000-0000-000000000004';
UPDATE public.notes SET parent_note_id = '70020000-0000-0000-0000-000000000006'
 WHERE id = '70020000-0000-0000-0000-000000000007';

-- 任务：T0 = 树根（T1 之父，不随迁）；T1 = 移交目标；T1a = T1 之子（随迁）；
-- T2 = 垃圾箱任务（拒绝矩阵用，被 N3 引用）；T3 = 被有父笔记 N4 引用的任务；
-- T4 = 被有子笔记 N6 引用的任务；T5 = 被跨集引用笔记 N8 引用的任务（同时被外部
-- 任务 T_outside 通过 tasks.note_id 反向引用 N8）；T6 = 被 B 无授权笔记 N9 引用
-- 的任务；T7 → T8 依赖边跨界（拒绝矩阵用）；T9 = 反向引用 N1 的外部任务
INSERT INTO public.tasks (id, user_id, list_id, title, status, note_id, reading_item_id, series_id, source_id) VALUES
  ('70050000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
   '70040000-0000-0000-0000-000000000001', 'A的树根任务', 'todo', null, null, null, null),
  ('70050000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001',
   '70040000-0000-0000-0000-000000000001', 'A的移交任务', 'todo', null,
   '70090000-0000-0000-0000-000000000001', null, null),
  ('70050000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-000000000001',
   '70040000-0000-0000-0000-000000000001', 'A的移交子任务', 'todo', null, null, null, null),
  ('70050000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001',
   '70040000-0000-0000-0000-000000000001', 'A的垃圾箱任务', 'todo', null, null, null, null),
  ('70050000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000001',
   '70040000-0000-0000-0000-000000000001', 'A的有父笔记任务', 'todo', null, null, null, null),
  ('70050000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-000000000001',
   '70040000-0000-0000-0000-000000000001', 'A的有子笔记任务', 'todo', null, null, null, null),
  ('70050000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000001',
   '70040000-0000-0000-0000-000000000001', 'A的跨集引用任务', 'todo', null, null, null, null),
  ('70050000-0000-0000-0000-000000000007', '70000000-0000-0000-0000-000000000001',
   '70040000-0000-0000-0000-000000000001', 'A的B无授权笔记任务', 'todo', null, null, null, null),
  ('70050000-0000-0000-0000-000000000008', '70000000-0000-0000-0000-000000000001',
   '70040000-0000-0000-0000-000000000001', 'A的依赖源任务', 'todo', null, null, null, null),
  ('70050000-0000-0000-0000-000000000009', '70000000-0000-0000-0000-000000000001',
   '70040000-0000-0000-0000-000000000001', 'A的反向引用任务', 'todo',
   '70020000-0000-0000-0000-000000000001', null, null, null);

UPDATE public.tasks SET parent_task_id = '70050000-0000-0000-0000-000000000002'
 WHERE id = '70050000-0000-0000-0000-00000000000a';
UPDATE public.tasks SET deleted_at = now()
 WHERE id = '70050000-0000-0000-0000-000000000003';
-- T1 自指系列（重复任务系列首条）；T1a 的 source_id 指向 T1（集合内保留）
UPDATE public.tasks SET series_id = '70050000-0000-0000-0000-000000000002'
 WHERE id = '70050000-0000-0000-0000-000000000002';
UPDATE public.tasks SET source_id = '70050000-0000-0000-0000-000000000002',
                       series_id = '70050000-0000-0000-0000-000000000002'
 WHERE id = '70050000-0000-0000-0000-00000000000a';

-- task_item_refs：N1→T1（移交集），N3→T2，N4→T3，N6→T4，N8→T5，N9→T6
INSERT INTO public.task_item_refs (user_id, task_id, note_id, block_id) VALUES
  ('70000000-0000-0000-0000-000000000001', '70050000-0000-0000-0000-000000000002',
   '70020000-0000-0000-0000-000000000001', 'b1'),
  ('70000000-0000-0000-0000-000000000001', '70050000-0000-0000-0000-000000000003',
   '70020000-0000-0000-0000-000000000003', 'b3'),
  ('70000000-0000-0000-0000-000000000001', '70050000-0000-0000-0000-000000000004',
   '70020000-0000-0000-0000-000000000004', 'b4'),
  ('70000000-0000-0000-0000-000000000001', '70050000-0000-0000-0000-000000000005',
   '70020000-0000-0000-0000-000000000006', 'b6'),
  ('70000000-0000-0000-0000-000000000001', '70050000-0000-0000-0000-000000000006',
   '70020000-0000-0000-0000-000000000008', 'b8'),
  ('70000000-0000-0000-0000-000000000001', '70050000-0000-0000-0000-000000000007',
   '70020000-0000-0000-0000-000000000009', 'b9');

-- 依赖边：T7 → T8（T7 在集合外，T8 在集合外；后续测试会挪 T8 进集合构造跨界）
INSERT INTO public.task_dependencies (task_id, depends_on_task_id, user_id) VALUES
  ('70050000-0000-0000-0000-000000000008', '70050000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000001');

-- T1 子表：reminders / attachments / activities / mutations（验证随迁）
INSERT INTO public.task_reminders (user_id, task_id, anchor, offset_minutes) VALUES
  ('70000000-0000-0000-0000-000000000001', '70050000-0000-0000-0000-000000000002', 'end', -10);
INSERT INTO public.task_attachments (user_id, task_id, name, path) VALUES
  ('70000000-0000-0000-0000-000000000001', '70050000-0000-0000-0000-000000000002',
   'f.pdf', 'a/f.pdf');
INSERT INTO public.task_activities (user_id, task_id, action) VALUES
  ('70000000-0000-0000-0000-000000000001', '70050000-0000-0000-0000-000000000002', 'created');
INSERT INTO public.task_mutations (user_id, task_id, mutation_id) VALUES
  ('70000000-0000-0000-0000-000000000001', '70050000-0000-0000-0000-000000000002',
   '70080000-0000-0000-0000-000000000001');

-- 标签：G1/G2 挂 T1（G2 是 B 已有同名的复用场景）；G3 挂 N1（验证 note_tags 也复制）；
-- G4 只挂 T0（不动）
INSERT INTO public.tags (id, user_id, name, color) VALUES
  ('70070000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', '私tag', 'red'),
  ('70070000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'deploy', 'blue'),
  ('70070000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000002', 'deploy', 'violet'),
  ('70070000-0000-0000-0000-000000000004', '70000000-0000-0000-0000-000000000001', 'note-tag', 'green'),
  ('70070000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-000000000001', 'solo', 'gray');
INSERT INTO public.task_tags (task_id, tag_id) VALUES
  ('70050000-0000-0000-0000-000000000002', '70070000-0000-0000-0000-000000000001'),
  ('70050000-0000-0000-0000-000000000002', '70070000-0000-0000-0000-000000000002'),
  ('70050000-0000-0000-0000-000000000001', '70070000-0000-0000-0000-000000000005');
INSERT INTO public.note_tags (note_id, tag_id) VALUES
  ('70020000-0000-0000-0000-000000000001', '70070000-0000-0000-0000-000000000004');

-- 评论线程 / 评论 / 建议（验证随笔记随迁）
INSERT INTO public.note_comment_threads (id, user_id, note_id, block_id) VALUES
  ('700a0000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
   '70020000-0000-0000-0000-000000000001', 'b1');
INSERT INTO public.note_comments (user_id, thread_id, body) VALUES
  ('70000000-0000-0000-0000-000000000001', '700a0000-0000-0000-0000-000000000001', 'A的评论');
INSERT INTO public.note_suggestions (user_id, note_id, block_id, original_block, proposed_block) VALUES
  ('70000000-0000-0000-0000-000000000001', '70020000-0000-0000-0000-000000000001', 'b1',
   '{"type":"p"}'::jsonb, '{"type":"p"}'::jsonb);

-- 高亮与经验的反向引用（验证置空）
INSERT INTO public.highlights (id, user_id, reading_item_id, content, note_id, task_id) VALUES
  ('700b0000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
   '70090000-0000-0000-0000-000000000001', 'A的划线',
   '70020000-0000-0000-0000-000000000001', '70050000-0000-0000-0000-000000000002');
INSERT INTO public.lessons (user_id, title, note_id, task_id) VALUES
  ('70000000-0000-0000-0000-000000000001', 'A的经验',
   '70020000-0000-0000-0000-000000000001', '70050000-0000-0000-0000-000000000002');

-- 收藏 / 公开链接（验证删除）
INSERT INTO public.favorites (user_id, target_type, target_id) VALUES
  ('70000000-0000-0000-0000-000000000001', 'task', '70050000-0000-0000-0000-000000000002'),
  ('70000000-0000-0000-0000-000000000001', 'note', '70020000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', 'task', '70050000-0000-0000-0000-000000000002');
INSERT INTO public.shares (owner_id, resource_type, resource_id, token) VALUES
  ('70000000-0000-0000-0000-000000000001', 'note', '70020000-0000-0000-0000-000000000001',
   'tok70');

-- 授权（resource_acl）：T1 对 W1=editor、对 W2=viewer；N1 对 W1=editor（B 可编辑）
-- 其他场景用到时按需补
INSERT INTO public.resource_acl (workspace_id, resource_type, resource_id, access_role, created_by) VALUES
  ('70010000-0000-0000-0000-000000000001', 'task', '70050000-0000-0000-0000-000000000002', 'editor',
   '70000000-0000-0000-0000-000000000001'),
  ('70010000-0000-0000-0000-000000000002', 'task', '70050000-0000-0000-0000-000000000002', 'viewer',
   '70000000-0000-0000-0000-000000000001'),
  ('70010000-0000-0000-0000-000000000001', 'note', '70020000-0000-0000-0000-000000000001', 'editor',
   '70000000-0000-0000-0000-000000000001');

-- ========== 1. 结构：EXECUTE 分层 ==========
SELECT has_function('public', 'transfer_task_ownership', ARRAY['uuid', 'uuid'],
  'transfer_task_ownership 存在');
SELECT function_lang_is('public', 'transfer_task_ownership', ARRAY['uuid', 'uuid'], 'plpgsql',
  'transfer_task_ownership 是 plpgsql');
SELECT is_definer('public', 'transfer_task_ownership', ARRAY['uuid', 'uuid'],
  'transfer_task_ownership 是 security definer');

-- ========== 2. 拒绝矩阵 ==========
-- 2.1 匿名（056 撤销 anon 的 EXECUTE 后，匿名调用直接报 permission denied，不会进函数体）
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000002')$$,
  '42501', 'permission denied for function transfer_task_ownership', '匿名调用拒');
RESET ROLE;

-- 2.2 非属主（B 对任务有 editor，但调用者是 B 且行属主是 A → 拒）
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000002"}', true);
SELECT throws_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000003')$$,
  '42501', 'only the task owner can transfer', '非属主调用拒');
RESET ROLE;

-- 2.3 自移自
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001"}', true);
SELECT throws_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000001')$$,
  '22023', 'new owner must be another user', '自移自拒');
RESET ROLE;

-- 2.4 接收人不存在
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001"}', true);
SELECT throws_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-0000000000ff')$$,
  'P0002', 'new owner not found', '接收人不存在拒');
RESET ROLE;

-- 2.5 接收人对任务无 editor 授权（C 只有 viewer）
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001"}', true);
SELECT throws_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000003')$$,
  '22023', 'recipient must have editor access to this task first', '接收人无任务 editor 拒');
RESET ROLE;

-- 2.6 任务不存在
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001"}', true);
SELECT throws_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-0000000000ff',
    '70000000-0000-0000-0000-000000000002')$$,
  'P0002', 'task not found', '任务不存在拒');
RESET ROLE;

-- 2.7 任务在垃圾箱（T2 在垃圾箱，但被 N3 引用——先恢复 T2 让拒绝归因到垃圾箱状态本身；
-- 但 T2 的垃圾箱笔记 N3 又会触发另一拒绝。直接用 T2 + 一个干净的接收人路径）
-- 补授权：T2 对 W1 = editor，N3 对 W1 = editor（让「接收人无授权」不拦截）
INSERT INTO public.resource_acl (workspace_id, resource_type, resource_id, access_role, created_by) VALUES
  ('70010000-0000-0000-0000-000000000001', 'task', '70050000-0000-0000-0000-000000000003', 'editor',
   '70000000-0000-0000-0000-000000000001'),
  ('70010000-0000-0000-0000-000000000001', 'note', '70020000-0000-0000-0000-000000000003', 'editor',
   '70000000-0000-0000-0000-000000000001');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001"}', true);
SELECT throws_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-000000000003',
    '70000000-0000-0000-0000-000000000002')$$,
  '22023', 'task is in trash; restore it first', '垃圾箱任务拒');
RESET ROLE;

-- 2.8 涉及笔记在垃圾箱（恢复 T2，让 N3 进集合）
UPDATE public.tasks SET deleted_at = null
 WHERE id = '70050000-0000-0000-0000-000000000003';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001"}', true);
SELECT throws_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-000000000003',
    '70000000-0000-0000-0000-000000000002')$$,
  '22023', 'a linked note is in trash; restore it first', '涉及笔记在垃圾箱拒');
RESET ROLE;

-- 还原 T2 垃圾箱状态（后续不再用）
UPDATE public.tasks SET deleted_at = now()
 WHERE id = '70050000-0000-0000-0000-000000000003';

-- 2.9 涉及笔记有父页面（T3 → N4 → N4.parent = N5）
INSERT INTO public.resource_acl (workspace_id, resource_type, resource_id, access_role, created_by) VALUES
  ('70010000-0000-0000-0000-000000000001', 'task', '70050000-0000-0000-0000-000000000004', 'editor',
   '70000000-0000-0000-0000-000000000001'),
  ('70010000-0000-0000-0000-000000000001', 'note', '70020000-0000-0000-0000-000000000004', 'editor',
   '70000000-0000-0000-0000-000000000001');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001"}', true);
SELECT throws_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-000000000004',
    '70000000-0000-0000-0000-000000000002')$$,
  '22023', 'a linked note has a parent page; move it to top level first', '有父页面拒');
RESET ROLE;

-- 2.10 涉及笔记有子页面（T4 → N6，N7 是 N6 的子）
INSERT INTO public.resource_acl (workspace_id, resource_type, resource_id, access_role, created_by) VALUES
  ('70010000-0000-0000-0000-000000000001', 'task', '70050000-0000-0000-0000-000000000005', 'editor',
   '70000000-0000-0000-0000-000000000001'),
  ('70010000-0000-0000-0000-000000000001', 'note', '70020000-0000-0000-0000-000000000006', 'editor',
   '70000000-0000-0000-0000-000000000001');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001"}', true);
SELECT throws_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-000000000005',
    '70000000-0000-0000-0000-000000000002')$$,
  '22023', 'a linked note has child pages; move them out first', '有子页面拒');
RESET ROLE;

-- 2.11 涉及笔记被集合外任务反向引用（T5 → N8；T9.note_id = N8 是集合外）
-- 但 T5 同时被 N8 引用 → 移动集合 = {T5, N8, ...}；T9 是外部任务指向 N8
UPDATE public.tasks SET note_id = '70020000-0000-0000-0000-000000000008'
 WHERE id = '70050000-0000-0000-0000-000000000009';

INSERT INTO public.resource_acl (workspace_id, resource_type, resource_id, access_role, created_by) VALUES
  ('70010000-0000-0000-0000-000000000001', 'task', '70050000-0000-0000-0000-000000000006', 'editor',
   '70000000-0000-0000-0000-000000000001'),
  ('70010000-0000-0000-0000-000000000001', 'note', '70020000-0000-0000-0000-000000000008', 'editor',
   '70000000-0000-0000-0000-000000000001');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001"}', true);
SELECT throws_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-000000000006',
    '70000000-0000-0000-0000-000000000002')$$,
  '22023', 'a linked note is referenced by an outside task; unbind it there first',
  '笔记被外部任务反向引用拒');
RESET ROLE;

-- 2.12 接收人对某篇涉及笔记无 editor（T6 → N9，N9 只授权给 W2 = viewer）
INSERT INTO public.resource_acl (workspace_id, resource_type, resource_id, access_role, created_by) VALUES
  ('70010000-0000-0000-0000-000000000001', 'task', '70050000-0000-0000-0000-000000000007', 'editor',
   '70000000-0000-0000-0000-000000000001'),
  ('70010000-0000-0000-0000-000000000002', 'note', '70020000-0000-0000-0000-000000000009', 'viewer',
   '70000000-0000-0000-0000-000000000001');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001"}', true);
SELECT throws_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-000000000007',
    '70000000-0000-0000-0000-000000000002')$$,
  '22023', 'recipient must have editor access to every linked note first',
  '接收人对涉及笔记无 editor 拒');
RESET ROLE;

-- 2.13 依赖边跨界（T8 依赖 T0；把 T8 拉进集合——给 T8 一个引用笔记 N10 + 授权，
-- T0 留在集合外）
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('70020000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-000000000001',
   'A的依赖笔记',
   '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"ba","taskId":"70050000-0000-0000-0000-000000000008","checked":false}}]}');
INSERT INTO public.task_item_refs (user_id, task_id, note_id, block_id) VALUES
  ('70000000-0000-0000-0000-000000000001', '70050000-0000-0000-0000-000000000008',
   '70020000-0000-0000-0000-00000000000a', 'ba');
INSERT INTO public.resource_acl (workspace_id, resource_type, resource_id, access_role, created_by) VALUES
  ('70010000-0000-0000-0000-000000000001', 'task', '70050000-0000-0000-0000-000000000008', 'editor',
   '70000000-0000-0000-0000-000000000001'),
  ('70010000-0000-0000-0000-000000000001', 'note', '70020000-0000-0000-0000-00000000000a', 'editor',
   '70000000-0000-0000-0000-000000000001');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001"}', true);
SELECT throws_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-000000000008',
    '70000000-0000-0000-0000-000000000002')$$,
  '22023', 'a task dependency crosses the transfer boundary; remove it first',
  '依赖边跨界拒');
RESET ROLE;

-- ========== 3. 同转 happy path（A → B）==========
-- 目标：T1（含子任务 T1a）+ 引用它的笔记 N1；两侧授权已就位
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001"}', true);
SELECT lives_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000002')$$,
  'A → B 移交成功');
RESET ROLE;

-- 3.1 任务行易主
SELECT is(
  (SELECT user_id FROM public.tasks WHERE id = '70050000-0000-0000-0000-000000000002'),
  '70000000-0000-0000-0000-000000000002'::uuid,
  'T1 易主到 B');
SELECT is(
  (SELECT user_id FROM public.tasks WHERE id = '70050000-0000-0000-0000-00000000000a'),
  '70000000-0000-0000-0000-000000000002'::uuid,
  'T1a 随迁');

-- 3.2 笔记行易主
SELECT is(
  (SELECT user_id FROM public.notes WHERE id = '70020000-0000-0000-0000-000000000001'),
  '70000000-0000-0000-0000-000000000002'::uuid,
  'N1 随迁');

-- 3.3 挂载点清理
SELECT is(
  (SELECT list_id FROM public.tasks WHERE id = '70050000-0000-0000-0000-000000000002'),
  null::uuid,
  'T1 脱离 A 的清单');
SELECT is(
  (SELECT reading_item_id FROM public.tasks WHERE id = '70050000-0000-0000-0000-000000000002'),
  null::uuid,
  'T1 脱离阅读条目');

-- 3.4 系列/来源：T1 自指保留；T1a.source_id 指向 T1 集合内保留；T1a.series_id 指向 T1 集合内保留
SELECT is(
  (SELECT series_id FROM public.tasks WHERE id = '70050000-0000-0000-0000-000000000002'),
  '70050000-0000-0000-0000-000000000002'::uuid,
  'T1 系列首条自指保留');
SELECT is(
  (SELECT source_id FROM public.tasks WHERE id = '70050000-0000-0000-0000-00000000000a'),
  '70050000-0000-0000-0000-000000000002'::uuid,
  'T1a.source_id 集合内保留');

-- 3.5 子任务父子关系随迁
SELECT is(
  (SELECT parent_task_id FROM public.tasks WHERE id = '70050000-0000-0000-0000-00000000000a'),
  '70050000-0000-0000-0000-000000000002'::uuid,
  'T1a 父子关系随迁');

-- 3.6 子表随迁
SELECT is(
  (SELECT user_id FROM public.task_reminders WHERE task_id = '70050000-0000-0000-0000-000000000002'),
  '70000000-0000-0000-0000-000000000002'::uuid,
  'reminder 随迁');
SELECT is(
  (SELECT user_id FROM public.task_attachments WHERE task_id = '70050000-0000-0000-0000-000000000002'),
  '70000000-0000-0000-0000-000000000002'::uuid,
  'attachment 随迁');
SELECT is(
  (SELECT count(*) FROM public.task_activities
    WHERE task_id = '70050000-0000-0000-0000-000000000002'
      AND user_id = '70000000-0000-0000-0000-000000000002'),
  (SELECT count(*) FROM public.task_activities
    WHERE task_id = '70050000-0000-0000-0000-000000000002'),
  'activity 随迁（全部行易主）');
SELECT is(
  (SELECT count(*) FROM public.task_mutations WHERE task_id = '70050000-0000-0000-0000-000000000002'),
  0::bigint,
  'task_mutations 删除');

-- 3.7 task_item_refs 随迁
SELECT is(
  (SELECT user_id FROM public.task_item_refs
    WHERE task_id = '70050000-0000-0000-0000-000000000002'
      AND note_id = '70020000-0000-0000-0000-000000000001'),
  '70000000-0000-0000-0000-000000000002'::uuid,
  'task_item_refs 随迁');

-- 3.8 标签复制 + 关联重指向（deploy 复用 B 已有）
SELECT is(
  (SELECT count(*) FROM public.tags
    WHERE user_id = '70000000-0000-0000-0000-000000000002' AND name = '私tag'),
  1::bigint,
  '私tag 已复制到 B 名下');
SELECT is(
  (SELECT count(*) FROM public.tags
    WHERE user_id = '70000000-0000-0000-0000-000000000002' AND name = 'deploy'),
  1::bigint,
  'deploy 复用 B 已有（不重复复制）');
SELECT is(
  (SELECT count(*) FROM public.tags
    WHERE user_id = '70000000-0000-0000-0000-000000000002' AND name = 'note-tag'),
  1::bigint,
  'note-tag 已复制到 B 名下');
SELECT is(
  (SELECT tag_id FROM public.task_tags
    WHERE task_id = '70050000-0000-0000-0000-000000000002'
      AND tag_id IN (SELECT id FROM public.tags WHERE user_id = '70000000-0000-0000-0000-000000000002' AND name = '私tag')),
  (SELECT id FROM public.tags WHERE user_id = '70000000-0000-0000-0000-000000000002' AND name = '私tag'),
  'task_tags 重指向 B 名下私tag');
SELECT is(
  (SELECT count(*) FROM public.note_tags nt
    JOIN public.tags t ON t.id = nt.tag_id
    WHERE nt.note_id = '70020000-0000-0000-0000-000000000001'
      AND t.user_id = '70000000-0000-0000-0000-000000000002'),
  1::bigint,
  'note_tags 重指向 B 名下标签');

-- 3.9 评论线程 / 评论 / 建议随迁
SELECT is(
  (SELECT user_id FROM public.note_comment_threads WHERE note_id = '70020000-0000-0000-0000-000000000001'),
  '70000000-0000-0000-0000-000000000002'::uuid,
  '评论线程随迁');
SELECT is(
  (SELECT user_id FROM public.note_comments WHERE thread_id = '700a0000-0000-0000-0000-000000000001'),
  '70000000-0000-0000-0000-000000000002'::uuid,
  '评论随迁');
SELECT is(
  (SELECT user_id FROM public.note_suggestions WHERE note_id = '70020000-0000-0000-0000-000000000001'),
  '70000000-0000-0000-0000-000000000002'::uuid,
  '建议随迁');

-- 3.10 反向引用清理
SELECT is(
  (SELECT note_id FROM public.highlights WHERE id = '700b0000-0000-0000-0000-000000000001'),
  null::uuid,
  'A 的高亮 note_id 置空');
SELECT is(
  (SELECT task_id FROM public.highlights WHERE id = '700b0000-0000-0000-0000-000000000001'),
  null::uuid,
  'A 的高亮 task_id 置空');
SELECT is(
  (SELECT note_id FROM public.lessons WHERE title = 'A的经验'),
  null::uuid,
  'A 的经验 note_id 置空');
SELECT is(
  (SELECT task_id FROM public.lessons WHERE title = 'A的经验'),
  null::uuid,
  'A 的经验 task_id 置空');
-- T9 反向引用 N8（不在移交集合内）：保持原状不动
SELECT is(
  (SELECT note_id FROM public.tasks WHERE id = '70050000-0000-0000-0000-000000000009'),
  '70020000-0000-0000-0000-000000000008'::uuid,
  'T9 反向引用集合外笔记 N8 保持原状');

-- 3.11 favorites / shares 清除（B 自己的 favorite 保留）
SELECT is(
  (SELECT count(*) FROM public.favorites
    WHERE user_id = '70000000-0000-0000-0000-000000000001'
      AND ((target_type = 'task' AND target_id = '70050000-0000-0000-0000-000000000002')
       OR (target_type = 'note' AND target_id = '70020000-0000-0000-0000-000000000001'))),
  0::bigint,
  'A 的 favorites 清除');
SELECT is(
  (SELECT count(*) FROM public.favorites
    WHERE user_id = '70000000-0000-0000-0000-000000000002'
      AND target_type = 'task' AND target_id = '70050000-0000-0000-0000-000000000002'),
  1::bigint,
  'B 的 favorites 保留');
SELECT is(
  (SELECT count(*) FROM public.shares WHERE resource_id = '70020000-0000-0000-0000-000000000001'),
  0::bigint,
  '公开链接清除');

-- 3.12 集合外不受影响
SELECT is(
  (SELECT user_id FROM public.tasks WHERE id = '70050000-0000-0000-0000-000000000001'),
  '70000000-0000-0000-0000-000000000001'::uuid,
  'T0 不动');
SELECT is(
  (SELECT user_id FROM public.notes WHERE id = '70020000-0000-0000-0000-000000000002'),
  '70000000-0000-0000-0000-000000000001'::uuid,
  'N2 不动');

-- 3.13 依赖边（T8 → T0）两端都在集合外，不动
SELECT is(
  (SELECT user_id FROM public.task_dependencies
    WHERE task_id = '70050000-0000-0000-0000-000000000008'),
  '70000000-0000-0000-0000-000000000001'::uuid,
  '外部依赖边不动');

-- ========== 4. 转移后写路径 ==========
-- 4.1 B（新属主）v2 保存 ok（保留 taskItem 块——保存 RPC 会重建 task_item_refs，
-- 空 content 会把 N1→T1 的引用清掉，反向移交的闭包就找不到 N1）
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000002"}', true);
SELECT lives_ok(
  $$SELECT public.save_note_with_tasks_v2(
    '70020000-0000-0000-0000-000000000001',
    '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"b1","taskId":"70050000-0000-0000-0000-000000000002","checked":false}}]}'::jsonb,
    null, 'A的移交笔记', null, null, null, null)$$,
  'B（新属主）v2 保存 ok');
RESET ROLE;

-- 4.2 A（editor 授权保留）v2 保存 ok
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001"}', true);
SELECT lives_ok(
  $$SELECT public.save_note_with_tasks_v2(
    '70020000-0000-0000-0000-000000000001',
    '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"b1","taskId":"70050000-0000-0000-0000-000000000002","checked":false}}]}'::jsonb,
    null, 'A的移交笔记', null, null, null, null)$$,
  'A（editor 保留）v2 保存 ok');
RESET ROLE;

-- ========== 5. 反向移交（B → A）==========
-- B 把 T1 移交回 A：需要 A 对 T1 与 N1 都有 editor。当前 A 对 N1 是 editor（ACL 未动），
-- 对 T1 是 editor（ACL 未动）。B 是行属主，发起移交。
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000002"}', true);
SELECT lives_ok(
  $$SELECT public.transfer_task_ownership('70050000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000001')$$,
  'B → A 反向移交成功');
RESET ROLE;

SELECT is(
  (SELECT user_id FROM public.tasks WHERE id = '70050000-0000-0000-0000-000000000002'),
  '70000000-0000-0000-0000-000000000001'::uuid,
  'T1 回到 A');
SELECT is(
  (SELECT user_id FROM public.notes WHERE id = '70020000-0000-0000-0000-000000000001'),
  '70000000-0000-0000-0000-000000000001'::uuid,
  'N1 回到 A');

-- 反向移交时 tags_copied = 0（A 名下私tag/deploy/note-tag 都还在）
SELECT is(
  (SELECT count(*) FROM public.tags
    WHERE user_id = '70000000-0000-0000-0000-000000000001' AND name = '私tag'),
  1::bigint,
  'A 的私tag 原样保留');

SELECT * FROM finish();
ROLLBACK;
