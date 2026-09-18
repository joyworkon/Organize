import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { isPermanentlyGonePushStatus } from "@/lib/tasks/push-delivery";

/**
 * 分享扩散告警（084）。
 *
 * 属主在分享面板主动开启后，当一条受限链接出现「大量被拒的进入尝试」时推送提醒。
 * 判据是 082 名额闸门产生的 `denied_no_quota` / `denied_ip` —— 正常使用时一条
 * 定向链接只有收件人一台设备进来，不会有第二条拒绝；一旦稳定出现拒绝，基本就是
 * 链接被传出去了。
 *
 * 认领语义（for update skip locked + 就地打水位）在 084 的 claim_spread_alerts 里；
 * 本路由只负责「认领 → 查属主订阅 → 推送」，不含任何判定逻辑。
 */
export const dynamic = "force-dynamic";

interface SpreadAlert {
  share_id: string;
  owner_id: string;
  resource_type: string;
  resource_id: string;
  denied_count: number;
  distinct_ips: number;
}

interface PushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
}

function resourceUrl(resourceType: string, resourceId: string): string {
  return resourceType === "reading_item" ? `/library/${resourceId}` : `/notes/${resourceId}`;
}

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
    return NextResponse.json({ error: "推送服务未配置" }, { status: 503 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.rpc("claim_spread_alerts", {
    p_limit: 50,
    p_min_denials: 5,
    p_window: "1 hour",
  });
  if (error) {
    console.error("Spread alert claim failed:", error.message);
    return NextResponse.json({ error: "告警领取失败" }, { status: 500 });
  }

  const alerts = (data || []) as SpreadAlert[];
  let sent = 0;
  let skippedNoSubscription = 0;
  let failed = 0;

  for (const alert of alerts) {
    // 属主可能没开浏览器通知（或换过设备）——查不到订阅不是错误，跳过即可。
    // 注意：水位已在 claim 时打过，这里跳过等于这一次不再提醒（可接受：
    // 没有可投递的通道，重试也没有意义）
    const { data: subs } = await admin
      .from("web_push_subscriptions")
      .select("id, endpoint, p256dh, auth_secret")
      .eq("user_id", alert.owner_id)
      .is("disabled_at", null);

    const subscriptions = (subs || []) as PushSubscription[];
    if (subscriptions.length === 0) {
      skippedNoSubscription += 1;
      continue;
    }

    const payload = JSON.stringify({
      title: "分享链接可能被扩散",
      // 数字如实给出：这条链接有 N 次进入被挡、来自 M 个网络。
      // 不写「有 M 个人想进来」——IP 不等于人（见面板同名说明）
      body: `最近 1 小时有 ${alert.denied_count} 次进入被门控挡下，来自 ${alert.distinct_ips} 个网络。若不是你本人转发，链接可能已经传出去了。`,
      tag: `share-spread-${alert.share_id}`,
      url: resourceUrl(alert.resource_type, alert.resource_id),
    });

    // 一个属主可能有多台设备订阅：任一成功即算送达
    let anySent = false;
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } },
          payload,
          { TTL: 86400, urgency: "high" }
        );
        anySent = true;
      } catch (sendError) {
        const statusCode =
          typeof sendError === "object" && sendError && "statusCode" in sendError
            ? Number(sendError.statusCode)
            : 0;
        if (isPermanentlyGonePushStatus(statusCode)) {
          // 订阅已失效（卸载/清数据）：停用它，避免后续每次都白打
          await admin
            .from("web_push_subscriptions")
            .update({ disabled_at: new Date().toISOString() })
            .eq("id", sub.id);
        }
        console.error("Spread alert push failed:", statusCode);
      }
    }
    if (anySent) sent += 1;
    else failed += 1;
  }

  // 心跳字段供调度侧观测（与 task-reminders 同口径）
  return NextResponse.json({
    claimed: alerts.length,
    sent,
    skippedNoSubscription,
    failed,
  });
}
