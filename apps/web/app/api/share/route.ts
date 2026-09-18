import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { generateToken } from "@/lib/share/token";
import type { ShareResourceType } from "@organize/shared";

/** 082/084 分享设置的读写列（POST 复用 / GET 返回 / PATCH 更新共用一份） */
const SHARE_COLUMNS =
  "id, token, is_public, expires_at, access_mode, session_limit, ip_limit, spread_alert_enabled, created_at";

/** 档位上限：超过这个数量已无「防扩散」意义，只防住手滑填出天文数字 */
const LIMIT_MAX = 1000;

interface LimitField {
  /** 请求体是否显式带了这个字段（PATCH 的「不改」与「清成不限」靠它区分） */
  present: boolean;
  value: number | null;
  valid: boolean;
}

/**
 * 解析名额/IP 档位（082）：未带 = 不改；null = 不限；>=1 的整数 = 设档。
 * 0/负数/小数/超上限一律非法——0 的语义是「谁也进不来」，那是撤销分享该干的事，
 * 不该用「名额」表达（DB 侧 shares_session_limit_bounds 是同一口径的第二道）。
 */
function readLimitField(raw: unknown): LimitField {
  if (raw === undefined) return { present: false, value: null, valid: true };
  if (raw === null) return { present: true, value: null, valid: true };
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= LIMIT_MAX) {
    return { present: true, value: raw, valid: true };
  }
  return { present: true, value: null, valid: false };
}

const LIMIT_INVALID_MESSAGE = `名额 / IP 上限必须是 1-${LIMIT_MAX} 的整数，或 null 表示不限`;
/** ip_limit 单独存在是死配置：没有认领就没有「把 IP 钉进白名单」这个动作 */
const IP_LIMIT_NEEDS_SESSION_MESSAGE = "IP 上限必须与名额上限同时设置";

