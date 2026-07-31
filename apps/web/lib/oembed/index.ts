import * as cheerio from "cheerio";
import { matchProvider, type EmbedResult } from "./providers";
import { safeFetchHtml, SafeFetchError, type SafeFetchErrorCode } from "@/lib/scraper/safe-fetch";

export interface OEmbedResponse {
  url: string;
  kind: "embed" | "link-card";
  provider?: string;
  title: string;
  description?: string;
  /** embed：iframe/html 片段；link-card：null（用 title/cover 渲染卡片） */
  html?: string;
  sandbox?: string;
  cover?: string | null;
  siteName?: string;
}

export type OEmbedErrorCode = SafeFetchErrorCode | "INVALID_URL";

export class OEmbedError extends Error {
  constructor(public readonly code: OEmbedErrorCode, message: string) {
    super(message);
    this.name = "OEmbedError";
  }
}

const FETCH_TIMEOUT = 12_000;
const USER_AGENT = "Organize/1.0 (+https://github.com/joyworkon/Organize; oembed reader)";

/**
 * 解析 URL 的嵌入信息：
 * 1. 先试内置 provider 白名单（YouTube/Bilibili/地图等），命中直接返回 iframe embed
 * 2. 否则抓取目标页 OG 标签，回退为链接卡片
 */
export async function resolveOEmbed(rawUrl: string): Promise<{ data: OEmbedResponse | null; error: OEmbedError | null }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { data: null, error: new OEmbedError("INVALID_URL", "无效的 URL") };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { data: null, error: new OEmbedError("INVALID_URL", "仅支持 http/https 链接") };
  }

  // 1. 白名单 provider
  const matched = matchProvider(rawUrl);
  if (matched) {
    return {
      data: {
        url: rawUrl,
        kind: "embed",
        provider: matched.provider,
        title: matched.title || matched.provider,
        html: matched.html,
        sandbox: matched.sandbox,
      },
      error: null,
    };
  }

  // 2. 回退：抓 OG 标签生成链接卡片
  try {
    const { html, finalUrl } = await safeFetchHtml(rawUrl, {
      timeout: FETCH_TIMEOUT,
      userAgent: USER_AGENT,
      maxBytes: 2 * 1024 * 1024,
    });
    const card = parseLinkCard(html, finalUrl);
    return { data: { ...card, url: rawUrl, kind: "link-card" }, error: null };
  } catch (error) {
    if (error instanceof SafeFetchError) {
      return { data: null, error: new OEmbedError(error.code, error.message) };
    }
    return { data: null, error: new OEmbedError("FETCH_FAILED", "无法获取页面内容") };
  }
}

/** 从 HTML 抓取 OG 标签构造链接卡片（不依赖网络，可单测）。 */
export function parseLinkCard(html: string, url: URL): Omit<OEmbedResponse, "url" | "kind"> {
  const $ = cheerio.load(html);
  const og = (prop: string) => $(`meta[property='${prop}']`).attr("content") || "";
  const title = og("og:title") || $("title").first().text().trim() || url.hostname;
  const description = og("og:description") || $("meta[name='description']").attr("content") || "";
  const cover = og("og:image") || $("meta[name='twitter:image']").attr("content") || null;
  const siteName = og("og:site_name") || url.hostname;
  return { title, description: description || undefined, cover, siteName };
}
