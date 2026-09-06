import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { parseMemoTags } from "@/lib/memos/tags";

// GET /api/memos - 列出速记（软删除外，created_at 倒序稳定游标分页）。
// F04：?tag= 筛选、?limit=（1–500）、?before=<ISO created_at> 取更早一页；
// 响应头 X-Total-Count 返回该筛选下的全量条数（前端「共 N 条 / 加载更多」不再依赖被截断的数据）。
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const tag = params.get("tag");
  const before = params.get("before");
  // 刘海面板等轻量调用方只取最近几条；1–500 内取整，非法值回落全量上限
  const limitParam = Number(params.get("limit"));
  const limit =
    Number.isInteger(limitParam) && limitParam >= 1 ? Math.min(limitParam, 500) : 500;

  let query = supabase
    .from("memos")
    .select("*")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false }) // created_at 同值的稳定次序，游标不重不漏
    .limit(limit);
  if (tag) query = query.contains("tags", [tag]);
  if (before) {
    const ts = new Date(before);
    if (Number.isNaN(ts.getTime())) {
      return NextResponse.json({ error: "before 无效" }, { status: 400 });
    }
    query = query.lt("created_at", ts.toISOString());
  }

  const { data, error, count } = await query;
  if (error) return serverError(error);

  // 全量计数（与筛选条件一致；不带 limit）——用于总数展示与「加载更多」判定
  let countQuery = supabase
    .from("memos")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("deleted_at", null);
  if (tag) countQuery = countQuery.contains("tags", [tag]);
  const { count: total } = await countQuery;

  return new NextResponse(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Total-Count": String(total ?? data?.length ?? 0),
    },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/memos - 新建速记（body: { content, id? }，#标签 由服务端解析）。
// F02 幂等合同：客户端可携带显式 uuid id（离线队列回放用），主键冲突时
// 返回既有行（200）而非报错，同一内容不会被重复插入。
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const body = await request.json();
  const content = String(body?.content || "").trim();
  if (!content || content.length > 5000) {
    return NextResponse.json({ error: "内容无效（1-5000 字）" }, { status: 400 });
  }
  const explicitId = typeof body?.id === "string" && body.id.trim() ? body.id.trim() : null;
  if (explicitId && !UUID_RE.test(explicitId)) {
    return NextResponse.json({ error: "id 无效" }, { status: 400 });
  }

  const insert = async (id: string | null) => {
    const payload: Record<string, unknown> = {
      user_id: user.id,
      content,
      tags: parseMemoTags(content),
    };
    if (id) payload.id = id;
    return supabase
      .from("memos")
      .insert(payload)
      .select()
      .single();
  };

  if (explicitId) {
    const { data, error } = await insert(explicitId);
    if (!error) return NextResponse.json(data, { status: 201 });
    // 主键冲突 = 该 id 已创建过（重放/重复提交）：返回既有行，语义为幂等成功
    if ((error as { code?: string }).code === "23505") {
      const { data: existing } = await supabase
        .from("memos")
        .select("*")
        .eq("id", explicitId)
        .single();
      if (existing) return NextResponse.json(existing);
    }
    return serverError(error);
  }

  const { data, error } = await insert(null);
  if (error) return serverError(error);
  return NextResponse.json(data, { status: 201 });
}
