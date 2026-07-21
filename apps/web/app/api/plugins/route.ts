import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/plugins - 获取用户插件列表
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("plugins")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST /api/plugins - 注册/安装插件
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const { name, package_name, version, config } = body;

  if (!name || !package_name) {
    return NextResponse.json(
      { error: "name 和 package_name 为必填项" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("plugins")
    .upsert(
      {
        user_id: user.id,
        name,
        package_name,
        version: version || null,
        config: config || {},
        enabled: true,
      },
      { onConflict: "user_id,package_name" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
