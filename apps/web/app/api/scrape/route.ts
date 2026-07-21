import { NextRequest, NextResponse } from "next/server";
import { scrapeUrl } from "@/lib/scraper";

// 内存缓存：避免重复抓取同一 URL（ISR 风格缓存）
const scrapeCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 小时缓存

export async function POST(request: NextRequest) {
  try {
    const { url, force } = await request.json();

    if (!url || typeof url !== "string") {
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
        TIMEOUT: 408,
        HTTP_ERROR: 422,
        FETCH_FAILED: 422,
        PARSE_FAILED: 422,
      };
      return NextResponse.json(
        { error: error.message },
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
