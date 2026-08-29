import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { sanitizeContent } from "@/lib/sanitize/sanitize-html";
import type { ScrapeResult } from "@organize/shared";
import {
  SafeFetchError,
  safeFetchHtml,
  type HttpRequester,
} from "./safe-fetch";
import type { AddressLookup } from "./url-safety";

const FETCH_TIMEOUT = 15000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface ScrapeOptions {
  timeout?: number;
  userAgent?: string;
  lookup?: AddressLookup;
  request?: HttpRequester;
  maxBytes?: number;
  allowSyntheticAddresses?: boolean;
}

export interface ScrapeError {
  code:
    | "INVALID_URL"
    | "URL_BLOCKED"
    | "DNS_FAILED"
    | "FETCH_FAILED"
    | "TIMEOUT"
    | "PARSE_FAILED"
    | "HTTP_ERROR"
    | "TOO_MANY_REDIRECTS"
    | "TOO_LARGE"
    | "NON_HTML";
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
  let html: string;
  let finalUrl: URL;
  try {
    const result = await safeFetchHtml(url, {
      timeout,
      userAgent,
      lookup: options.lookup,
      request: options.request,
      maxBytes: options.maxBytes,
      allowSyntheticAddresses: options.allowSyntheticAddresses,
    });
    html = result.html;
    finalUrl = result.finalUrl;
  } catch (error) {
    if (error instanceof SafeFetchError) {
      return {
        error: {
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
        },
      };
    }
    return { error: { code: "FETCH_FAILED", message: "无法获取页面内容" } };
  }

  // 解析内容
  try {
    const result = parseHtml(html, finalUrl);
    const content = normalizeContentImages(result.content, finalUrl);
    // 入库前清洗 HTML：移除脚本/事件处理器等，防止存储型 XSS
    return { data: { ...result, content: sanitizeContent(content) } };
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

  const $ = cheerio.load(html);

  const youtube = parseYoutube($, url);
  if (youtube) return youtube;

  const xiaohongshu = parseXiaohongshu(html, $, url);
  if (xiaohongshu) return xiaohongshu;
  if (isXiaohongshuUnavailablePage($, url)) {
    throw new Error("小红书笔记当前不可访问");
  }

  const dom = new JSDOM(html, { url: url.toString() });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    // Fallback: 使用 meta 标签提取基本信息
    const excerpt =
      $("meta[property='og:description']").attr("content") ||
      $("meta[name='description']").attr("content") ||
      "";
    const coverImage =
      resolveAssetUrl(
        $("meta[property='og:image']").attr("content") ||
          $("meta[name='twitter:image']").attr("content"),
        url
      ) || null;
    const title =
      $("meta[property='og:title']").attr("content") ||
      $("title").text() ||
      url.hostname;

    return {
      url: url.toString(),
      title,
      content: isXHostname(url.hostname)
        ? buildXContent(excerpt, coverImage, title)
        : "",
      excerpt,
      cover_image: coverImage,
      site_name: $("meta[property='og:site_name']").attr("content") || url.hostname,
      author: null,
      published_time: null,
    };
  }

  const coverImage =
    resolveAssetUrl(
      $("meta[property='og:image']").attr("content") ||
        $("meta[name='twitter:image']").attr("content"),
      url
    ) || (article.content ? extractFirstImage(article.content, url) : null);
  // readability 0.6 起 title/content/excerpt 类型为可空，按既有 excerpt 兜底风格收窄
  const content = isXHostname(url.hostname)
    ? addXMediaToContent(article.content ?? "", coverImage, article.title || "")
    : article.content ?? "";

  return {
    url: url.toString(),
    title: article.title || "",
    content,
    excerpt: article.excerpt || "",
    cover_image: coverImage,
    site_name: article.siteName || url.hostname,
    author: article.byline || null,
    published_time:
      $("meta[property='article:published_time']").attr("content") || null,
  };
}

function extractFirstImage(html: string, url: URL): string | null {
  const $ = cheerio.load(html, null, false);
  const img = $("img").first();
  const lazySource = readFirstAttribute(img, [
    "data-original",
    "data-original-src",
    "data-lazy-src",
    "data-img-src",
    "data-actualsrc",
    "data-url",
    "data-src",
    "data-lazyload",
    "data-echo",
  ]);
  return (
    resolveAssetUrl(lazySource, url) ||
    resolveAssetUrl(img.attr("src"), url) ||
    firstSrcsetUrl(img.attr("data-srcset") || img.attr("srcset"), url)
  );
}

