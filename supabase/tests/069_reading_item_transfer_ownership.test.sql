-- 069 阅读条目属主移交 transfer_reading_item_ownership pgTAP
--
-- 覆盖（与 069 文件头的拍板一一对应）：
--   1. 结构：EXECUTE 分层（transfer_reading_item_ownership → authenticated/service_role）
--   2. 拒绝矩阵（fail-closed，全部显式报错）：匿名 / 非属主（viewer 的 C、editor 的 B）/
--      接收人无 editor 授权 / 自移自 / 接收人不存在 / 垃圾箱
--   3. 同转 happy path（A → B）：条目行易主；高亮随迁（锚点 NOT NULL，唯一无损选项）
--      且随迁行上指向旧属主笔记/任务的引用列解除；B 既有高亮不受影响；他条目高亮不动；
--      标签同名复制与复用；接收人名下的 notes/tasks 关联保留、旧属主的解除；
--      lessons 关联解除；favorites / shares 清除
--   4. 转移后写路径：B（新属主）凭 RLS 直写状态；A（editor 授权保留）无写路径（064 合同）
--   5. 反向移交（B → A）：对称可行，标签全部复用（tags_copied = 0），高亮随行迁回
--
-- 约定同 068：ACL 以 postgres 直插；「先读后调」不放进同一个表达式；
-- throws_ok 断言错误消息全文。
BEGIN;
SELECT plan(40);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('69000000-0000-0000-0000-000000000001', 'p69_a@test', '{"full_name":"A"}'),
    ('69000000-0000-0000-0000-000000000002', 'p69_b@test', '{"full_name":"B"}'),
    ('69000000-0000-0000-0000-000000000003', 'p69_c@test', '{"full_name":"C"}')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- W1: A owner + B member（R1 的 editor 授权走它）；W2: C owner（viewer 授权走它）
INSERT INTO public.workspaces (id, name, kind, owner_id) VALUES
  ('69010000-0000-0000-0000-000000000001', 'T69-W1', 'team', '69000000-0000-0000-0000-000000000001'),
  ('69010000-0000-0000-0000-000000000002', 'T69-W2', 'team', '69000000-0000-0000-0000-000000000003');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('69010000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001', 'owner'),
  ('69010000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000002', 'member'),
  ('69010000-0000-0000-0000-000000000002', '69000000-0000-0000-0000-000000000003', 'owner');

-- 阅读条目：R1 = 移交目标；R2 = 垃圾箱；R3 = A 的另一条目（必须不受波及）
INSERT INTO public.reading_items (id, user_id, url, title, reading_status) VALUES
  ('69090000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001',
   'https://example.com/a69', 'A的移交文章', 'reading'),
  ('69090000-0000-0000-0000-000000000002', '69000000-0000-0000-0000-000000000001',
   'https://example.com/trash69', 'A的垃圾箱文章', 'unread'),
  ('69090000-0000-0000-0000-000000000003', '69000000-0000-0000-0000-000000000001',
   'https://example.com/other69', 'A的另一篇文章', 'unread');
UPDATE public.reading_items SET deleted_at = now()
 WHERE id = '69090000-0000-0000-0000-000000000002';

-- R1 对 W1 = editor（B 可编辑）、对 W2 = viewer（C 只读）
INSERT INTO public.resource_acl (workspace_id, resource_type, resource_id, access_role, created_by) VALUES
  ('69010000-0000-0000-0000-000000000001', 'reading_item', '69090000-0000-0000-0000-000000000001', 'editor',
   '69000000-0000-0000-0000-000000000001'),
  ('69010000-0000-0000-0000-000000000002', 'reading_item', '69090000-0000-0000-0000-000000000001', 'viewer',
   '69000000-0000-0000-0000-000000000001');

-- 标签：G1/G2 挂 R1（G2 是复用场景——B 已有同名 deploy）；G3 只挂 R3
INSERT INTO public.tags (id, user_id, name, color) VALUES
  ('69070000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001', '私tag', 'red'),
  ('69070000-0000-0000-0000-000000000002', '69000000-0000-0000-0000-000000000001', 'deploy', 'blue'),
  ('69070000-0000-0000-0000-000000000003', '69000000-0000-0000-0000-000000000002', 'deploy', 'violet'),
  ('69070000-0000-0000-0000-000000000004', '69000000-0000-0000-0000-000000000001', 'solo', 'green');
INSERT INTO public.item_tags (item_id, tag_id) VALUES
  ('69090000-0000-0000-0000-000000000001', '69070000-0000-0000-0000-000000000001'),
  ('69090000-0000-0000-0000-000000000001', '69070000-0000-0000-0000-000000000002'),
  ('69090000-0000-0000-0000-000000000003', '69070000-0000-0000-0000-000000000004');

