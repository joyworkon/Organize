import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/039_reliable_task_reminders.sql"),
  "utf8"
);

describe("migration 039: reliable task reminders", () => {
  it("为每个订阅建立唯一、可重试的投递记录", () => {
    expect(sql).toContain("create table if not exists public.web_push_subscriptions");
    expect(sql).toContain("create table if not exists public.task_reminder_deliveries");
    expect(sql).toContain("unique (reminder_id, subscription_id, scheduled_for)");
    expect(sql).toContain("attempt_count integer not null default 0");
    expect(sql).toContain("next_attempt_at timestamptz");
  });

  it("并发领取使用行锁并回收卡住的发送任务", () => {
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("delivery.status = 'sending'");
    expect(sql).toContain("delivery.updated_at < now() - interval '5 minutes'");
    expect(sql).toContain("delivery.attempt_count < 6");
    expect(sql).toMatch(
      /join public\.web_push_subscriptions active_subscription[\s\S]*active_subscription\.disabled_at is null[\s\S]*for update skip locked/
    );
  });

  it("任务或提醒改期后只重置未发送投递", () => {
    expect(sql).toContain("before update of anchor, offset_minutes");
    expect(sql).toContain("after update of schedule_start_at, schedule_end_at, status, deleted_at");
    expect(sql).toContain("delivery.status <> 'sent'");
  });

  it("仅允许 service role 领取，用户只能读取自己的投递", () => {
    expect(sql).toContain("using (auth.uid() = user_id)");
    expect(sql).toContain("reminder.user_id = auth.uid()");
    expect(sql).toContain("revoke all on function public.claim_due_task_reminder_deliveries(integer) from public");
    expect(sql).toContain("grant execute on function public.claim_due_task_reminder_deliveries(integer) to service_role");
  });
});