// POST /api/share - 创建分享
// body: { resource_type: "note" | "reading_item", resource_id: string,
//         expires_at?: string, access_mode?: "public_read" | "public_edit" }
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const resourceType = body?.resource_type as ShareResourceType;
  const resourceId: string | undefined = body?.resource_id;
  const expiresAt: string | null = body?.expires_at ?? null;
  // 072：三态公开链接。创建时只接受两种公开态（disabled = 不创建），
  // 改模式走 PATCH。
  const accessMode =
    body?.access_mode === "public_edit" ? "public_edit" : "public_read";
  // 082 访问限制（可选）：不传 = 不限（存量语义）
  const sessionLimit = readLimitField(body?.session_limit);
  const ipLimit = readLimitField(body?.ip_limit);

  if (!resourceId) {
    return NextResponse.json({ error: "缺少 resource_id" }, { status: 400 });
  }
  if (!sessionLimit.valid || !ipLimit.valid) {
    return NextResponse.json({ error: LIMIT_INVALID_MESSAGE }, { status: 400 });
  }
  if (ipLimit.value !== null && sessionLimit.value === null) {
    return NextResponse.json({ error: IP_LIMIT_NEEDS_SESSION_MESSAGE }, { status: 400 });
  }
  if (resourceType !== "note" && resourceType !== "reading_item") {
    return NextResponse.json({ error: "resource_type 非法" }, { status: 400 });
  }

  // 校验资源归属当前用户
  const table = resourceType === "note" ? "notes" : "reading_items";
  const { data: resource, error: resourceErr } = await supabase
    .from(table)
    .select("id, user_id")
    .eq("id", resourceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (resourceErr || !resource) {
    return NextResponse.json({ error: "资源不存在或无权分享" }, { status: 404 });
  }

  // 已存在该资源的公开分享则复用（避免生成一堆 token）
  const { data: existing } = await supabase
    .from("shares")
    .select(SHARE_COLUMNS)
    .eq("owner_id", user.id)
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .maybeSingle();

  if (existing) {
    // 复用同一 (owner, resource) 的分享行；请求显式带了合法值且与现存不同时，
    // 以请求为准对齐（否则 POST public_edit 会拿回 disabled/只读旧行）
    const patch: Record<string, unknown> = {};
    if (
      (body?.access_mode === "public_read" || body?.access_mode === "public_edit") &&
      existing.access_mode !== accessMode
    ) {
      // accessMode 归一化后只会是 public_read/public_edit，is_public 必为 true
      patch.access_mode = accessMode;
      patch.is_public = true;
    }
    if (sessionLimit.present && existing.session_limit !== sessionLimit.value) {
      patch.session_limit = sessionLimit.value;
    }
    if (ipLimit.present && existing.ip_limit !== ipLimit.value) {
      patch.ip_limit = ipLimit.value;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({
        ...existing,
        url: `/s/${existing.token}`,
      });
    }
    // 跨字段一致性：按改完之后的组合判——把 session_limit 清成不限却留着 ip_limit
    // 会让 DB 约束报错（500），这里提前给 400
    const nextSession =
      patch.session_limit !== undefined
        ? (patch.session_limit as number | null)
        : existing.session_limit;
    const nextIp =
      patch.ip_limit !== undefined ? (patch.ip_limit as number | null) : existing.ip_limit;
    if (nextIp !== null && nextSession === null) {
      return NextResponse.json({ error: IP_LIMIT_NEEDS_SESSION_MESSAGE }, { status: 400 });
    }
    const { data: updated, error: patchErr } = await supabase
      .from("shares")
      .update(patch)
      .eq("id", existing.id)
      .eq("owner_id", user.id)
      .select(SHARE_COLUMNS)
      .single();
    if (patchErr) return serverError(patchErr);
    return NextResponse.json({ ...updated, url: `/s/${updated.token}` });
  }

  const token = generateToken();
  const { data, error } = await supabase
    .from("shares")
    .insert({
      owner_id: user.id,
      resource_type: resourceType,
      resource_id: resourceId,
      token,
      is_public: true,
      expires_at: expiresAt,
      access_mode: accessMode,
      session_limit: sessionLimit.value,
      ip_limit: ipLimit.value,
    })
    .select(SHARE_COLUMNS)
    .single();

  if (error) {
    return serverError(error);
  }

  return NextResponse.json({ ...data, url: `/s/${data.token}` }, { status: 201 });
}

