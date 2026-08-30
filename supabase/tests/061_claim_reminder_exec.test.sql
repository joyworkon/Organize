-- 061 claim_due_task_reminder_deliveries 执行型 pgTAP（P2-03）
-- 覆盖：带数据真实执行函数体——到期领取、返回字段、领取后标记已通知、
-- 二次领取为空（ON CONFLICT 去重 + 状态机幂等）。
-- 背景：039 的 RETURNS TABLE OUT 参数 subscription_id 与函数体内
-- ON CONFLICT 目标列同名，云库执行报 42702；061 迁移以
-- #variable_conflict use_column 修复，本测试防止回归。
BEGIN;
SELECT plan(6);

DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('61300001-0000-0000-0000-000000000001', 'p203_claim@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- 到期任务（5 分钟前开始）+ 提醒 + Push 订阅
INSERT INTO tasks (id, user_id, title, status, schedule_start_at) VALUES
  ('61310000-0000-0000-0000-000000000001',
   '61300001-0000-0000-0000-000000000001',
   '提醒任务', 'todo', now() - interval '5 minutes');
INSERT INTO task_reminders (id, user_id, task_id, anchor, offset_minutes) VALUES
  ('61320000-0000-0000-0000-000000000001',
   '61300001-0000-0000-0000-000000000001',
   '61310000-0000-0000-0000-000000000001',
   'start', 0);
INSERT INTO web_push_subscriptions (id, user_id, endpoint, p256dh, auth_secret) VALUES
  ('61330000-0000-0000-0000-000000000001',
   '61300001-0000-0000-0000-000000000001',
   'https://push.example/ep-61', 'p256-61', 'auth-61');

-- 生产唯一调用方是 service_role（056 权限矩阵），以该角色执行
SET ROLE service_role;

CREATE TEMP TABLE t061_claim1 AS
  SELECT * FROM public.claim_due_task_reminder_deliveries(10);

SELECT is(
  (SELECT count(*) FROM t061_claim1), 1::bigint,
  '首次领取得到 1 条到期投递'
);
SELECT is(
  (SELECT task_title FROM t061_claim1), '提醒任务',
  '领取结果返回任务标题'
);
SELECT is(
  (SELECT anchor FROM t061_claim1), 'start',
  '领取结果返回锚点'
);
SELECT is(
  (SELECT endpoint FROM t061_claim1), 'https://push.example/ep-61',
  '领取结果返回订阅 endpoint'
);
SELECT isnt(
  (SELECT notified_at FROM public.task_reminders
    WHERE id = '61320000-0000-0000-0000-000000000001'),
  NULL,
  '领取后提醒被标记已通知'
);

CREATE TEMP TABLE t061_claim2 AS
  SELECT * FROM public.claim_due_task_reminder_deliveries(10);
SELECT is(
  (SELECT count(*) FROM t061_claim2), 0::bigint,
  '重复领取为空（ON CONFLICT 去重与领取状态机生效）'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
