import { NextRequest, NextResponse } from "next/server";
import {
  parseTrashMutation,
  TRASH_RESOURCE_TYPES,
  type TrashResourceType,
} from "@/lib/trash/contracts";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "未授权", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const requestedType = new URL(request.url).searchParams.get("resource_type");
  if (
    requestedType !== null &&
    !TRASH_RESOURCE_TYPES.includes(requestedType as TrashResourceType)
  ) {
    return NextResponse.json(
      { error: "资源类型无效", code: "INVALID_RESOURCE_TYPE" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("list_trash", {
    p_resource_type: requestedType,
  });
  if (error) {
    console.error("Trash listing failed:", error.message);
    return NextResponse.json(
      { error: "无法读取垃圾箱", code: "TRASH_READ_FAILED" },
      { status: 500 }
    );
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "未授权", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "请求格式无效", code: "INVALID_TRASH_MUTATION" },
      { status: 400 }
    );
  }
  const mutation = parseTrashMutation(body);
  if (!mutation) {
    return NextResponse.json(
      { error: "垃圾箱操作无效", code: "INVALID_TRASH_MUTATION" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("mutate_trash", {
    p_action: mutation.action,
    p_resource_type: mutation.resourceType,
    p_ids: mutation.ids,
  });
  if (error) {
    console.error("Trash mutation failed:", error.message);
    return NextResponse.json(
      { error: "垃圾箱操作失败", code: "TRASH_MUTATION_FAILED" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    affected: typeof data === "number" ? data : 0,
  });
}
