import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveOEmbed, type OEmbedErrorCode } from "@/lib/oembed";

// 内存缓存（ISR 风格，与 /api/scrape 一致）
const oembedCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 小时

const STATUS_MAP: Record<OEmbedErrorCode, number> = {
  INVALID_URL: 400,
  URL_BLOCKED: 403,
  DNS_FAILED: 422,
  TIMEOUT: 408,
  HTTP_ERROR: 422,
  FETCH_FAILED: 422,
  TOO_MANY_REDIRECTS: 422,
  TOO_LARGE: 413,
  NON_HTML: 415,
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "未授权", code: "UNAUTHORIZED" }, { status: 401 });
    }

    const { url, force } = await request.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "无效的 URL", code: "INVALID_URL" }, { status: 400 });
    }

    if (!force) {
      const cached = oembedCache.get(url);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return NextResponse.json(cached.data, { headers: { "X-Cache": "HIT" } });
      }
    }

    const { data, error } = await resolveOEmbed(url);
    if (error) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: STATUS_MAP[error.code] || 500 }
      );
    }

    oembedCache.set(url, { data, timestamp: Date.now() });
    if (oembedCache.size > 200) {
      const now = Date.now();
      Array.from(oembedCache.keys()).forEach((key) => {
        const val = oembedCache.get(key);
        if (val && now - val.timestamp > CACHE_TTL) oembedCache.delete(key);
      });
    }

    return NextResponse.json(data, { headers: { "X-Cache": "MISS" } });
  } catch (error) {
    console.error("oEmbed error:", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
