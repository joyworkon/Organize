-- 063 协作权限模型最小原型 pgTAP（P5-01）
--
-- 覆盖（对应任务卡五项验证 + 063 文件头的取舍）：
--   1. owner/editor/viewer 判定链：属主优先、多空间取最高、类型+id 精确、不存在即 NULL
--   2. 两个互不相关 workspace 的隔离：三张新表按成员身份可见，非成员零行
--   3. 客户端不得直写 resource_acl：空间 owner 也不能自升别人资源的授权角色（提权负例）
--   4. 邀请 / 改角色 / 退出空间 / 移除成员 / 移交属主 的控制面边界
--   5. 资源控制面转移与整体回收；业务行硬删后授权不留幽灵
-- 身份切换沿 056 约定：SET ROLE authenticated + SET request.jwt.claim.sub
-- throws_ok 第 3 参是「期望错误消息」，与 raise exception 原文逐字一致
-- 计数断言优先带 id 限定（本地 dev 库有存量账号，全局 count 不可依赖）；
-- 仅「经 RLS 过滤后的可见集」与「新表新列」允许全局统计
BEGIN;
SELECT plan(85);

-- ========== 数据准备（postgres 直插，绕过 RLS）==========
DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('63000001-0000-0000-0000-000000000001', 'p5_a@test'),
    ('63000002-0000-0000-0000-000000000002', 'p5_b@test'),
    ('63000003-0000-0000-0000-000000000003', 'p5_c@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- 触发器已为三个账号补建个人空间；再直建 A 的两个团队空间与 C 的一个（A 不是成员）
INSERT INTO public.workspaces (id, name, kind, owner_id) VALUES
  ('63010000-0000-0000-0000-000000000001', 'W1', 'team', '63000001-0000-0000-0000-000000000001'),
  ('63010000-0000-0000-0000-000000000002', 'W2', 'team', '63000001-0000-0000-0000-000000000001'),
  ('63010000-0000-0000-0000-000000000004', 'W4', 'team', '63000003-0000-0000-0000-000000000003');

-- W1: A owner + B member；W2: 只有 A；W4: 只有 C（与 A 完全无关的空间）
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('63010000-0000-0000-0000-000000000001', '63000001-0000-0000-0000-000000000001', 'owner'),
  ('63010000-0000-0000-0000-000000000001', '63000002-0000-0000-0000-000000000002', 'member'),
  ('63010000-0000-0000-0000-000000000002', '63000001-0000-0000-0000-000000000001', 'owner'),
  ('63010000-0000-0000-0000-000000000004', '63000003-0000-0000-0000-000000000003', 'owner');

INSERT INTO public.notes (id, user_id, title, content) VALUES
  ('63020000-0000-0000-0000-000000000001', '63000001-0000-0000-0000-000000000001',
   'A的笔记', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb),
  ('63020000-0000-0000-0000-000000000002', '63000002-0000-0000-0000-000000000002',
   'B的笔记', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb);

INSERT INTO public.reading_items (id, user_id, url, title) VALUES
  ('63030000-0000-0000-0000-000000000001', '63000001-0000-0000-0000-000000000001',
   'https://example.com/a', 'A的文章');

INSERT INTO public.task_lists (id, user_id, name) VALUES
  ('63040000-0000-0000-0000-000000000001', '63000001-0000-0000-0000-000000000001', 'A清单');

INSERT INTO public.tasks (id, user_id, list_id, title) VALUES
  ('63050000-0000-0000-0000-000000000001', '63000001-0000-0000-0000-000000000001',
   '63040000-0000-0000-0000-000000000001', 'A的任务');

-- ========== 1. 个人空间自动就位与唯一性不变量 ==========
SELECT is(
  (SELECT count(*) FROM public.workspaces
    WHERE owner_id = '63000001-0000-0000-0000-000000000001' AND kind = 'personal'),
  1::bigint, 'A 注册时由 auth.users 触发器补建恰好一个个人空间');

SELECT is(
  (SELECT count(*) FROM public.workspaces
    WHERE owner_id = '63000003-0000-0000-0000-000000000003' AND kind = 'personal'),
  1::bigint, 'C 同样自动获得个人空间（新增与存量 backfill 同一实现）');

SELECT is(
  (SELECT role FROM public.workspace_members
    WHERE user_id = '63000001-0000-0000-0000-000000000001'
      AND workspace_id = (SELECT id FROM public.workspaces
                           WHERE owner_id = '63000001-0000-0000-0000-000000000001'
                             AND kind = 'personal')),
  'owner'::text, '个人空间里自己是唯一 owner 成员');

SET ROLE authenticated;
SET request.jwt.claim.sub TO '63000001-0000-0000-0000-000000000001';  -- 用户 A

SELECT is(public.ensure_personal_workspace(), public.ensure_personal_workspace(),
  'ensure_personal_workspace 幂等（两次返回同一空间 id）');

SELECT throws_ok(
  $$INSERT INTO public.workspaces (name, kind, owner_id)
    VALUES ('再一个', 'personal', '63000001-0000-0000-0000-000000000001')$$,
  'duplicate key value violates unique constraint "workspaces_personal_owner_key"',
  '第二个个人空间被 partial unique 索引拒绝');

-- ========== 2. 角色矩阵：属主优先 / 空间授权 / 类型与 id 精确 ==========
SELECT is(public.resource_role('note', '63020000-0000-0000-0000-000000000001'), 'owner'::text,
  'A 看自己的笔记 = owner（不经任何空间）');

SET request.jwt.claim.sub TO '63000002-0000-0000-0000-000000000002';  -- 用户 B（W1 member）

SELECT is(public.resource_role('note', '63020000-0000-0000-0000-000000000001') IS NULL, true,
  '未授权时 B 看 A 的笔记 = NULL（成员身份本身不给读权）');

SET request.jwt.claim.sub TO '63000001-0000-0000-0000-000000000001';  -- A

SELECT lives_ok(
  $$SELECT public.grant_resource('note', '63020000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000001', 'editor')$$,
  'A 把自己的笔记授权给 W1 = editor');

SET request.jwt.claim.sub TO '63000002-0000-0000-0000-000000000002';  -- B

SELECT is(public.resource_role('note', '63020000-0000-0000-0000-000000000001'), 'editor'::text,
  'B 经 W1 成员身份拿到 editor');

SELECT is(public.resource_role('note', '63020000-0000-0000-0000-000000000002'), 'owner'::text,
  'B 自己的笔记仍是 owner（授权不改变别人的属主判定）');

SELECT is(public.resource_role('reading_item', '63030000-0000-0000-0000-000000000001') IS NULL, true,
  'note 授权不外溢到同一人的 reading_item（按 resource_type + id 精确判定）');

SELECT is(public.resource_role('task', '63050000-0000-0000-0000-000000000001') IS NULL, true,
  'note 授权不外溢到同一人的 task');

SET request.jwt.claim.sub TO '63000001-0000-0000-0000-000000000001';  -- A

SELECT lives_ok(
  $$SELECT public.grant_resource('note', '63020000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000001', 'viewer')$$,
  'A 改角色（同空间同资源 upsert 覆盖，不新增行）');

SET request.jwt.claim.sub TO '63000002-0000-0000-0000-000000000002';  -- B

SELECT is(public.resource_role('note', '63020000-0000-0000-0000-000000000001'), 'viewer'::text,
  '改角色后 B 降到 viewer（不残留更高的旧角色）');

SELECT is((SELECT count(*) FROM public.resource_acl
            WHERE resource_id = '63020000-0000-0000-0000-000000000001'
              AND workspace_id = '63010000-0000-0000-0000-000000000001'), 1::bigint,
  '改角色只有一行（unique(workspace_id, type, resource_id) 生效）');

-- 多空间取最高：把 B 也拉进 W2，并把同一笔记授权 W2 = editor
SET request.jwt.claim.sub TO '63000001-0000-0000-0000-000000000001';  -- A

SELECT lives_ok(
  $$SELECT public.add_workspace_member('63010000-0000-0000-0000-000000000002',
    '63000002-0000-0000-0000-000000000002', 'member')$$,
  'A 把 B 拉进 W2');

SELECT lives_ok(
  $$SELECT public.grant_resource('note', '63020000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000002', 'editor')$$,
  'A 把同一笔记授权给 W2 = editor');

SET request.jwt.claim.sub TO '63000002-0000-0000-0000-000000000002';  -- B（W1 viewer / W2 editor）

SELECT is(public.resource_role('note', '63020000-0000-0000-0000-000000000001'), 'editor'::text,
  'B 跨两个空间的角色取最高（viewer ∪ editor = editor）');

SET request.jwt.claim.sub TO '63000003-0000-0000-0000-000000000003';  -- 陌生人 C

SELECT is(public.resource_role('note', '63020000-0000-0000-0000-000000000001') IS NULL, true,
  'C 不在任何被授权空间 → NULL');

SELECT is(public.resource_role('note', '63060000-0000-0000-0000-000000000099') IS NULL, true,
  '不存在的资源 → NULL（不泄漏存在性）');

SELECT is(public.resource_role('bogus', '63020000-0000-0000-0000-000000000001') IS NULL, true,
  '未知 resource_type → NULL（不接受自由字符串放行）');

-- ========== 3. grant 的拒绝面 ==========
SET request.jwt.claim.sub TO '63000002-0000-0000-0000-000000000002';  -- B（W1 viewer / W2 editor）

SELECT throws_ok(
  $$SELECT public.grant_resource('note', '63020000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000002', 'editor')$$,
  'not resource controller',
  'editor 不能二次转授（控制面只在属主与 access_role=owner 手里）');

SELECT throws_ok(
  $$SELECT public.grant_resource('note', '63060000-0000-0000-0000-000000000099',
    '63010000-0000-0000-0000-000000000002', 'editor')$$,
  'resource not found',
  '给不存在的资源建授权被拒');

SELECT lives_ok(
  $$SELECT public.grant_resource('note', '63020000-0000-0000-0000-000000000002',
    '63010000-0000-0000-0000-000000000001', 'viewer')$$,
  'B 可以把自己拥有的笔记授权给自己所在的 W1（正常路径未被误伤）');

SET request.jwt.claim.sub TO '63000001-0000-0000-0000-000000000001';  -- A

SELECT throws_ok(
  $$SELECT public.grant_resource('note', '63020000-0000-0000-0000-000000000002',
    '63010000-0000-0000-0000-000000000001', 'editor')$$,
  'not resource controller',
  'A 不能把 B 的笔记授权进自己的空间（跨用户挂资源被拒）');

SELECT throws_ok(
  $$SELECT public.grant_resource('note', '63020000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000004', 'editor')$$,
  'not a member of target workspace',
  'A 不能把资源授权进自己不是成员的空间（C 的 W4）');

SELECT throws_ok(
  $$SELECT public.grant_resource('note', '63020000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000001', 'admin')$$,
  'bad access_role',
  '非法 access_role 被拒');

-- ========== 4. 三张表自身的跨空间隔离 ==========
SELECT is((SELECT count(*) FROM public.workspaces
            WHERE id IN ('63010000-0000-0000-0000-000000000001',
                         '63010000-0000-0000-0000-000000000002')), 2::bigint,
  'B 能看到自己是成员的 W1/W2');

SELECT is((SELECT count(*) FROM public.resource_acl
            WHERE workspace_id = '63010000-0000-0000-0000-000000000001'), 2::bigint,
  'B 能读到 W1 的两条授权（自己的笔记 + A 的笔记）');

SET request.jwt.claim.sub TO '63000003-0000-0000-0000-000000000003';  -- C

SELECT is((SELECT count(*) FROM public.workspaces
            WHERE id IN ('63010000-0000-0000-0000-000000000001',
                         '63010000-0000-0000-0000-000000000002')), 0::bigint,
  'C 看不到 A 的两个空间（互不相关空间隔离）');

SELECT is((SELECT count(*) FROM public.workspace_members
            WHERE workspace_id = '63010000-0000-0000-0000-000000000001'), 0::bigint,
  'C 看不到 W1 的成员名单（谁被邀请了不外泄）');

SELECT is((SELECT count(*) FROM public.resource_acl), 0::bigint,
  'C 侧一张授权行都看不到（个人空间与 W4 都没有被授权过）');

-- ========== 5. resource_acl 对客户端只读（防空间 owner 自升） ==========
-- 直写手法一次尝试：本环境若显式 revoke 了表级 DML → 42501；若平台默认权限放开了
-- DML 但没有写策略 → 0 行生效。两种都算拒绝，所以断言落在「数据有没有变」上，
-- 不落在错误文案上（否则测试结论会随执行环境的默认权限漂移）。
SET request.jwt.claim.sub TO '63000001-0000-0000-0000-000000000001';  -- A（资源属主兼 W1/W2 owner）

SELECT lives_ok(
  $q$DO $tag$
    begin
      update public.resource_acl set access_role = 'owner'
       where workspace_id = '63010000-0000-0000-0000-000000000001';
      insert into public.resource_acl
        (workspace_id, resource_type, resource_id, access_role, created_by)
        values ('63010000-0000-0000-0000-000000000001', 'note',
                '63020000-0000-0000-0000-000000000002', 'owner',
                '63000001-0000-0000-0000-000000000001');
      delete from public.resource_acl
       where workspace_id = '63010000-0000-0000-0000-000000000001';
    exception when insufficient_privilege then
      null;                       -- 42501：改不动就是改不动
    end
    $tag$;$q$,
  'A 直改 / 直插 / 直删授权表要么被权限拦下、要么 0 行生效，且不炸事务');

RESET ROLE;  -- 数据效果必须以全可见视角统计，否则断言会被 C 的 RLS 过滤变成恒真

SELECT is(
  (SELECT access_role FROM public.resource_acl
    WHERE workspace_id = '63010000-0000-0000-0000-000000000001'
      AND resource_type = 'note'
      AND resource_id = '63020000-0000-0000-0000-000000000001'),
  'viewer'::text,
  'A 自升 access_role 无效，仍是 viewer');

SELECT is((SELECT count(*) FROM public.resource_acl
            WHERE workspace_id = '63010000-0000-0000-0000-000000000001'), 2::bigint,
  '直插与直删都未生效（W1 仍是 N_A + N_B 两行）');

SELECT is((SELECT count(*) FROM public.resource_acl
            WHERE access_role = 'owner'), 0::bigint,
  '全库没有任何一条 access_role=owner 的授权被客户端直写出来');

SET ROLE authenticated;
SET request.jwt.claim.sub TO '63000002-0000-0000-0000-000000000002';  -- B

SELECT throws_ok(
  $$INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES ('63010000-0000-0000-0000-000000000002',
            '63000002-0000-0000-0000-000000000002', 'owner')$$,
  'new row violates row-level security policy for table "workspace_members"',
  'member 不能绕过 RPC 把自己写成 W2 的 owner（RLS with check 拦下）');

-- ========== 6. 成员管理：邀请 / 改角色 / 退出 / 移除 / 移交 ==========
SELECT throws_ok(
  $$SELECT public.add_workspace_member('63010000-0000-0000-0000-000000000001',
    '63000003-0000-0000-0000-000000000003')$$,
  'not workspace owner',
  'member 不能拉人进空间');

SELECT throws_ok(
  $$SELECT public.update_workspace_member_role('63010000-0000-0000-0000-000000000001',
    '63000002-0000-0000-0000-000000000002', 'member')$$,
  'not workspace owner',
  'member 不能自改成员角色');

SET request.jwt.claim.sub TO '63000001-0000-0000-0000-000000000001';  -- A

SELECT throws_ok(
  $$SELECT public.update_workspace_member_role('63010000-0000-0000-0000-000000000001',
    '63000002-0000-0000-0000-000000000002', 'owner')$$,
  'use transfer_workspace_ownership',
  '不得直接写出第二个 owner 成员（避免双主）');

SELECT throws_ok(
  $$SELECT public.add_workspace_member('63010000-0000-0000-0000-000000000001',
    '63000003-0000-0000-0000-000000000003', 'owner')$$,
  'use transfer_workspace_ownership',
  'add_workspace_member 同样拒绝写 owner');

SELECT throws_ok(
  $$SELECT public.add_workspace_member('63010000-0000-0000-0000-000000000001',
    '63060000-0000-0000-0000-000000000099')$$,
  'user not found',
  '邀请未注册账号被拒（不给 pending 假成功）');

SELECT throws_ok(
  $$SELECT public.transfer_workspace_ownership('63010000-0000-0000-0000-000000000001',
    '63000003-0000-0000-0000-000000000003')$$,
  'new owner must be a member',
  '移交目标必须先是成员');

SELECT throws_ok(
  $$SELECT public.remove_workspace_member('63010000-0000-0000-0000-000000000001',
    '63000001-0000-0000-0000-000000000001')$$,
  'transfer ownership first',
  '属主不能自摘（先移交，否则空间失去控制面）');

SELECT throws_ok(
  $$SELECT public.create_workspace('', '[]'::jsonb)$$,
  'workspace name required',
  '空名空间被拒');

SELECT throws_ok(
  $$SELECT public.create_workspace('产品组',
    '["63000002-0000-0000-0000-000000000002","63060000-0000-0000-0000-000000000099"]'::jsonb)$$,
  'invitee not found',
  'create_workspace 里混入未注册账号 → 整体失败（不留半成品空间）');

SELECT lives_ok(
  $$SELECT public.create_workspace('产品组',
    '["63000002-0000-0000-0000-000000000002"]'::jsonb)$$,
  'create_workspace 正常建空间并拉人');

SELECT is((SELECT count(*) FROM public.workspace_members m
            JOIN public.workspaces w ON w.id = m.workspace_id
           WHERE w.name = '产品组' AND w.kind = 'team'
             AND w.owner_id = '63000001-0000-0000-0000-000000000001'), 2::bigint,
  '新建团队空间里 A=owner、B=member 共两条成员行');

-- ========== 7. 退出空间与移除成员 ==========
SELECT lives_ok(
  $$SELECT public.add_workspace_member('63010000-0000-0000-0000-000000000001',
    '63000003-0000-0000-0000-000000000003', 'guest')$$,
  'A 拉 C 为 W1 guest');

SET request.jwt.claim.sub TO '63000003-0000-0000-0000-000000000003';  -- C

SELECT is(public.resource_role('note', '63020000-0000-0000-0000-000000000001'), 'viewer'::text,
  'C 一进 W1 就继承该空间的 viewer 授权（guest 不额外降权，与 access_role 正交）');

SELECT lives_ok(
  $$SELECT public.remove_workspace_member('63010000-0000-0000-0000-000000000001',
    '63000003-0000-0000-0000-000000000003')$$,
  '成员可自助退出空间');

SELECT is((SELECT count(*) FROM public.workspace_members
            WHERE workspace_id = '63010000-0000-0000-0000-000000000001'
              AND user_id = '63000003-0000-0000-0000-000000000003'), 0::bigint,
  '退出后成员行消失');

SET request.jwt.claim.sub TO '63000002-0000-0000-0000-000000000002';  -- B

SELECT throws_ok(
  $$SELECT public.remove_workspace_member('63010000-0000-0000-0000-000000000001',
    '63000001-0000-0000-0000-000000000001')$$,
  'not workspace owner',
  'member 不能踢属主');

-- ========== 8. 资源控制面：转移与整体回收 ==========
SELECT throws_ok(
  $$SELECT public.transfer_resource_acl('note', '63020000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000002',
    '63010000-0000-0000-0000-000000000001')$$,
  'not resource controller',
  'B（editor）不能搬运 A 的授权');

SET request.jwt.claim.sub TO '63000001-0000-0000-0000-000000000001';  -- A

SELECT throws_ok(
  $$SELECT public.transfer_resource_acl('note', '63020000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000002')$$,
  'target workspace already granted',
  '目标空间已有该资源授权 → 拒绝静默合并，要求先 revoke');

SELECT lives_ok(
  $$SELECT public.grant_resource('reading_item', '63030000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000002', 'editor')$$,
  'A 把文章授权给 W2');

SELECT lives_ok(
  $$SELECT public.transfer_resource_acl('reading_item',
    '63030000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000002',
    '63010000-0000-0000-0000-000000000001')$$,
  'A 把文章的授权从 W2 整体搬到 W1（同一控制者名下的控制面转移）');

SELECT is((SELECT count(*) FROM public.resource_acl
            WHERE resource_id = '63030000-0000-0000-0000-000000000001'
              AND workspace_id = '63010000-0000-0000-0000-000000000002'), 0::bigint,
  '搬走之后 W2 不再持有该授权');

SELECT is((SELECT count(*) FROM public.resource_acl
            WHERE resource_id = '63030000-0000-0000-0000-000000000001'
              AND workspace_id = '63010000-0000-0000-0000-000000000001'), 1::bigint,
  'W1 现在持有该授权（id/created_at 保留，只换 workspace_id）');

SELECT throws_ok(
  $$SELECT public.transfer_resource_acl('reading_item',
    '63030000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000002',
    '63010000-0000-0000-0000-000000000001')$$,
  'grant not found',
  '搬一条不存在的授权 → 明确失败');

SELECT is(public.reclaim_resource('note', '63020000-0000-0000-0000-000000000001'), 2::int,
  'reclaim_resource 一次收回该资源全部授权并返回条数');

SET request.jwt.claim.sub TO '63000002-0000-0000-0000-000000000002';  -- B

SELECT is(public.resource_role('note', '63020000-0000-0000-0000-000000000001') IS NULL, true,
  'reclaim 后 B 立即失权（无需等任何异步收敛）');

-- ========== 9. 移交空间属主后控制面不随空间漂移 ==========
SET request.jwt.claim.sub TO '63000001-0000-0000-0000-000000000001';  -- A（W1 owner）

SELECT lives_ok(
  $$SELECT public.grant_resource('task', '63050000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000001', 'editor')$$,
  'A 把自己的任务授权给 W1');

SELECT lives_ok(
  $$SELECT public.transfer_workspace_ownership('63010000-0000-0000-0000-000000000001',
    '63000002-0000-0000-0000-000000000002')$$,
  'A 把 W1 属主移交给 B');

SELECT is((SELECT owner_id FROM public.workspaces
            WHERE id = '63010000-0000-0000-0000-000000000001'),
  '63000002-0000-0000-0000-000000000002'::uuid, 'workspaces.owner_id 随移交变更');

SELECT is((SELECT role FROM public.workspace_members
            WHERE workspace_id = '63010000-0000-0000-0000-000000000001'
              AND user_id = '63000001-0000-0000-0000-000000000001'), 'member'::text,
  '原属主降为 member');

SELECT is((SELECT count(*) FROM public.workspace_members
            WHERE workspace_id = '63010000-0000-0000-0000-000000000001'
              AND role = 'owner'), 1::bigint,
  '移交后 owner 成员行仍只有一个');

-- 移交空间 ≠ 移交资源：A 仍拥有那条任务 → 仍能收回自己的授权
SELECT lives_ok(
  $$SELECT public.revoke_resource('task', '63050000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000001')$$,
  '空间移交后资源属主仍可收回自己资源的授权（两条控制面互不隶属）');

SET request.jwt.claim.sub TO '63000002-0000-0000-0000-000000000002';  -- B（现在是 W1 owner）

SELECT throws_ok(
  $$SELECT public.grant_resource('task', '63050000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000002', 'owner')$$,
  'not resource controller',
  '空间 owner 也不能把别人资源的授权转授出去（063 取舍 2 的正面对照）');

SET request.jwt.claim.sub TO '63000001-0000-0000-0000-000000000001';  -- A 退出 W1

SELECT lives_ok(
  $$SELECT public.remove_workspace_member('63010000-0000-0000-0000-000000000001',
    '63000001-0000-0000-0000-000000000001')$$,
  '移交完成后 A 可以退出 W1');

-- ========== 10. 业务行硬删不留幽灵授权 ==========
-- 前面各节已把这几条资源的授权 revoke / reclaim 干净，必须先重建真实授权再删，
-- 否则「0 行」断言会在级联触发器无事可做的情况下恒真。
SET ROLE authenticated;
SET request.jwt.claim.sub TO '63000001-0000-0000-0000-000000000001';  -- A（三类资源属主，且仍是 W2 owner）

SELECT lives_ok(
  $$SELECT public.grant_resource('note', '63020000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000002', 'editor')$$,
  '重建：笔记授权给 W2');

SELECT lives_ok(
  $$SELECT public.grant_resource('task', '63050000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000002', 'editor')$$,
  '重建：任务授权给 W2');

SELECT lives_ok(
  $$SELECT public.grant_resource('reading_item', '63030000-0000-0000-0000-000000000001',
    '63010000-0000-0000-0000-000000000002', 'viewer')$$,
  '重建：文章授权给 W2');

RESET ROLE;  -- 级联效果必须以全可见视角统计

SELECT is((SELECT count(*) FROM public.resource_acl
            WHERE workspace_id = '63010000-0000-0000-0000-000000000002'), 3::bigint,
  'W2 此刻确实持有三条授权（后续删除断言的前置条件）');

DELETE FROM public.notes WHERE id = '63020000-0000-0000-0000-000000000001';

SELECT is((SELECT count(*) FROM public.resource_acl
            WHERE resource_id = '63020000-0000-0000-0000-000000000001'), 0::bigint,
  '笔记硬删 → 授权行被级联清掉（不留幽灵授权）');

DELETE FROM public.tasks WHERE id = '63050000-0000-0000-0000-000000000001';

SELECT is((SELECT count(*) FROM public.resource_acl
            WHERE resource_id = '63050000-0000-0000-0000-000000000001'), 0::bigint,
  '任务硬删同样级联清理');

DELETE FROM public.workspaces WHERE id = '63010000-0000-0000-0000-000000000002';

SELECT is((SELECT count(*) FROM public.resource_acl
            WHERE workspace_id = '63010000-0000-0000-0000-000000000002'), 0::bigint,
  '删空间 → 剩余授权行随 FK cascade 消失（文章那条）');

SELECT is((SELECT count(*) FROM public.workspace_members
            WHERE workspace_id = '63010000-0000-0000-0000-000000000002'), 0::bigint,
  '删空间 → 成员行随 FK cascade 消失');

-- ========== 11. EXECUTE 分层 ==========
SELECT is(has_function_privilege('anon', 'resource_role(text,uuid)', 'EXECUTE'), false,
  'anon 不可调用权限判定');
SELECT is(has_function_privilege('authenticated', 'resource_role(text,uuid)', 'EXECUTE'), true,
  'authenticated 可调判定（064 的 RLS 策略要调用）');
SELECT is(has_function_privilege('authenticated', 'grant_resource(text,uuid,uuid,text)', 'EXECUTE'), true,
  'authenticated 可调 grant_resource（客户端经 /api 以用户 session 调用）');
SELECT is(has_function_privilege('authenticated', 'provision_personal_workspace(uuid)', 'EXECUTE'), false,
  '客户端不可直调 provision（它接受任意 user_id）');
SELECT is(has_function_privilege('service_role', 'provision_personal_workspace(uuid)', 'EXECUTE'), true,
  'service_role 可调 provision');
SELECT is(has_function_privilege('authenticated', 'resource_owner(text,uuid)', 'EXECUTE'), false,
  '客户端不可直调 resource_owner（否则成了探测别人资源存在性与归属的 oracle；'
  || '而前述 resource_role 判定照常工作，说明 DEFINER 内部调用不受影响）');
SELECT is(has_function_privilege('anon', 'create_workspace(text,jsonb)', 'EXECUTE'), false,
  'anon 不可建空间');

SELECT * FROM finish();
ROLLBACK;
