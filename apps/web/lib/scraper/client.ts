// 客户端统一抓取入口：真实模式走 POST /api/scrape（服务端缓存 + 解析），
// mock 后端模式（NEXT_PUBLIC_MOCK_BACKEND=true）本地生成样例文章，
// 让「保存 → 阅读 → 进度/状态/标签」链路在无 Docker/Supabase 的开发机上完整可用。
import type { ScrapeResult } from "@organize/shared";

const MOCK_BACKEND = process.env.NEXT_PUBLIC_MOCK_BACKEND === "true";

function prettyTitleFromUrl(url: string): string {
  try {
    const { pathname, hostname } = new URL(url);
    const segment = pathname.split("/").filter(Boolean).pop();
    // 空路径（裸域名）直接用主机名；扩展名剥离只作用于 slug
    if (!segment) return hostname;
    const text = decodeURIComponent(segment)
      .replace(/\.\w{1,5}$/, "")
      .replace(/[-_+]+/g, " ")
      .trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : hostname;
  } catch {
    return url;
  }
}

function mockScrape(url: string): ScrapeResult {
  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {}
  const title = prettyTitleFromUrl(url);
  const paragraphs = [
    `这是一篇 mock 模式的样例文章：开发环境不发起真实抓取，原文链接 ${url}。`,
    "保存、阅读进度、三态流转、标签与高亮等链路都可以在这份假数据上完整验证。",
    "接真实 Supabase 后端后，同一入口会改为抓取并解析真实正文，保存流程不变。",
  ];
  return {
    url,
    title,
    content: paragraphs.map((p) => `<p>${p}</p>`).join(""),
    excerpt: paragraphs[0],
    cover_image: `https://picsum.photos/seed/${encodeURIComponent(hostname)}/640/360`,
    site_name: hostname,
    author: null,
    published_time: null,
  };
}

/** 抓取失败时抛错，由调用方按「仅存链接」降级（与 /api/scrape 失败语义一致） */
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  if (MOCK_BACKEND) return mockScrape(url);
  const res = await fetch("/api/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error("抓取失败");
  return res.json();
}
