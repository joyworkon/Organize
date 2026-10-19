import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import {
  buildPluginPatch,
  parseJsonBody,
  readPluginDeleteResult,
  readPluginPatchResult,
} from "@/lib/plugin/api-mutation";

// PATCH /api/plugins/[id] - 更新插件配置/状态
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const parsed = parseJsonBody(await request.text());
  if (!parsed.ok) {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const patch = buildPluginPatch(parsed.body);
  if (!patch.ok) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("plugins")
    .update(patch.updateData)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  const outcome = readPluginPatchResult({ data, error });
  if (outcome === "not-found") {
    return NextResponse.json({ error: "插件不存在或无权限" }, { status: 404 });
  }
  if (outcome === "server-error") {
    return serverError(error);
  }

  return NextResponse.json(data);
}

// DELETE /api/plugins/[id] - 卸载插件
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("plugins")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");

  const outcome = readPluginDeleteResult({ data, error });
  if (outcome === "not-found") {
    return NextResponse.json({ error: "插件不存在或已卸载" }, { status: 404 });
  }
  if (outcome === "server-error") {
    return serverError(error);
  }

  return NextResponse.json({ success: true });
}
