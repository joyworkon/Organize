import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import type { ScrapeResult } from "@organize/shared";

const FETCH_TIMEOUT = 15000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface ScrapeOptions {
  timeout?: number;
  userAgent?: string;
}

export interface ScrapeError {
  code: "INVALID_URL" | "FETCH_FAILED" | "TIMEOUT" | "PARSE_FAILED" | "HTTP_ERROR";
  message: string;
  statusCode?: number;
}

/**
 * 抓取 URL 内容并提取正文
 */
export async function scrapeUrl(
  url: string,
  options: ScrapeOptions = {}
): Promise<{ data?: ScrapeResult; error?: ScrapeError }> {
  const { timeout = FETCH_TIMEOUT, userAgent = USER_AGENT } = options;

  // 验证 URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return { error: { code: "INVALID_URL", message: "仅支持 HTTP/HTTPS 链接" } };
    }
  } catch {
    return { error: { code: "INVALID_URL", message: "URL 格式不正确" } };
  }

  // 抓取页面
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let html: string;
  try {
    const response = await fetch(parsedUrl.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return {
        error: {
          code: "HTTP_ERROR",
          message: `无法访问该页面 (${response.status})`,
          statusCode: response.status,
        },
      };
    }

    html = await response.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { error: { code: "TIMEOUT", message: "请求超时，请稍后重试" } };
    }
    return { error: { code: "FETCH_FAILED", message: "无法获取页面内容" } };
  } finally {
    clearTimeout(timer);
  }

  // 解析内容
  try {
    return { data: parseHtml(html, parsedUrl) };
  } catch {
    return { error: { code: "PARSE_FAILED", message: "无法解析页面内容" } };
  }
}

/**
 * 解析 HTML 提取文章信息
 */
function parseHtml(html: string, url: URL): ScrapeResult {
  // 微信公众号文章：使用专用解析器（Readability 无法处理其隐藏正文容器）
  if (url.hostname === "mp.weixin.qq.com") {
    const wechat = parseWechat(html, url);
    if (wechat) return wechat;
  }

  const dom = new JSDOM(html, { url: url.toString() });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const $ = cheerio.load(html);

  if (!article) {
    // Fallback: 使用 meta 标签提取基本信息
    return {
      url: url.toString(),
      title:
        $("meta[property='og:title']").attr("content") ||
        $("title").text() ||
        url.hostname,
      content: "",
      excerpt:
        $("meta[property='og:description']").attr("content") ||
        $("meta[name='description']").attr("content") ||
        "",
      cover_image: $("meta[property='og:image']").attr("content") || null,
      site_name: $("meta[property='og:site_name']").attr("content") || url.hostname,
      author: null,
      published_time: null,
    };
  }

  const coverImage =
    $("meta[property='og:image']").attr("content") ||
    (article.content ? extractFirstImage(article.content) : null);

  return {
    url: url.toString(),
    title: article.title,
    content: article.content,
    excerpt: article.excerpt || "",
    cover_image: coverImage,
    site_name: article.siteName || url.hostname,
    author: article.byline || null,
    published_time:
      $("meta[property='article:published_time']").attr("content") || null,
  };
}

function extractFirstImage(html: string): string | null {
  const $ = cheerio.load(html);
  const img = $("img").first();
  return img.attr("src") || img.attr("data-src") || null;
}

/**
 * 微信公众号文章专用解析器
 *
 * 微信文章正文位于 #js_content 容器，且默认 visibility:hidden（由 JS 渲染后显示），
 * 这会导致 Readability 误判为隐藏内容而跳过。图片使用 data-src 懒加载。
 * 因此需要直接提取 #js_content 并修复图片地址。
 */
function parseWechat(html: string, url: URL): ScrapeResult | null {
  const $ = cheerio.load(html);
  const contentEl = $("#js_content");

  if (!contentEl.length) return null;

  // 1. 修复图片：data-src -> src，并移除懒加载相关属性
  contentEl.find("img").each((_, el) => {
    const dataSrc = $(el).attr("data-src");
    if (dataSrc && !$(el).attr("src")) {
      $(el).attr("src", dataSrc);
    }
  });

  // 2. 移除脚本/样式/嵌入等噪音节点
  contentEl.find("script, style, iframe, svg").remove();

  // 3. 清理所有 data-* 属性（保留 inline style 以维持排版）
  contentEl.find("*").each((_, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs;
    if (attribs) {
      for (const key of Object.keys(attribs)) {
        if (key.startsWith("data-")) {
          $(el).removeAttr(key);
        }
      }
    }
  });

  const content = contentEl.html()?.trim() || "";
  if (!content) return null;

  const title =
    $("#activity-name").text().trim() ||
    $("h1.rich_media_title").text().trim() ||
    $("meta[property='og:title']").attr("content") ||
    $("title").text().trim() ||
    url.hostname;

  const author =
    $("#js_name").text().trim() ||
    $("meta[name='author']").attr("content") ||
    null;

  const excerpt =
    $("meta[name='description']").attr("content") ||
    $("meta[property='og:description']").attr("content") ||
    "";

  const coverImage =
    $("meta[property='og:image']").attr("content") || extractFirstImage(content);

  return {
    url: url.toString(),
    title,
    content,
    excerpt,
    cover_image: coverImage,
    site_name: "微信公众号",
    author,
    published_time:
      $("meta[property='article:published_time']").attr("content") || null,
  };
}