-- 高亮：H1 = A 在 R1 上（带指向 A 笔记/任务的引用列，验证随迁时解除）；
-- H1b = B 在 R1 上（共享期划的，保持 B 名下）；H3 = A 在 R3 上（不受波及）
INSERT INTO public.notes (id, user_id, title, reading_item_id) VALUES
  ('69020000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001', 'A的文章笔记',
   '69090000-0000-0000-0000-000000000001'),
  ('69020000-0000-0000-0000-000000000002', '69000000-0000-0000-0000-000000000002', 'B的文章笔记',
   '69090000-0000-0000-0000-000000000001');
INSERT INTO public.tasks (id, user_id, title, reading_item_id) VALUES
  ('69050000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001', 'A的关联任务',
   '69090000-0000-0000-0000-000000000001'),
  ('69050000-0000-0000-0000-000000000002', '69000000-0000-0000-0000-000000000002', 'B的关联任务',
   '69090000-0000-0000-0000-000000000001');
INSERT INTO public.highlights (id, user_id, reading_item_id, content, note_id, task_id) VALUES
  ('690b0000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001',
   '69090000-0000-0000-0000-000000000001', 'A的划线',
   '69020000-0000-0000-0000-000000000001', '69050000-0000-0000-0000-000000000001'),
  ('690b0000-0000-0000-0000-000000000002', '69000000-0000-0000-0000-000000000002',
   '69090000-0000-0000-0000-000000000001', 'B的划线', null, null),
  ('690b0000-0000-0000-0000-000000000003', '69000000-0000-0000-0000-000000000001',
   '69090000-0000-0000-0000-000000000003', 'A在另一篇的划线', null, null);

-- 反向引用组：A 的经验 / 双方收藏 / A 的公开分享
INSERT INTO public.lessons (id, user_id, title, reading_item_id) VALUES
  ('690c0000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001', 'A的经验',
   '69090000-0000-0000-0000-000000000001');
INSERT INTO public.favorites (id, user_id, target_type, target_id) VALUES
  ('690d0000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001', 'reading',
   '69090000-0000-0000-0000-000000000001'),
  ('690d0000-0000-0000-0000-000000000002', '69000000-0000-0000-0000-000000000002', 'reading',
   '69090000-0000-0000-0000-000000000001');
INSERT INTO public.shares (id, owner_id, resource_type, resource_id, token) VALUES
  ('690e0000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001', 'reading_item',
   '69090000-0000-0000-0000-000000000001', 'tok69r1');

-- ========== 1. 结构与 EXECUTE 分层 ==========
SELECT is(has_function_privilege('anon', 'transfer_reading_item_ownership(uuid,uuid)', 'EXECUTE'), false,
  'transfer_reading_item_ownership 对 anon 无 EXECUTE');
SELECT is(has_function_privilege('authenticated', 'transfer_reading_item_ownership(uuid,uuid)', 'EXECUTE'), true,
  'transfer_reading_item_ownership 对 authenticated 有 EXECUTE');
SELECT is(has_function_privilege('service_role', 'transfer_reading_item_ownership(uuid,uuid)', 'EXECUTE'), true,
  'transfer_reading_item_ownership 对 service_role 有 EXECUTE');

-- ========== 2. 匿名拒绝 ==========
SET ROLE authenticated;
RESET request.jwt.claim.sub;
SELECT throws_ok(
  $$SELECT public.transfer_reading_item_ownership(
       '69090000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000002')$$,
  'anonymous', '匿名（auth.uid() 为空）拒绝');
RESET ROLE;

-- ========== 3. 非属主拒绝（viewer 的 C、editor 的 B 都不能发起移交）==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '69000000-0000-0000-0000-000000000003';  -- C（viewer）
SELECT throws_ok(
  $$SELECT public.transfer_reading_item_ownership(
       '69090000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000002')$$,
  'only the article owner can transfer', 'viewer 的 C 不能移交他人条目');
SET request.jwt.claim.sub TO '69000000-0000-0000-0000-000000000002';  -- B（editor）
SELECT throws_ok(
  $$SELECT public.transfer_reading_item_ownership(
       '69090000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001')$$,
  'only the article owner can transfer', 'editor 的 B 也不能移交（移交是属主专属动作）');