// GET /api/share?resource_type=note&resource_id=xxx - 查询某资源的分享状态
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const resourceType = searchParams.get("resource_type") as ShareResourceType;
  const resourceId = searchParams.get("resource_id");

  if (!resourceId || (resourceType !== "note" && resourceType !== "reading_item")) {
    return NextResponse.json({ error: "参数非法" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("shares")
    .select(SHARE_COLUMNS)
    .eq("owner_id", user.id)
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .maybeSingle();

  if (error) {
    return serverError(error);
  }

  if (!data) return NextResponse.json(null);
  return NextResponse.json({ ...data, url: `/s/${data.token}` });
}

// PATCH /api/share - 更新分享模式/过期时间（072 可编辑公开链接）
// body: { token } 或 { resource_type, resource_id }，加 access_mode 和/或 expires_at
// access_mode 与 is_public 成对写入，维持 072 的一致性约束（disabled ↔ not is_public）
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const token: string | undefined = body?.token;
  const resourceType = body?.resource_type as ShareResourceType | undefined;
  const resourceId: string | undefined = body?.resource_id;

  if (!token && !(resourceId && (resourceType === "note" || resourceType === "reading_item"))) {
    return NextResponse.json(
      { error: "需要提供 token 或 (resource_type + resource_id)" },
      { status: 400 }
    );
  }
  if (
    body?.access_mode !== undefined &&
    body.access_mode !== "disabled" &&
    body.access_mode !== "public_read" &&
    body.access_mode !== "public_edit"
  ) {
    return NextResponse.json({ error: "access_mode 非法" }, { status: 400 });
  }
  if (
    body?.expires_at !== undefined &&
    body.expires_at !== null &&
    (typeof body.expires_at !== "string" || Number.isNaN(Date.parse(body.expires_at)))
  ) {
    return NextResponse.json({ error: "expires_at 非法" }, { status: 400 });
  }
  // 082 访问限制（可选）：显式传 null = 清成不限，不传 = 不动
  const sessionLimit = readLimitField(body?.session_limit);
  const ipLimit = readLimitField(body?.ip_limit);
  if (!sessionLimit.valid || !ipLimit.valid) {
    return NextResponse.json({ error: LIMIT_INVALID_MESSAGE }, { status: 400 });
  }
  // 084 扩散告警开关（可选）
  const spreadAlert = body?.spread_alert_enabled;
  if (spreadAlert !== undefined && typeof spreadAlert !== "boolean") {
    return NextResponse.json({ error: "spread_alert_enabled 必须是布尔值" }, { status: 400 });
  }
  if (
    body?.access_mode === undefined &&
    body?.expires_at === undefined &&
    spreadAlert === undefined &&
    !sessionLimit.present &&
    !ipLimit.present
  ) {
    return NextResponse.json({ error: "缺少要更新的字段" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.access_mode !== undefined) {
    updates.access_mode = body.access_mode;
    // 一致性约束（072）：disabled 必须同时关掉 is_public，公开态必须 is_public=true
    updates.is_public = body.access_mode !== "disabled";
  }
  if (body.expires_at !== undefined) {
    updates.expires_at = body.expires_at;
  }
  if (sessionLimit.present) updates.session_limit = sessionLimit.value;
  if (ipLimit.present) updates.ip_limit = ipLimit.value;
  if (spreadAlert !== undefined) updates.spread_alert_enabled = spreadAlert;

  // 先定位目标行：跨字段一致性（ip_limit 不能单独存在）要拿改完之后的组合判，
  // 只看请求体判不出「把 session_limit 清成不限却留着 ip_limit」这种组合
  let locate = supabase.from("shares").select("id, session_limit, ip_limit").eq("owner_id", user.id);
  locate = token
    ? locate.eq("token", token)
    : locate.eq("resource_type", resourceType).eq("resource_id", resourceId);
  const { data: current, error: locateErr } = await locate.maybeSingle();
  if (locateErr) return serverError(locateErr);
  if (!current) return NextResponse.json({ error: "分享不存在或无权修改" }, { status: 404 });

  const nextSession =
    updates.session_limit !== undefined
      ? (updates.session_limit as number | null)
      : current.session_limit;
  const nextIp =
    updates.ip_limit !== undefined ? (updates.ip_limit as number | null) : current.ip_limit;
  if (nextIp !== null && nextSession === null) {
    return NextResponse.json({ error: IP_LIMIT_NEEDS_SESSION_MESSAGE }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("shares")
    .update(updates)
    .eq("id", current.id)
    .eq("owner_id", user.id)
    .select(SHARE_COLUMNS)
    .single();
  if (error) return serverError(error);

  return NextResponse.json({ ...data, url: `/s/${data.token}` });
}

// DELETE /api/share - 撤销分享
// body: { resource_type, resource_id } 或 { token }
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = await request.json();
  const resourceType = body?.resource_type as ShareResourceType | undefined;
  const resourceId: string | undefined = body?.resource_id;
  const token: string | undefined = body?.token;

  let query = supabase.from("shares").delete().eq("owner_id", user.id);

  if (token) {
    query = query.eq("token", token);
  } else if (resourceId && (resourceType === "note" || resourceType === "reading_item")) {
    query = query.eq("resource_type", resourceType).eq("resource_id", resourceId);
  } else {
    return NextResponse.json({ error: "需要提供 token 或 (resource_type + resource_id)" }, { status: 400 });
  }

  const { data, error } = await query.select("access_mode");
  if (error) return serverError(error);

  return NextResponse.json({ success: true, access_mode: data?.[0]?.access_mode ?? null });
}
