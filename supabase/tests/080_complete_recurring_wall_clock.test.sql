-- 080_complete_recurring_wall_clock.test.sql
-- C05 S3 墙钟推进 pgTAP：跨 DST 保持本地钟点（R1 默认语义）、月末/闰日夹取、
-- null/非法时区回退 033 绝对推进、RPC 端到端（生成+幂等+越权负例）。
BEGIN;
SELECT plan(17);

-- 夹具用户（033 系列约定：固定 UUID + ON CONFLICT 兜底）
DO $$ BEGIN
  INSERT INTO auth.users (id, email) VALUES
    ('80000001-0000-0000-0000-000000000001', 'b080-owner@test'),
    ('80000001-0000-0000-0000-000000000002', 'b080-other@test')
  ON CONFLICT (id) DO NOTHING;
END $$;

INSERT INTO tasks (id, user_id, title, status) VALUES
  ('80001000-0000-0000-0000-000000000001',
   '80000001-0000-0000-0000-000000000001', '墙钟任务', 'todo')
ON CONFLICT (id) DO NOTHING;

-- ========== 1. 纯函数：跨 DST 墙钟保持 ==========
-- 美国东部 2026 春令时 3/8 02:00，秋令时 11/1 02:00

-- daily 春令时：3/7 09:00 EST(-05) → 3/8 仍是 09:00 EDT(-04)（绝对推进会漂成 10:00）
SELECT is(
  (SELECT advance_recurring_wall_clock(
     '2026-03-07 09:00-05'::timestamptz, 'America/New_York', 'daily')),
  ('2026-03-08 09:00'::timestamp AT TIME ZONE 'America/New_York'),
  'daily 春令时次日墙钟 09:00 不漂移'
);

-- daily 秋令时：10/31 09:00 EDT → 11/1 仍是 09:00 EST（绝对推进会漂成 08:00）
SELECT is(
  (SELECT advance_recurring_wall_clock(
     '2026-10-31 09:00-04'::timestamptz, 'America/New_York', 'daily')),
  ('2026-11-01 09:00'::timestamp AT TIME ZONE 'America/New_York'),
  'daily 秋令时次日墙钟 09:00 不漂移'
);

-- weekly 跨春令时：7 个墙钟日
SELECT is(
  (SELECT advance_recurring_wall_clock(
     '2026-03-07 09:00-05'::timestamptz, 'America/New_York', 'weekly')),
  ('2026-03-14 09:00'::timestamp AT TIME ZONE 'America/New_York'),
  'weekly 跨春令时墙钟 09:00 不漂移'
);

-- ========== 2. 纯函数：月末/闰日夹取（naive 日历推进） ==========

SELECT is(
  (SELECT advance_recurring_wall_clock(
     '2027-01-31 09:00-05'::timestamptz, 'America/New_York', 'monthly')),
  ('2027-02-28 09:00'::timestamp AT TIME ZONE 'America/New_York'),
  'monthly 1/31 夹到 2/28 墙钟 09:00'
);

SELECT is(
  (SELECT advance_recurring_wall_clock(
     '2028-02-29 09:00-05'::timestamptz, 'America/New_York', 'yearly')),
  ('2029-02-28 09:00'::timestamp AT TIME ZONE 'America/New_York'),
  'yearly 闰日 2/29 夹到次年 2/28 墙钟 09:00'
);

-- ========== 3. 纯函数：回退信号 ==========

SELECT is(
  (SELECT advance_recurring_wall_clock(
     '2026-03-07 09:00-05'::timestamptz, NULL, 'daily')), NULL::timestamptz,
  'timezone null → null（回退信号）'
);

SELECT is(
  (SELECT advance_recurring_wall_clock(
     '2026-03-07 09:00-05'::timestamptz, 'Not/AZone', 'daily')), NULL::timestamptz,
  '非法时区 → null（回退信号）'
);

SELECT is(
  (SELECT advance_recurring_wall_clock(
     '2026-03-07 09:00-05'::timestamptz, 'America/New_York', 'hourly')), NULL::timestamptz,
  '未知 frequency → null'
);

