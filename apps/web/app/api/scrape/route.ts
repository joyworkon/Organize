import { NextRequest, NextResponse } from "next/server";
import { scrapeUrl } from "@/lib/scraper";
import { createClient } from "@/lib/supabase/server";
import { extractFirstUrl } from "@/lib/inbox/batch-import";

// 内存缓存：避免重复抓取同一 URL（ISR 风格缓存）
const scrapeCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 小时缓存

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "未授权", code: "UNAUTHORIZED" }, { status: 401 });
    }

    const { url: rawUrl, force } = await request.json();
    const url = typeof rawUrl === "string" ? extractFirstUrl(rawUrl) : null;

    if (!url) {
      return NextResponse.json({ error: "无效的 URL" }, { status: 400 });
    }

    // 检查缓存（除非强制刷新）
    if (!force) {
      const cached = scrapeCache.get(url);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return NextResponse.json(cached.data, {
          headers: { "X-Cache": "HIT" },
        });
      }
    }

    const { data, error } = await scrapeUrl(url);

    if (error) {
      const statusMap: Record<string, number> = {
        INVALID_URL: 400,
        URL_BLOCKED: 403,
        DNS_FAILED: 422,
        TIMEOUT: 408,
        HTTP_ERROR: 422,
        FETCH_FAILED: 422,
        PARSE_FAILED: 422,
        TOO_MANY_REDIRECTS: 422,
        TOO_LARGE: 413,
        NON_HTML: 415,
      };
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: statusMap[error.code] || 500 }
      );
    }

    // 写入缓存
    scrapeCache.set(url, { data, timestamp: Date.now() });

    // 定期清理过期缓存
    if (scrapeCache.size > 200) {
      const now = Date.now();
      Array.from(scrapeCache.keys()).forEach((key) => {
        const val = scrapeCache.get(key);
        if (val && now - val.timestamp > CACHE_TTL) scrapeCache.delete(key);
      });
    }

    return NextResponse.json(data, {
      headers: { "X-Cache": "MISS" },
    });
  } catch (error) {
    console.error("Scrape error:", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
