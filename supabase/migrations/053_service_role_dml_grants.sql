-- 修复 service_role 表级 DML 权限全面缺失的回归：
-- /api/cron/task-reminders（Web Push 任务提醒）用 service_role 查询
-- task_reminder_deliveries / web_push_subscriptions / tasks，
-- 缺 GRANT 时报 permission denied，提醒全量失败。
-- 后续新表也通过默认权限自动授权（迁移均以 postgres 角色执行）。

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
