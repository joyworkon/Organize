-- 068 笔记属主移交 transfer_note_ownership pgTAP
--
-- 覆盖（与 068 文件头的拍板一一对应）：
--   1. 结构：EXECUTE 分层（transfer_note_ownership → authenticated/service_role；
--      resource_role_for → 仅 service_role）+ resource_role 委托后判定链语义不变
--   2. 拒绝矩阵（fail-closed，全部显式报错）：匿名 / 非属主（含 editor 的 B）/
--      接收人无 editor 授权（viewer 的 C）/ 有父页面 / 有子页面 / 垃圾箱 /
--      跨笔记引用任务 / 依赖边跨界
--   3. 同转 happy path（A → B）：笔记 + 引用任务 + 子任务 + reminders/attachments/
--      activities/dependencies 随迁；根任务脱离父任务与清单；评论/建议随迁；
--      标签同名复制与复用；lessons/highlights/tasks 反向引用解除；favorites/shares
--      清除；ydoc 之外的所有 056 复合外键在同租户意义上保持一致
--   4. 转移后保存链：B（新属主）v2 保存 ok——「断链会让新属主保存必炸」是同转语义
--      的根据，这里钉住；A 以 editor 身份仍可保存（resource_acl 保留）；viewer 仍拒
--   5. 反向移交（B → A）：对称可行，标签复用不重复（tags_copied = 0）
--
-- 约定同 063/064/065/066：ACL 以 postgres 直插；「先读后调」不放进同一个表达式；
-- throws_ok 断言错误消息全文。
BEGIN;
SELECT plan(64);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('68000000-0000-0000-0000-000000000001', 'p68_a@test', '{"full_name":"A"}'),
    ('68000000-0000-0000-0000-000000000002', 'p68_b@test', '{"full_name":"B"}'),
    ('68000000-0000-0000-0000-000000000003', 'p68_c@test', '{"full_name":"C"}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- W1: A owner + B member（N1 的 editor 授权走它）；W2: C owner（viewer 授权走它）
INSERT INTO public.workspaces (id, name, kind, owner_id) VALUES
  ('68010000-0000-0000-0000-000000000001', 'T68-W1', 'team', '68000000-0000-0000-0000-000000000001'),
  ('68010000-0000-0000-0000-000000000002', 'T68-W2', 'team', '68000000-0000-0000-0000-000000000003');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('68010000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001', 'owner'),
  ('68010000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000002', 'member'),
  ('68010000-0000-0000-0000-000000000002', '68000000-0000-0000-0000-000000000003', 'owner');

-- 阅读条目（highlights 的必挂锚点）
INSERT INTO public.reading_items (id, user_id, url, title) VALUES
  ('68090000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001',
   'https://example.com/a68', 'A的阅读');

-- 笔记（N1 = 移交目标；N2/N5 共引 T3 构造跨笔记引用；N3/N4 构造父子；N6 垃圾箱；N7 依赖跨界）
INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('68020000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001',
   'A的移交笔记',
   '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"b1","taskId":"68050000-0000-0000-0000-000000000002","checked":false}}]}'),
  ('68020000-0000-0000-0000-000000000002', '68000000-0000-0000-0000-000000000001',
   'A的普通笔记2',
   '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"b1","taskId":"68050000-0000-0000-0000-000000000004","checked":false}}]}'),
  ('68020000-0000-0000-0000-000000000003', '68000000-0000-0000-0000-000000000001',
   'A的子页面', '{"type":"doc","content":[]}'),
  ('68020000-0000-0000-0000-000000000004', '68000000-0000-0000-0000-000000000001',
   'A的父页面', '{"type":"doc","content":[]}'),
  ('68020000-0000-0000-0000-000000000005', '68000000-0000-0000-0000-000000000001',
   'A的跨界引用页',
   '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"b2","taskId":"68050000-0000-0000-0000-000000000004","checked":false}}]}'),
  ('68020000-0000-0000-0000-000000000006', '68000000-0000-0000-0000-000000000001',
   'A的垃圾箱笔记', '{"type":"doc","content":[]}'),
  ('68020000-0000-0000-0000-000000000007', '68000000-0000-0000-0000-000000000001',
   'A的依赖页',
   '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"b1","taskId":"68050000-0000-0000-0000-000000000005","checked":false}}]}');
UPDATE public.notes SET parent_note_id = '68020000-0000-0000-0000-000000000004'
 WHERE id = '68020000-0000-0000-0000-000000000003';
UPDATE public.notes SET deleted_at = now()
 WHERE id = '68020000-0000-0000-0000-000000000006';

-- N1 对 W1 = editor（B 可编辑）、对 W2 = viewer（C 只读）；
-- N3/N4/N5/N7 也对 W1 = editor：让拒绝矩阵越过「接收人资格」落到各自目标拒绝上
INSERT INTO public.resource_acl (workspace_id, resource_type, resource_id, access_role, created_by) VALUES
  ('68010000-0000-0000-0000-000000000001', 'note', '68020000-0000-0000-0000-000000000001', 'editor',
   '68000000-0000-0000-0000-000000000001'),
  ('68010000-0000-0000-0000-000000000001', 'note', '68020000-0000-0000-0000-000000000003', 'editor',
   '68000000-0000-0000-0000-000000000001'),
  ('68010000-0000-0000-0000-000000000001', 'note', '68020000-0000-0000-0000-000000000004', 'editor',
   '68000000-0000-0000-0000-000000000001'),
  ('68010000-0000-0000-0000-000000000001', 'note', '68020000-0000-0000-0000-000000000005', 'editor',
   '68000000-0000-0000-0000-000000000001'),
  ('68010000-0000-0000-0000-000000000001', 'note', '68020000-0000-0000-0000-000000000007', 'editor',
   '68000000-0000-0000-0000-000000000001'),
  ('68010000-0000-0000-0000-000000000002', 'note', '68020000-0000-0000-0000-000000000001', 'viewer',
   '68000000-0000-0000-0000-000000000001');

-- 任务清单与任务（T0 = T1 的父、不随迁；T1/T1a 随迁；T3 跨笔记引用；T4→T5 依赖跨界；T9 详情关联）
INSERT INTO public.task_lists (id, user_id, name) VALUES
  ('68040000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001', 'A单'),
  ('68040000-0000-0000-0000-000000000002', '68000000-0000-0000-0000-000000000002', 'B单');
INSERT INTO public.tasks (id, user_id, list_id, title, status, reference_managed) VALUES
  ('68050000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001',
   '68040000-0000-0000-0000-000000000001', 'A的树根任务', 'todo', false),
  ('68050000-0000-0000-0000-000000000002', '68000000-0000-0000-0000-000000000001',
   '68040000-0000-0000-0000-000000000001', 'A的内联任务', 'todo', true),
  ('68050000-0000-0000-0000-000000000003', '68000000-0000-0000-0000-000000000001',
   '68040000-0000-0000-0000-000000000001', 'A的子任务', 'todo', true),
  ('68050000-0000-0000-0000-000000000004', '68000000-0000-0000-0000-000000000001',
   '68040000-0000-0000-0000-000000000001', 'A的跨笔记任务', 'todo', true),
  ('68050000-0000-0000-0000-000000000005', '68000000-0000-0000-0000-000000000001',
   '68040000-0000-0000-0000-000000000001', 'A的依赖任务', 'todo', true),
  ('68050000-0000-0000-0000-000000000006', '68000000-0000-0000-0000-000000000001',
   '68040000-0000-0000-0000-000000000001', 'A的前置任务', 'todo', false),
  ('68050000-0000-0000-0000-000000000007', '68000000-0000-0000-0000-000000000001',
   '68040000-0000-0000-0000-000000000001', 'A的详情关联任务', 'todo', false);
UPDATE public.tasks SET parent_task_id = '68050000-0000-0000-0000-000000000001'
 WHERE id = '68050000-0000-0000-0000-000000000002';
UPDATE public.tasks SET parent_task_id = '68050000-0000-0000-0000-000000000002'
 WHERE id = '68050000-0000-0000-0000-000000000003';
UPDATE public.tasks SET note_id = '68020000-0000-0000-0000-000000000001'
 WHERE id = '68050000-0000-0000-0000-000000000002';
UPDATE public.tasks SET note_id = '68020000-0000-0000-0000-000000000001'
 WHERE id = '68050000-0000-0000-0000-000000000007';

-- 任务子资源（随迁组）+ 依赖 + 幂等日志
INSERT INTO public.task_reminders (id, user_id, task_id, anchor, offset_minutes) VALUES
  ('68060000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001',
   '68050000-0000-0000-0000-000000000002', 'start', -30);
INSERT INTO public.task_attachments (id, user_id, task_id, name, path) VALUES
  ('68060000-0000-0000-0000-000000000002', '68000000-0000-0000-0000-000000000001',
   '68050000-0000-0000-0000-000000000002', '附件.pdf', '68/att.pdf');
INSERT INTO public.task_checklists (id, task_id, content) VALUES
  ('68060000-0000-0000-0000-000000000003', '68050000-0000-0000-0000-000000000002', '清单项');
INSERT INTO public.task_activities (id, user_id, task_id, action) VALUES
  ('68060000-0000-0000-0000-000000000004', '68000000-0000-0000-0000-000000000001',
   '68050000-0000-0000-0000-000000000002', 'created');
INSERT INTO public.task_dependencies (task_id, depends_on_task_id, user_id) VALUES
  ('68050000-0000-0000-0000-000000000002', '68050000-0000-0000-0000-000000000003',
   '68000000-0000-0000-0000-000000000001'),
  ('68050000-0000-0000-0000-000000000005', '68050000-0000-0000-0000-000000000006',
   '68000000-0000-0000-0000-000000000001');
INSERT INTO public.task_mutations (user_id, mutation_id, task_id) VALUES
  ('68000000-0000-0000-0000-000000000001', '68060000-0000-0000-0000-000000000099',
   '68050000-0000-0000-0000-000000000002');

-- 任务↔笔记引用（与各笔记 content 里的 taskItem 对齐）
INSERT INTO public.task_item_refs (user_id, task_id, note_id, block_id) VALUES
  ('68000000-0000-0000-0000-000000000001', '68050000-0000-0000-0000-000000000002',
   '68020000-0000-0000-0000-000000000001', 'b1'),
  ('68000000-0000-0000-0000-000000000001', '68050000-0000-0000-0000-000000000004',
   '68020000-0000-0000-0000-000000000002', 'b1'),
  ('68000000-0000-0000-0000-000000000001', '68050000-0000-0000-0000-000000000004',
   '68020000-0000-0000-0000-000000000005', 'b2'),
  ('68000000-0000-0000-0000-000000000001', '68050000-0000-0000-0000-000000000005',
   '68020000-0000-0000-0000-000000000007', 'b1');

-- 标签：G1 只挂任务（复制场景）；G2 挂笔记（复用场景——B 已有同名 deploy）
INSERT INTO public.tags (id, user_id, name, color) VALUES
  ('68070000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001', '私tag', 'red'),
  ('68070000-0000-0000-0000-000000000002', '68000000-0000-0000-0000-000000000001', 'deploy', 'blue'),
  ('68070000-0000-0000-0000-000000000003', '68000000-0000-0000-0000-000000000002', 'deploy', 'violet');
INSERT INTO public.task_tags (task_id, tag_id) VALUES
  ('68050000-0000-0000-0000-000000000002', '68070000-0000-0000-0000-000000000001');
INSERT INTO public.note_tags (note_id, tag_id) VALUES
  ('68020000-0000-0000-0000-000000000001', '68070000-0000-0000-0000-000000000002');

-- 评论线程 / 评论 / 建议（随迁组）
INSERT INTO public.note_comment_threads (id, note_id, block_id, user_id) VALUES
  ('680a0000-0000-0000-0000-000000000001', '68020000-0000-0000-0000-000000000001', 'b1',
   '68000000-0000-0000-0000-000000000001');
INSERT INTO public.note_comments (id, thread_id, user_id, body) VALUES
  ('680a0000-0000-0000-0000-000000000002', '680a0000-0000-0000-0000-000000000001',
   '68000000-0000-0000-0000-000000000001', '甲评论');
INSERT INTO public.note_suggestions (id, note_id, block_id, user_id, original_block, proposed_block) VALUES
  ('680a0000-0000-0000-0000-000000000003', '68020000-0000-0000-0000-000000000001', 'b1',
   '68000000-0000-0000-0000-000000000001',
   '{"type":"paragraph"}', '{"type":"heading","attrs":{"level":2}}');

-- 反向引用组：经验 / 高亮 / 收藏 / 公开分享 / 页面数据库
INSERT INTO public.lessons (id, user_id, title, task_id, note_id) VALUES
  ('680b0000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001', 'A的经验',
   '68050000-0000-0000-0000-000000000002', '68020000-0000-0000-0000-000000000001');
INSERT INTO public.highlights (id, user_id, reading_item_id, content, note_id, task_id) VALUES
  ('680b0000-0000-0000-0000-000000000002', '68000000-0000-0000-0000-000000000001',
   '68090000-0000-0000-0000-000000000001', '划线句子',
   '68020000-0000-0000-0000-000000000001', '68050000-0000-0000-0000-000000000002');
INSERT INTO public.favorites (id, user_id, target_type, target_id) VALUES
  ('680b0000-0000-0000-0000-000000000003', '68000000-0000-0000-0000-000000000001', 'note',
   '68020000-0000-0000-0000-000000000001');
INSERT INTO public.shares (id, owner_id, resource_type, resource_id, token) VALUES
  ('680b0000-0000-0000-0000-000000000004', '68000000-0000-0000-0000-000000000001', 'note',
   '68020000-0000-0000-0000-000000000001', 'tok68n1');
INSERT INTO public.db_databases (id, user_id, parent_note_id) VALUES
  ('680b0000-0000-0000-0000-000000000005', '68000000-0000-0000-0000-000000000001',
   '68020000-0000-0000-0000-000000000001');

-- ========== 1. 结构与 EXECUTE 分层 ==========
SELECT is(has_function_privilege('anon', 'transfer_note_ownership(uuid,uuid)', 'EXECUTE'), false,
  'transfer_note_ownership 对 anon 无 EXECUTE');
SELECT is(has_function_privilege('authenticated', 'transfer_note_ownership(uuid,uuid)', 'EXECUTE'), true,
  'transfer_note_ownership 对 authenticated 有 EXECUTE');
SELECT is(has_function_privilege('service_role', 'transfer_note_ownership(uuid,uuid)', 'EXECUTE'), true,
  'transfer_note_ownership 对 service_role 有 EXECUTE');
SELECT is(has_function_privilege('anon', 'resource_role_for(text,uuid,uuid)', 'EXECUTE'), false,
  'resource_role_for 对 anon 无 EXECUTE');
SELECT is(has_function_privilege('authenticated', 'resource_role_for(text,uuid,uuid)', 'EXECUTE'), false,
  'resource_role_for 对 authenticated 无 EXECUTE（防授权探测 oracle）');
SELECT is(has_function_privilege('service_role', 'resource_role_for(text,uuid,uuid)', 'EXECUTE'), true,
  'resource_role_for 对 service_role 有 EXECUTE');

-- ========== 2. 判定链委托后语义不变 ==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '68000000-0000-0000-0000-000000000001';  -- A
SELECT is(public.resource_role('note', '68020000-0000-0000-0000-000000000001'), 'owner',
  '属主 A 经委托后的 resource_role 仍是 owner');
SET request.jwt.claim.sub TO '68000000-0000-0000-0000-000000000002';  -- B
SELECT is(public.resource_role('note', '68020000-0000-0000-0000-000000000001'), 'editor',
  'B（W1 成员 + editor 授权）经委托后仍是 editor');
RESET ROLE;

-- ========== 3. 匿名拒绝 ==========
SET ROLE authenticated;
RESET request.jwt.claim.sub;
SELECT throws_ok(
  $$SELECT public.transfer_note_ownership(
       '68020000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000002')$$,
  'anonymous', '匿名（auth.uid() 为空）拒绝');
RESET ROLE;

-- ========== 4. 非属主拒绝（含持有 editor 的 B）==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '68000000-0000-0000-0000-000000000003';  -- C（旁观者）
SELECT throws_ok(
  $$SELECT public.transfer_note_ownership(
       '68020000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000002')$$,
  'only the note owner can transfer', '无任何角色的 C 不能移交他人笔记');
SET request.jwt.claim.sub TO '68000000-0000-0000-0000-000000000002';  -- B（editor）
SELECT throws_ok(
  $$SELECT public.transfer_note_ownership(
       '68020000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000001')$$,
  'only the note owner can transfer', 'editor 的 B 也不能移交（移交是属主专属动作）');
RESET ROLE;

-- ========== 5. 接收人资格：viewer 不够（先共享可编辑，才能移交）==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '68000000-0000-0000-0000-000000000001';  -- A
SELECT throws_ok(
  $$SELECT public.transfer_note_ownership(
       '68020000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000003')$$,
  'recipient must have editor access to this note first',
  '接收人只有 viewer 授权时拒绝');

-- ========== 6. 页面结构：有父 / 有子都拒绝 ==========
SELECT throws_ok(
  $$SELECT public.transfer_note_ownership(
       '68020000-0000-0000-0000-000000000003', '68000000-0000-0000-0000-000000000002')$$,
  'note has a parent page; move it to top level first', '有父页面的笔记拒绝');
SELECT throws_ok(
  $$SELECT public.transfer_note_ownership(
       '68020000-0000-0000-0000-000000000004', '68000000-0000-0000-0000-000000000002')$$,
  'note has child pages; move them out first', '有子页面的笔记拒绝');

-- ========== 7. 垃圾箱拒绝 ==========
SELECT throws_ok(
  $$SELECT public.transfer_note_ownership(
       '68020000-0000-0000-0000-000000000006', '68000000-0000-0000-0000-000000000002')$$,
  'note is in trash; restore it first', '垃圾箱里的笔记拒绝移交');

-- ========== 8. 跨笔记引用拒绝（N5 的 T3 还被 N2 引用）==========
SELECT throws_ok(
  $$SELECT public.transfer_note_ownership(
       '68020000-0000-0000-0000-000000000005', '68000000-0000-0000-0000-000000000002')$$,
  'a linked task is also referenced by another note; unbind it there first',
  '链接任务被其他笔记引用时拒绝');

-- ========== 9. 依赖跨界拒绝（N7 的 T4 依赖未随迁的 T5）==========
SELECT throws_ok(
  $$SELECT public.transfer_note_ownership(
       '68020000-0000-0000-0000-000000000007', '68000000-0000-0000-0000-000000000002')$$,
  'a task dependency crosses the transfer boundary; remove it first',
  '依赖边跨越移动边界时拒绝');

-- ========== 10. happy path：A 把 N1 移交给 B ==========
SELECT is((public.transfer_note_ownership(
    p_note_id := '68020000-0000-0000-0000-000000000001',
    p_new_owner := '68000000-0000-0000-0000-000000000002'))->>'status',
  'ok', '属主 A 移交 N1 给 editor 的 B 成功');
RESET ROLE;

SELECT is((SELECT user_id::text FROM public.notes
    WHERE id = '68020000-0000-0000-0000-000000000001'),
  '68000000-0000-0000-0000-000000000002', '笔记行属主变为 B');
SELECT is((SELECT title FROM public.notes WHERE id = '68020000-0000-0000-0000-000000000001'),
  'A的移交笔记', '标题不变');
SELECT is((SELECT content_revision FROM public.notes
    WHERE id = '68020000-0000-0000-0000-000000000001'), 0,
  'content_revision 不变（移交不是内容编辑）');
SELECT is((SELECT last_edit_by::text FROM public.notes
    WHERE id = '68020000-0000-0000-0000-000000000001'), NULL,
  'last_edit_by 不写（066 合同：它只回答「谁编辑了内容」）');
SELECT is((SELECT reading_item_id::text FROM public.notes
    WHERE id = '68020000-0000-0000-0000-000000000001'), NULL,
  '笔记的 reading_item_id 解除（reading_items 域不随迁，不留悬空引用）');

-- 任务随迁：T1/T1a → B；根任务 T1 脱离 T0 与清单；子任务保持父子
SELECT is((SELECT user_id::text FROM public.tasks WHERE id = '68050000-0000-0000-0000-000000000002'),
  '68000000-0000-0000-0000-000000000002', '引用任务 T1 随迁到 B');
SELECT is((SELECT parent_task_id::text FROM public.tasks WHERE id = '68050000-0000-0000-0000-000000000002'),
  NULL, '根任务 T1 脱离原父任务 T0（层级复合外键要求同租户，不放大移交面）');
SELECT is((SELECT list_id::text FROM public.tasks WHERE id = '68050000-0000-0000-0000-000000000002'),
  NULL, 'T1 脱离旧属主的清单');
SELECT is((SELECT user_id::text FROM public.tasks WHERE id = '68050000-0000-0000-0000-000000000003'),
  '68000000-0000-0000-0000-000000000002', '子任务 T1a 随迁到 B');
SELECT is((SELECT parent_task_id::text FROM public.tasks WHERE id = '68050000-0000-0000-0000-000000000003'),
  '68050000-0000-0000-0000-000000000002', '子任务保持父子关系');
SELECT is((SELECT user_id::text FROM public.tasks WHERE id = '68050000-0000-0000-0000-000000000001'),
  '68000000-0000-0000-0000-000000000001', '未引用的树根 T0 仍属 A（不跟随）');
SELECT is((SELECT note_id::text FROM public.tasks WHERE id = '68050000-0000-0000-0000-000000000002'),
  '68020000-0000-0000-0000-000000000001', 'T1 的详情关联指向本笔记，随迁保留');
SELECT is((SELECT note_id::text FROM public.tasks WHERE id = '68050000-0000-0000-0000-000000000007'),
  NULL, '非移动任务 T9 的详情关联解除');

-- 任务子资源随迁
SELECT is((SELECT user_id::text FROM public.task_reminders
    WHERE id = '68060000-0000-0000-0000-000000000001'),
  '68000000-0000-0000-0000-000000000002', '提醒随迁');
SELECT is((SELECT user_id::text FROM public.task_attachments
    WHERE id = '68060000-0000-0000-0000-000000000002'),
  '68000000-0000-0000-0000-000000000002', '附件元数据随迁');
SELECT is((SELECT user_id::text FROM public.task_activities
    WHERE id = '68060000-0000-0000-0000-000000000004'),
  '68000000-0000-0000-0000-000000000002', '动态随迁');
SELECT is((SELECT count(*)::int FROM public.task_checklists
    WHERE task_id = '68050000-0000-0000-0000-000000000002'), 1,
  '清单项跟随任务（无 user_id 列，经父表 RLS 收口）');
SELECT is((SELECT user_id::text FROM public.task_dependencies
    WHERE task_id = '68050000-0000-0000-0000-000000000002'),
  '68000000-0000-0000-0000-000000000002', '随迁集合内部的依赖边随迁');
SELECT is((SELECT count(*)::int FROM public.task_mutations
    WHERE mutation_id = '68060000-0000-0000-0000-000000000099'), 0,
  '幂等日志随转移删除（在途回放将 not_found 进 dead-letter，可见不静默）');

-- 引用行随迁
SELECT is((SELECT user_id::text FROM public.task_item_refs
    WHERE note_id = '68020000-0000-0000-0000-000000000001'),
  '68000000-0000-0000-0000-000000000002', 'task_item_refs 行随迁（同时等于笔记与任务属主）');

-- 标签：复制 + 同名复用，旧属主原始标签保留
SELECT is((SELECT count(*)::int FROM public.tags
    WHERE user_id = '68000000-0000-0000-0000-000000000002' AND name = 'deploy'), 1,
  'B 已有同名 deploy 标签 → 复用不重复');
SELECT is((SELECT count(*)::int FROM public.tags
    WHERE user_id = '68000000-0000-0000-0000-000000000002' AND name = '私tag'), 1,
  'B 名下新建「私tag」副本');
SELECT is((SELECT count(*)::int FROM public.tags
    WHERE user_id = '68000000-0000-0000-0000-000000000001'), 2,
  'A 的原始标签两张都保留');
SELECT is((SELECT count(*)::int FROM public.task_tags tt
    JOIN public.tags g ON g.id = tt.tag_id
    WHERE tt.task_id = '68050000-0000-0000-0000-000000000002' AND g.user_id = '68000000-0000-0000-0000-000000000002'), 1,
  'task_tags 重指向 B 名下标签');
SELECT is((SELECT count(*)::int FROM public.note_tags nt
    JOIN public.tags g ON g.id = nt.tag_id
    WHERE nt.note_id = '68020000-0000-0000-0000-000000000001' AND g.user_id = '68000000-0000-0000-0000-000000000002'), 1,
  'note_tags 重指向 B 名下标签');

-- 评论 / 建议 随迁（056 复合外键把 user_id 钉成租户列）
SELECT is((SELECT user_id::text FROM public.note_comment_threads
    WHERE id = '680a0000-0000-0000-0000-000000000001'),
  '68000000-0000-0000-0000-000000000002', '评论线程随迁');
SELECT is((SELECT user_id::text FROM public.note_comments
    WHERE id = '680a0000-0000-0000-0000-000000000002'),
  '68000000-0000-0000-0000-000000000002', '评论随迁');
SELECT is((SELECT user_id::text FROM public.note_suggestions
    WHERE id = '680a0000-0000-0000-0000-000000000003'),
  '68000000-0000-0000-0000-000000000002', '建议随迁');

-- 反向引用清理（非接收人名下）
SELECT is((SELECT task_id::text FROM public.lessons WHERE id = '680b0000-0000-0000-0000-000000000001'), NULL,
  'A 的经验解除任务关联');
SELECT is((SELECT note_id::text FROM public.lessons WHERE id = '680b0000-0000-0000-0000-000000000001'), NULL,
  'A 的经验解除笔记关联');
SELECT is((SELECT note_id::text FROM public.highlights WHERE id = '680b0000-0000-0000-0000-000000000002'), NULL,
  'A 的高亮解除笔记关联');
SELECT is((SELECT task_id::text FROM public.highlights WHERE id = '680b0000-0000-0000-0000-000000000002'), NULL,
  'A 的高亮解除任务关联');
SELECT is((SELECT count(*)::int FROM public.favorites WHERE target_type = 'note'
    AND target_id = '68020000-0000-0000-0000-000000000001'), 0,
  '收藏行清除（否则旧属主导出引用断链）');
SELECT is((SELECT count(*)::int FROM public.shares WHERE resource_type = 'note'
    AND resource_id = '68020000-0000-0000-0000-000000000001'), 0,
  '公开分享链接清除（旧属主不留指向新属主内容的公开口）');
SELECT is((SELECT parent_note_id::text FROM public.db_databases
    WHERE id = '680b0000-0000-0000-0000-000000000005'), NULL,
  'A 的页面数据库解除挂载');

-- 授权视图：B 成属主，A 以 editor 保留（resource_acl 未动）
SET ROLE authenticated;
SET request.jwt.claim.sub TO '68000000-0000-0000-0000-000000000002';  -- B
SELECT is(public.resource_role('note', '68020000-0000-0000-0000-000000000001'), 'owner',
  'B 凭行属主身份拿到 owner');
SET request.jwt.claim.sub TO '68000000-0000-0000-0000-000000000001';  -- A
SELECT is(public.resource_role('note', '68020000-0000-0000-0000-000000000001'), 'editor',
  'A 仍以 W1 的 editor 授权保留访问');

-- ========== 11. 转移后保存链（同转语义的根据：新属主必须能正常保存）==========
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '68020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"b1","taskId":"68050000-0000-0000-0000-000000000002","checked":false}}]}'::jsonb,
    p_expected_note_revision := 0,
    p_note_snapshot := null))->>'status',
  'ok', '新属主 B 保存成功（悬空任务块会造成 conflict_task，同转避免了它）');