function resolveAssetUrl(
  value: string | null | undefined,
  baseUrl: URL
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith("data:")) return raw;

  try {
    const resolved = new URL(raw, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    if (
      resolved.protocol === "http:" &&
      supportsHttpsMedia(resolved.hostname)
    ) {
      resolved.protocol = "https:";
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function supportsHttpsMedia(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return ["xhscdn.com", "qpic.cn", "twimg.com", "ytimg.com"].some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`)
  );
}

const LAZY_IMAGE_ATTRIBUTES = [
  "data-original",
  "data-original-src",
  "data-lazy-src",
  "data-img-src",
  "data-actualsrc",
  "data-url",
  "data-src",
  "data-lazyload",
  "data-echo",
] as const;

/**
 * 统一还原各站点的懒加载图片，并让浏览器不发送本地阅读页 Referer。
 * 微信等图片 CDN 会对 localhost Referer 返回防盗链占位图，但允许无 Referer 请求。
 */
function normalizeContentImages(html: string, baseUrl: URL): string {
  if (!html) return "";

  const $ = cheerio.load(html, null, false);
  $("img").each((_, element) => {
    const image = $(element);
    const lazySource = readFirstAttribute(image, LAZY_IMAGE_ATTRIBUTES);
    const responsiveSource =
      firstSrcsetUrl(image.attr("data-srcset") || image.attr("srcset"), baseUrl) ||
      firstPictureSource(image, baseUrl);
    const source =
      resolveAssetUrl(lazySource, baseUrl) ||
      resolveAssetUrl(image.attr("src"), baseUrl) ||
      responsiveSource;

    if (source) image.attr("src", source);

    const normalizedSrcset = normalizeSrcset(
      image.attr("data-srcset") || image.attr("srcset"),
      baseUrl
    );
    if (normalizedSrcset) image.attr("srcset", normalizedSrcset);
    else image.removeAttr("srcset");

    image.removeAttr([...LAZY_IMAGE_ATTRIBUTES, "data-srcset"].join(" "));
    image.attr("loading", image.attr("loading") || "lazy");
    image.attr("decoding", "async");
    image.attr("referrerpolicy", "no-referrer");
  });

  $("source").each((_, element) => {
    const source = $(element);
    const srcset = normalizeSrcset(
      source.attr("data-srcset") || source.attr("srcset"),
      baseUrl
    );
    const src =
      resolveAssetUrl(source.attr("data-src"), baseUrl) ||
      resolveAssetUrl(source.attr("src"), baseUrl);

    if (srcset) source.attr("srcset", srcset);
    if (src) source.attr("src", src);
    source.removeAttr("data-src data-srcset");
  });

  return $.html();
}

type CheerioSelection = ReturnType<cheerio.CheerioAPI>;

function readFirstAttribute(
  element: CheerioSelection,
  names: readonly string[]
): string | null {
  for (const name of names) {
    const value = element.attr(name)?.trim();
    if (value) return value;
  }
  return null;
}

function firstPictureSource(
  image: CheerioSelection,
  baseUrl: URL
): string | null {
  const source = image.closest("picture").find("source").first();
  if (!source.length) return null;
  return (
    firstSrcsetUrl(source.attr("data-srcset") || source.attr("srcset"), baseUrl) ||
    resolveAssetUrl(source.attr("data-src") || source.attr("src"), baseUrl)
  );
}

function firstSrcsetUrl(
  value: string | null | undefined,
  baseUrl: URL
): string | null {
  const normalized = normalizeSrcset(value, baseUrl);
  if (!normalized) return null;
  if (normalized.startsWith("data:")) return normalized;
  return normalized.split(",")[0]?.trim().split(/\s+/)[0] || null;
}

function normalizeSrcset(
  value: string | null | undefined,
  baseUrl: URL
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith("data:")) return raw;

  const normalized = raw
    .split(",")
    .map((candidate) => {
      const [source, ...descriptor] = candidate.trim().split(/\s+/);
      const resolved = resolveAssetUrl(source, baseUrl);
      if (!resolved) return null;
      return [resolved, ...descriptor].join(" ");
    })
    .filter((candidate): candidate is string => Boolean(candidate));

  return normalized.length ? normalized.join(", ") : null;
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

  // 1. 修复图片：微信用 data-src 懒加载，src 常是透明占位 gif
  //    兼容多种懒加载字段：微信原生 data-src、秀米/135编辑器 data-original 等
  contentEl.find("img").each((_, el) => {
    const $el = $(el);
    // 优先级：data-original > data-lazy-src > data-img-src > data-src > src
    const lazySource = readFirstAttribute($el, LAZY_IMAGE_ATTRIBUTES);
    const normalized =
      resolveAssetUrl(lazySource, url) ||
      resolveAssetUrl($el.attr("src"), url);

    if (normalized) {
      $el.attr("src", normalized);
    }
    // 移除懒加载相关属性，避免前端 JS 再次处理
    $el.removeAttr("data-src data-original data-lazy-src data-img-src");
    $el.removeAttr("data-type data-ratio data-w data-s");
    // 确保图片可见（微信有时用 width/height 0 占位），用 max-width 保证响应式
    $el.removeAttr("width height");
    $el.css("max-width", "100%").css("height", "auto");
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
    resolveAssetUrl($("meta[property='og:image']").attr("content"), url) ||
    extractFirstImage(content, url);

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

function parseYoutube(
  $: cheerio.CheerioAPI,
  url: URL
): ScrapeResult | null {
  if (!isYoutubeHostname(url.hostname)) return null;

  const videoId = extractYoutubeId(url);
  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").text().trim() ||
    "YouTube 视频";
  const excerpt =
    $("meta[property='og:description']").attr("content")?.trim() ||
    $("meta[name='description']").attr("content")?.trim() ||
    "";
  const coverImage =
    resolveAssetUrl($("meta[property='og:image']").attr("content"), url) ||
    (videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : null);
  const content = [
    coverImage
      ? `<figure><img src="${escapeHtml(coverImage)}" alt="${escapeHtml(title)}"></figure>`
      : "",
    excerpt ? `<p>${escapeHtml(excerpt)}</p>` : "",
  ].join("");

  return {
    url: url.toString(),
    title,
    content,
    excerpt,
    cover_image: coverImage,
    site_name: "YouTube",
    author:
      $("meta[itemprop='author']").attr("content") ||
      $("link[itemprop='name']").attr("content") ||
      null,
    published_time:
      $("meta[itemprop='datePublished']").attr("content") || null,
  };
}

function isYoutubeHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "youtu.be" ||
    normalized === "youtube.com" ||
    normalized.endsWith(".youtube.com")
  );
}

function extractYoutubeId(url: URL): string | null {
  if (url.hostname.toLowerCase() === "youtu.be") {
    return url.pathname.split("/").filter(Boolean)[0] || null;
  }

  const queryId = url.searchParams.get("v");
  if (queryId) return queryId;

  return (
    url.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]+)/)?.[1] ||
    null
  );
}

function isXHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "x.com" ||
    normalized.endsWith(".x.com") ||
    normalized === "twitter.com" ||
    normalized.endsWith(".twitter.com")
  );
}

function isXMediaUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.hostname === "pbs.twimg.com" &&
        /^\/(?:media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\//.test(
          url.pathname
        )) ||
      url.hostname === "video.twimg.com"
    );
  } catch {
    return false;
  }
}

function buildXContent(
  excerpt: string,
  coverImage: string | null,
  title: string
): string {
  return [
    isXMediaUrl(coverImage)
      ? `<figure><img src="${escapeHtml(coverImage)}" alt="${escapeHtml(title)}"></figure>`
      : "",
    excerpt ? `<p>${escapeHtml(excerpt).replace(/\r?\n/g, "<br>")}</p>` : "",
  ].join("");
}

function addXMediaToContent(
  content: string,
  coverImage: string | null,
  title: string
): string {
  if (!isXMediaUrl(coverImage) || content.includes(coverImage)) return content;
  return `<figure><img src="${escapeHtml(coverImage)}" alt="${escapeHtml(title)}"></figure>${content}`;
}

function parseXiaohongshu(
  html: string,
  $: cheerio.CheerioAPI,
  url: URL
): ScrapeResult | null {
  if (!isXiaohongshuHostname(url.hostname)) return null;

  const state = extractXiaohongshuState(html);
  const noteId =
    url.pathname.match(/\/(?:explore|discovery\/item)\/([^/?]+)/i)?.[1] || "";
  const note = findXiaohongshuNote(state, noteId);
  if (!note) return parseXiaohongshuMeta($, url, noteId);

  const title =
    readString(note.title) ||
    readString(note.displayTitle) ||
    $("meta[property='og:title']").attr("content")?.trim() ||
    "小红书笔记";
  const excerpt =
    readString(note.desc) ||
    readString(note.description) ||
    $("meta[property='og:description']").attr("content")?.trim() ||
    "";
  const imageUrls = extractXiaohongshuImages(note, url);
  const content = [
    excerpt ? `<p>${escapeHtml(excerpt).replace(/\r?\n/g, "<br>")}</p>` : "",
    ...imageUrls.map(
      (imageUrl) => `<figure><img src="${escapeHtml(imageUrl)}" alt="小红书图片" loading="lazy"></figure>`
    ),
  ].join("");

  if (!content) return null;

  const user = isRecord(note.user) ? note.user : null;
  return {
    url: url.toString(),
    title,
    content,
    excerpt,
    cover_image:
      imageUrls[0] ||
      resolveAssetUrl($("meta[property='og:image']").attr("content"), url),
    site_name: "小红书",
    author: user ? readString(user.nickName) || readString(user.nickname) : null,
    published_time: readString(note.time),
  };
}

function isXiaohongshuHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "xiaohongshu.com" || normalized.endsWith(".xiaohongshu.com");
}

function isXiaohongshuUnavailablePage(
  $: cheerio.CheerioAPI,
  url: URL
): boolean {
  if (!isXiaohongshuHostname(url.hostname)) return false;

  const path = url.pathname.replace(/\/+$/, "") || "/";
  const pageText = `${$("title").text()} ${$("meta[name='description']").attr("content") || ""}`;
  return (
    path === "/404" ||
    path === "/explore" ||
    /\/(?:explore|discovery\/item)\/[^/]+/i.test(path) ||
    /当前笔记暂时无法浏览|页面不见了|页面不存在|内容不存在|访问受限/.test(
      pageText
    )
  );
}

function parseXiaohongshuMeta(
  $: cheerio.CheerioAPI,
  url: URL,
  noteId: string
): ScrapeResult | null {
  if (!noteId) return null;

  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").text().trim();
  const excerpt =
    $("meta[property='og:description']").attr("content")?.trim() ||
    $("meta[name='description']").attr("content")?.trim() ||
    "";
  const coverImage =
    resolveAssetUrl(
      $("meta[property='og:image']").attr("content") ||
        $("meta[name='twitter:image']").attr("content"),
      url
    ) || null;
  const pageText = `${title} ${excerpt}`;

  if (
    !title ||
    /当前笔记暂时无法浏览|页面不存在|内容不存在|访问受限|登录后查看/.test(pageText) ||
    (!excerpt && !coverImage)
  ) {
    return null;
  }

  return {
    url: url.toString(),
    title,
    content: [
      excerpt ? `<p>${escapeHtml(excerpt).replace(/\r?\n/g, "<br>")}</p>` : "",
      coverImage
        ? `<figure><img src="${escapeHtml(coverImage)}" alt="小红书图片"></figure>`
        : "",
    ].join(""),
    excerpt,
    cover_image: coverImage,
    site_name: "小红书",
    author: null,
    published_time: null,
  };
}

function extractXiaohongshuState(html: string): unknown {
  const match = html.match(
    /window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)\s*<\/script>/i
  );
  if (!match) return null;

  const source = match[1]
    .trim()
    .replace(/;\s*$/, "")
    .replace(/\b(?:undefined|NaN)\b/g, "null");
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return null;
  }
}

function findXiaohongshuNote(state: unknown, noteId: string): Record<string, unknown> | null {
  if (!isRecord(state) || !isRecord(state.note)) return null;
  const noteDetailMap = state.note.noteDetailMap;
  if (!isRecord(noteDetailMap)) return null;

  const entry =
    (noteId && noteDetailMap[noteId]) || Object.values(noteDetailMap)[0];
  if (!isRecord(entry)) return null;
  return isRecord(entry.note) ? entry.note : entry;
}

function extractXiaohongshuImages(
  note: Record<string, unknown>,
  url: URL
): string[] {
  const images = Array.isArray(note.imageList)
    ? note.imageList
    : Array.isArray(note.images)
      ? note.images
      : [];

  return images
    .map((item) => {
      if (typeof item === "string") return resolveAssetUrl(item, url);
      if (!isRecord(item)) return null;

      const infoList = Array.isArray(item.infoList) ? item.infoList : [];
      const infoUrl = infoList.find(
        (info) => isRecord(info) && typeof info.url === "string"
      );
      const value =
        item.urlDefault ||
        item.urlPre ||
        item.urlOriginal ||
        item.url ||
        (isRecord(infoUrl) ? infoUrl.url : null);
      return typeof value === "string" ? resolveAssetUrl(value, url) : null;
    })
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] || character
  );
}
