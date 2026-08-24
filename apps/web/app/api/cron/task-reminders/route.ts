import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

interface ReminderDelivery {
  delivery_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  task_id: string;
  task_title: string;
  anchor: "start" | "end";
  scheduled_for: string;
  attempt_count: number;
}

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!supabaseUrl || !serviceRoleKey || !publicKey || !privateKey || !subject) {
    return NextResponse.json({ error: "提醒服务未配置" }, { status: 503 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("claim_due_task_reminder_deliveries", {
    p_limit: 100,
  });
  if (error) {
    console.error("Reminder claim failed:", error.message);
    return NextResponse.json({ error: "提醒领取失败" }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  await Promise.all(
    ((data || []) as ReminderDelivery[]).map(async (delivery) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: delivery.endpoint,
            keys: {
              p256dh: delivery.p256dh,
              auth: delivery.auth_secret,
            },
          },
          JSON.stringify({
            title: delivery.task_title,
            body: delivery.anchor === "end" ? "任务即将到期" : "任务即将开始",
            tag: `task-reminder-${delivery.delivery_id}`,
            url: `/tasks/${delivery.task_id}`,
          }),
          { TTL: 86400, urgency: "high" }
        );
        sent += 1;
        await admin
          .from("task_reminder_deliveries")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", delivery.delivery_id);
      } catch (sendError) {
        failed += 1;
        const statusCode =
          typeof sendError === "object" && sendError && "statusCode" in sendError
            ? Number(sendError.statusCode)
            : 0;
        const permanentlyGone = statusCode === 404 || statusCode === 410;
        if (permanentlyGone) {
          await admin
            .from("web_push_subscriptions")
            .update({ disabled_at: new Date().toISOString() })
            .eq("id", delivery.subscription_id);
        }
        const retryMinutes = Math.min(60, 2 ** delivery.attempt_count);
        await admin
          .from("task_reminder_deliveries")
          .update({
            status: "failed",
            next_attempt_at: permanentlyGone
              ? null
              : new Date(Date.now() + retryMinutes * 60_000).toISOString(),
            error: sendError instanceof Error ? sendError.message.slice(0, 500) : "发送失败",
            updated_at: new Date().toISOString(),
          })
          .eq("id", delivery.delivery_id);
      }
    })
  );

  return NextResponse.json({ claimed: data?.length || 0, sent, failed });
}