-- ========== 4. 接收人资格：viewer 不够（先共享可编辑，才能移交）==========
SET request.jwt.claim.sub TO '69000000-0000-0000-0000-000000000001';  -- A
SELECT throws_ok(
  $$SELECT public.transfer_reading_item_ownership(
       '69090000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000003')$$,
  'recipient must have editor access to this article first',
  '接收人只有 viewer 授权时拒绝');

-- ========== 5. 自移自 / 接收人不存在 / 垃圾箱 ==========
SELECT throws_ok(
  $$SELECT public.transfer_reading_item_ownership(
       '69090000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001')$$,
  'new owner must be another user', '自移自拒绝');
SELECT throws_ok(
  $$SELECT public.transfer_reading_item_ownership(
       '69090000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-0000000000ff')$$,
  'new owner not found', '接收人不存在拒绝');
SELECT throws_ok(
  $$SELECT public.transfer_reading_item_ownership(
       '69090000-0000-0000-0000-000000000002', '69000000-0000-0000-0000-000000000002')$$,
  'article is in trash; restore it first', '垃圾箱里的条目拒绝移交');

-- ========== 6. happy path：A 把 R1 移交给 B ==========
SELECT is((public.transfer_reading_item_ownership(
    p_item_id := '69090000-0000-0000-0000-000000000001',
    p_new_owner := '69000000-0000-0000-0000-000000000002'))->>'status',
  'ok', '属主 A 移交 R1 给 editor 的 B 成功');
RESET ROLE;

SELECT is((SELECT user_id::text FROM public.reading_items
    WHERE id = '69090000-0000-0000-0000-000000000001'),
  '69000000-0000-0000-0000-000000000002', '条目行属主变为 B');
SELECT is((SELECT title FROM public.reading_items WHERE id = '69090000-0000-0000-0000-000000000001'),
  'A的移交文章', '标题不变');
SELECT is((SELECT reading_status FROM public.reading_items WHERE id = '69090000-0000-0000-0000-000000000001'),
  'reading', '阅读状态随行保留（行内字段随易主）');
SELECT is((SELECT user_id::text FROM public.reading_items WHERE id = '69090000-0000-0000-0000-000000000003'),
  '69000000-0000-0000-0000-000000000001', '另一条目 R3 不受波及');

-- 高亮随迁：A 的划线随条目易主，指向 A 笔记/任务的引用列解除；B 的划线不动
SELECT is((SELECT user_id::text FROM public.highlights WHERE id = '690b0000-0000-0000-0000-000000000001'),
  '69000000-0000-0000-0000-000000000002', 'A 在 R1 上的高亮随迁到 B（NOT NULL 锚点，唯一无损选项）');
SELECT is((SELECT note_id::text FROM public.highlights WHERE id = '690b0000-0000-0000-0000-000000000001'),
  NULL, '随迁高亮解除指向 A 笔记的引用列');
SELECT is((SELECT task_id::text FROM public.highlights WHERE id = '690b0000-0000-0000-0000-000000000001'),
  NULL, '随迁高亮解除指向 A 任务的引用列');
SELECT is((SELECT user_id::text FROM public.highlights WHERE id = '690b0000-0000-0000-0000-000000000002'),
  '69000000-0000-0000-0000-000000000002', 'B 共享期划的高亮保持 B 名下');
SELECT is((SELECT user_id::text FROM public.highlights WHERE id = '690b0000-0000-0000-0000-000000000003'),
  '69000000-0000-0000-0000-000000000001', 'A 在另一条目上的高亮不受波及');

-- 标签：复制 + 同名复用，旧属主原始标签保留
SELECT is((SELECT count(*)::int FROM public.tags
    WHERE user_id = '69000000-0000-0000-0000-000000000002' AND name = 'deploy'), 1,
  'B 已有同名 deploy 标签 → 复用不重复');
SELECT is((SELECT count(*)::int FROM public.tags
    WHERE user_id = '69000000-0000-0000-0000-000000000002' AND name = '私tag'), 1,
  'B 名下新建「私tag」副本');
SELECT is((SELECT count(*)::int FROM public.tags
    WHERE user_id = '69000000-0000-0000-0000-000000000001'), 3,
  'A 的原始标签三张都保留');
SELECT is((SELECT count(*)::int FROM public.item_tags it
    JOIN public.tags g ON g.id = it.tag_id
    WHERE it.item_id = '69090000-0000-0000-0000-000000000001'
      AND g.user_id = '69000000-0000-0000-0000-000000000002'), 2,
  'R1 的 item_tags 全部重指向 B 名下标签');
SELECT is((SELECT count(*)::int FROM public.item_tags it
    JOIN public.tags g ON g.id = it.tag_id
    WHERE it.item_id = '69090000-0000-0000-0000-000000000003'
      AND g.user_id = '69000000-0000-0000-0000-000000000001'), 1,
  'R3 的 item_tags 仍指向 A 的标签');