RESET ROLE;
SELECT is((SELECT content_revision FROM public.notes
    WHERE id = '68020000-0000-0000-0000-000000000001'), 1, 'B 保存推进 revision');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '68000000-0000-0000-0000-000000000001';  -- A
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '68020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[{"type":"taskItem","attrs":{"id":"b1","taskId":"68050000-0000-0000-0000-000000000002","checked":false}}]}'::jsonb,
    p_expected_note_revision := 1,
    p_note_snapshot := null))->>'status',
  'ok', '旧属主 A 以 editor 身份仍可保存（resource_acl 保留语义）');
SET request.jwt.claim.sub TO '68000000-0000-0000-0000-000000000003';  -- C
SELECT is((public.save_note_with_tasks_v2(
    p_note_id := '68020000-0000-0000-0000-000000000001',
    p_content := '{"type":"doc","content":[]}'::jsonb,
    p_expected_note_revision := 2,
    p_note_snapshot := null))->>'status',
  'forbidden', 'viewer 的 C 依然不可写');
RESET ROLE;

-- ========== 12. 反向移交：B 把 N1 移回 A（对称可行，标签复用）==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '68000000-0000-0000-0000-000000000002';  -- B
SELECT is((public.transfer_note_ownership(
    p_note_id := '68020000-0000-0000-0000-000000000001',
    p_new_owner := '68000000-0000-0000-0000-000000000001'))->>'tags_copied',
  '0', '反向移交时同名标签全部复用，不新建');
RESET ROLE;
SELECT is((SELECT user_id::text FROM public.notes
    WHERE id = '68020000-0000-0000-0000-000000000001'),
  '68000000-0000-0000-0000-000000000001', '笔记回到 A 名下');
SELECT is((SELECT user_id::text FROM public.tasks WHERE id = '68050000-0000-0000-0000-000000000002'),
  '68000000-0000-0000-0000-000000000001', '任务树回到 A 名下');
SELECT is((SELECT count(*)::int FROM public.task_tags tt
    JOIN public.tags g ON g.id = tt.tag_id
    WHERE tt.task_id = '68050000-0000-0000-0000-000000000002' AND g.user_id = '68000000-0000-0000-0000-000000000001'), 1,
  'task_tags 指回 A 的原始标签');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '68000000-0000-0000-0000-000000000002';  -- B
SELECT is(public.resource_role('note', '68020000-0000-0000-0000-000000000001'), 'editor',
  '反向移交后 B 以 editor 保留访问');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
