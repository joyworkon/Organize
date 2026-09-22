import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import {
  decodeLibraryCursor,
  encodeLibraryCursor,
  LibraryCursorError,
} from "@/lib/library/cursor";
import type { LibraryItem } from "@organize/shared";

// GET /api/library/items - 资料库统一列表（089 library_items RPC）。
// 阶段 C：稍后读 + 速记统一入口的查询接口，两表不并表（RPC 内 UNION ALL）。
// 参数：view=all|reading|memo（memos 是页面层别名，这里一并兼容）、limit（1–100 缺省 30）、
// cursor（lib/library/cursor.ts 编码的三元组游标，坏游标 400）、
// q（服务端搜索：reading 标题/摘要/正文 + memo 正文）、tags（标签名逗号分隔，任一命中）。
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const params = new URL(request.url).searchParams;

  const viewRaw = params.get("view") ?? "all";
  const view = viewRaw === "memos" ? "memo" : viewRaw;
  if (!["all", "reading", "memo"].includes(view)) {
    return NextResponse.json({ error: "view 无效（all|reading|memo）" }, { status: 400 });
  }

  const limitParam = Number(params.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam >= 1 ? Math.min(limitParam, 100) : 30;

  const q = (params.get("q") ?? "").trim().slice(0, 200) || null;

  const tagsRaw = (params.get("tags") ?? "").trim();
  const tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20)
    : null;

  let cursor = null;
  try {
    cursor = decodeLibraryCursor(params.get("cursor"));
  } catch (error) {
    if (error instanceof LibraryCursorError) {
      return NextResponse.json({ error: `cursor 无效：${error.message}` }, { status: 400 });
    }
    throw error;
  }

  const { data, error } = await supabase.rpc("library_items", {
    p_view: view,
    p_limit: limit,
    p_cursor_created: cursor?.created_at ?? null,
    p_cursor_source: cursor?.source_type ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_q: q,
    p_tags: tags,
  });
  if (error) return serverError(error);

  const items = (data ?? []) as LibraryItem[];
  const last = items[items.length - 1];
  // 满页才给 nextCursor；不满说明已到末尾（RPC limit 语义：limit+1 探测法的廉价替代）
  const nextCursor =
    items.length === limit && last
      ? encodeLibraryCursor({
          created_at: last.created_at,
          source_type: last.source_type,
          id: last.id,
        })
      : null;

  return NextResponse.json({ items, nextCursor });
}
