import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface PushSubscriptionBody {
  endpoint?: unknown;
  keys?: {
    p256dh?: unknown;
    auth?: unknown;
  };
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  let body: PushSubscriptionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "订阅格式无效" }, { status: 400 });
  }
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const authSecret = typeof body.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint.startsWith("https://") || !p256dh || !authSecret) {
    return NextResponse.json({ error: "订阅格式无效" }, { status: 400 });
  }

  const { error } = await supabase.from("web_push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth_secret: authSecret,
      user_agent: request.headers.get("user-agent"),
      disabled_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );
  if (error) {
    console.error("Push subscription save failed:", error.message);
    return NextResponse.json({ error: "订阅保存失败" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  let endpoint = "";
  try {
    const body = (await request.json()) as { endpoint?: unknown };
    endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  } catch {
    return NextResponse.json({ error: "订阅格式无效" }, { status: 400 });
  }
  if (!endpoint) {
    return NextResponse.json({ error: "订阅格式无效" }, { status: 400 });
  }

  const { error } = await supabase
    .from("web_push_subscriptions")
    .update({ disabled_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);
  if (error) {
    return NextResponse.json({ error: "订阅停用失败" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