-- 反向引用清理（非接收人名下解除；接收人名下保留）
SELECT is((SELECT reading_item_id::text FROM public.notes WHERE id = '69020000-0000-0000-0000-000000000001'),
  NULL, 'A 的文章笔记解除挂载');
SELECT is((SELECT reading_item_id::text FROM public.notes WHERE id = '69020000-0000-0000-0000-000000000002'),
  '69090000-0000-0000-0000-000000000001', 'B 自己的文章笔记保留（转移后同租户合法）');
SELECT is((SELECT reading_item_id::text FROM public.tasks WHERE id = '69050000-0000-0000-0000-000000000001'),
  NULL, 'A 的关联任务解除挂载');
SELECT is((SELECT reading_item_id::text FROM public.tasks WHERE id = '69050000-0000-0000-0000-000000000002'),
  '69090000-0000-0000-0000-000000000001', 'B 的关联任务保留');
SELECT is((SELECT reading_item_id::text FROM public.lessons WHERE id = '690c0000-0000-0000-0000-000000000001'),
  NULL, 'A 的经验解除挂载');
SELECT is((SELECT count(*)::int FROM public.favorites
    WHERE target_type = 'reading' AND target_id = '69090000-0000-0000-0000-000000000001'), 1,
  'A 的收藏清除，B 的收藏保留（剩 1 条）');
SELECT is((SELECT count(*)::int FROM public.shares
    WHERE resource_type = 'reading_item' AND resource_id = '69090000-0000-0000-0000-000000000001'), 0,
  '公开分享链接清除（旧属主不留指向新属主内容的公开口）');

-- 授权视图：B 成属主，A 以 editor 保留（resource_acl 未动）
SET ROLE authenticated;
SET request.jwt.claim.sub TO '69000000-0000-0000-0000-000000000002';  -- B
SELECT is(public.resource_role('reading_item', '69090000-0000-0000-0000-000000000001'), 'owner',
  'B 凭行属主身份拿到 owner');
UPDATE public.reading_items SET reading_status = 'read'
 WHERE id = '69090000-0000-0000-0000-000000000001' AND reading_status = 'reading';
RESET ROLE;
SELECT is((SELECT reading_status FROM public.reading_items
    WHERE id = '69090000-0000-0000-0000-000000000001'), 'read',
  '新属主 B 凭 RLS 直写阅读状态');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '69000000-0000-0000-0000-000000000001';  -- A
UPDATE public.reading_items SET reading_status = 'unread'
 WHERE id = '69090000-0000-0000-0000-000000000001' AND reading_status = 'read';
RESET ROLE;
SELECT is((SELECT reading_status FROM public.reading_items
    WHERE id = '69090000-0000-0000-0000-000000000001'), 'read',
  'A（editor 授权保留）无写路径——064 合同：协作者没有 reading_items UPDATE 策略');

-- ========== 7. 反向移交：B 把 R1 移回 A（对称可行，标签复用）==========
SET ROLE authenticated;
SET request.jwt.claim.sub TO '69000000-0000-0000-0000-000000000002';  -- B
SELECT is((public.transfer_reading_item_ownership(
    p_item_id := '69090000-0000-0000-0000-000000000001',
    p_new_owner := '69000000-0000-0000-0000-000000000001'))->>'tags_copied',
  '0', '反向移交时同名标签全部复用，不新建');
RESET ROLE;
SELECT is((SELECT user_id::text FROM public.reading_items
    WHERE id = '69090000-0000-0000-0000-000000000001'),
  '69000000-0000-0000-0000-000000000001', '条目回到 A 名下');
SELECT is((SELECT user_id::text FROM public.highlights WHERE id = '690b0000-0000-0000-0000-000000000001'),
  '69000000-0000-0000-0000-000000000001', '随迁高亮随行迁回 A');
SELECT is((SELECT count(*)::int FROM public.item_tags it
    JOIN public.tags g ON g.id = it.tag_id
    WHERE it.item_id = '69090000-0000-0000-0000-000000000001'
      AND g.user_id = '69000000-0000-0000-0000-000000000001'), 2,
  'item_tags 指回 A 的原始标签');
SET ROLE authenticated;
SET request.jwt.claim.sub TO '69000000-0000-0000-0000-000000000002';  -- B
SELECT is(public.resource_role('reading_item', '69090000-0000-0000-0000-000000000001'), 'editor',
  '反向移交后 B 以 editor 保留访问');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