-- ========== 4. RPC 端到端：墙钟生成 + 幂等 ==========

-- 重复任务：daily、America/New_York、done、3/7 09:00 EST
INSERT INTO tasks (id, user_id, title, status, schedule_start_at, schedule_end_at,
                   timezone, recurrence_rule)
VALUES (
  '80002000-0000-0000-0000-000000000001',
  '80000001-0000-0000-0000-000000000001', '每天站会', 'done',
  '2026-03-07 09:00-05'::timestamptz, '2026-03-07 10:00-05'::timestamptz,
  'America/New_York', '{"frequency":"daily","interval":1}'::jsonb)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  SET ROLE authenticated;
  SET request.jwt.claim.sub = '80000001-0000-0000-0000-000000000001';
END $$;

SELECT is(
  (SELECT complete_recurring_task('80002000-0000-0000-0000-000000000001') IS NOT NULL),
  true, '墙钟重复任务 done → 生成下一条'
);

SELECT is(
  (SELECT schedule_start_at FROM tasks
    WHERE source_id = '80002000-0000-0000-0000-000000000001'),
  ('2026-03-08 09:00'::timestamp AT TIME ZONE 'America/New_York'),
  '生成实例开始时刻 = 次日墙钟 09:00（跨春令时不漂移）'
);

SELECT is(
  (SELECT schedule_end_at FROM tasks
    WHERE source_id = '80002000-0000-0000-0000-000000000001'),
  ('2026-03-08 10:00'::timestamp AT TIME ZONE 'America/New_York'),
  '生成实例结束时刻 = 次日墙钟 10:00（end_at 同步墙钟推进）'
);

SELECT is(
  (SELECT timezone FROM tasks
    WHERE source_id = '80002000-0000-0000-0000-000000000001'),
  'America/New_York',
  '生成实例沿用任务时区'
);

SELECT is(
  (SELECT complete_recurring_task('80002000-0000-0000-0000-000000000001') IS NULL)::int,
  1, 'RPC 幂等：第二次调用返回 null'
);

DO $$ BEGIN RESET ROLE; END $$;

-- ========== 5. RPC 回退：null 时区保持 033 绝对推进 ==========

INSERT INTO tasks (id, user_id, title, status, schedule_start_at, timezone, recurrence_rule)
VALUES (
  '80002000-0000-0000-0000-000000000002',
  '80000001-0000-0000-0000-000000000001', '无时区重复任务', 'done',
  '2026-03-07 09:00-05'::timestamptz, NULL, '{"frequency":"daily","interval":1}'::jsonb)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  SET ROLE authenticated;
  SET request.jwt.claim.sub = '80000001-0000-0000-0000-000000000001';
END $$;

SELECT is(
  (SELECT complete_recurring_task('80002000-0000-0000-0000-000000000002') IS NOT NULL),
  true, 'null 时区重复任务 done → 生成下一条（回退路径可用）'
);

SELECT is(
  (SELECT schedule_start_at FROM tasks
    WHERE source_id = '80002000-0000-0000-0000-000000000002'),
  ('2026-03-07 09:00-05'::timestamptz + interval '1 day'),
  'null 时区回退绝对推进：次日 = UTC 时刻 +1 天（033 原语义）'
);

DO $$ BEGIN RESET ROLE; END $$;

-- ========== 6. 越权负例：非属主调用不生成 ==========

DO $$
BEGIN
  SET ROLE authenticated;
  SET request.jwt.claim.sub = '80000001-0000-0000-0000-000000000002';
END $$;

SELECT is(
  (SELECT complete_recurring_task('80002000-0000-0000-0000-000000000001') IS NULL)::int,
  1, '非属主调用返回 null'
);

SELECT is(
  (SELECT count(*)::int FROM tasks
    WHERE series_id = '80002000-0000-0000-0000-000000000001'
      AND source_id <> '80002000-0000-0000-0000-000000000001'
      AND user_id = '80000001-0000-0000-0000-000000000002'),
  0, '非属主调用不产生任何行'
);

DO $$ BEGIN RESET ROLE; END $$;

SELECT * FROM finish();
ROLLBACK;
