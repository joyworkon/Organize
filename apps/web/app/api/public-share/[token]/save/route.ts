import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serverError } from "@/lib/api/error";
import { rateLimit } from "@/lib/api/rate-limit";

const SAVE_RATE_LIMIT = 30; // 每 token+IP 每分钟最多 30 次保存（§6 限流非协商项）
const SAVE_TOKEN_BACKSTOP = 120; // 单 token 每分钟总量兜底（XFF 可伪造，不可只信 IP）
const SAVE_RATE_WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024 + 64 * 1024; // 内容 4MB 上限 + 包装余量（RPC 同口径）

// POST /api/public-share/[token]/save - 匿名可编辑公开链接的快照保存（Track B 072）
//
// 匿名快照保存经此路由而非直暴 RPC：便于按 token+IP 限流与滥用日志。
// 权限完全由 072 的 save_public_note 判（实时读 shares 行，改回只读/关闭即刻断权）；
// 本路由只做限流、入参形状校验与透传，不引入任何额外授权逻辑。
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  if (process.env.NEXT_PUBLIC_MOCK_BACKEND === "true") {
    return NextResponse.json({ error: "mock 后端不支持匿名实时编辑" }, { status: 503 });
  }

  const { token } = await params;
  if (!token || token.length < 16 || token.length > 256) {
    return NextResponse.json({ error: "链接无效" }, { status: 400 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  // XFF 客户端可伪造：IP 档只是细分，另设单 token 总量兜底（RPC 内还有内容护栏）
  if (!rateLimit(`public-save:${token}:${ip ?? "noip"}`, SAVE_RATE_LIMIT, SAVE_RATE_WINDOW_MS)) {
    return NextResponse.json({ error: "保存过于频繁，请稍后再试" }, { status: 429 });
  }
  if (!rateLimit(`public-save-token:${token}`, SAVE_TOKEN_BACKSTOP, SAVE_RATE_WINDOW_MS)) {
    return NextResponse.json({ error: "保存过于频繁，请稍后再试" }, { status: 429 });
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "内容过大" }, { status: 413 });
  }
  const body: unknown = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    typeof (body as { content?: unknown }).content !== "object" ||
    (body as { content?: unknown }).content === null ||
    Array.isArray((body as { content?: unknown }).content)
  ) {
    return NextResponse.json({ error: "content 非法" }, { status: 400 });
  }
  const { content, expected_revision, title } = body as {
    content: unknown;
    expected_revision?: unknown;
    title?: unknown;
  };
  if (
    expected_revision !== undefined &&
    expected_revision !== null &&
    (typeof expected_revision !== "number" ||
      !Number.isInteger(expected_revision) ||
      expected_revision < -2147483648 ||
      expected_revision > 2147483647)
  ) {
    return NextResponse.json({ error: "expected_revision 非法" }, { status: 400 });
  }
  if (
    title !== undefined &&
    title !== null &&
    (typeof title !== "string" || title.length > 255)
  ) {
    return NextResponse.json({ error: "title 非法" }, { status: 400 });
  }

  // 无会话客户端 = anon 角色；save_public_note 是 anon 可调的 DEFINER RPC
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_public_note", {
    p_token: token,
    p_content: content,
    p_expected_note_revision: expected_revision ?? null,
    p_title: typeof title === "string" ? title : null,
  });
  if (error) return serverError(error);

  // 透传 RPC 的 jsonb 结果（ok / forbidden / conflict_note）
  return NextResponse.json(data);
}
