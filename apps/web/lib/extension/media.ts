/**
 * 浏览器扩展收集链路的媒体识别纯函数（可单测、不依赖网络与 DOM）。
 *
 * 职责边界：
 * - 平台嵌入（YouTube / Bilibili / Vimeo 等）交给 lib/oembed/providers 的
 *   matchProvider 白名单（同一份安全约束：srcDoc 禁 allow-same-origin），
 *   这里不重复维护平台模板。
 * - 本文件补充「直链媒体」判定（.mp4 / .mp3 等可原生播放的 URL）、
 *   扩展提交的媒体链接清洗，以及「页面媒体」HTML 小节的拼装/提取。
 * - Chrome 扩展端（extensions/chrome/media-detect.js）按同样的规则在
 *   页面侧检测，两份实现需保持同步（扩展无构建步骤，无法共享 TS 模块）。
 */
import { matchProvider } from "@/lib/oembed/providers";

export type MediaType = "video" | "audio";

export interface MediaLinkInput {
  type?: string | null;
  url: string;
  title?: string | null;
}

export interface NormalizedMediaLink {
  type: MediaType;
  url: string;
  title: string;
}

/** 收集的媒体链接上限：避免超长内容与恶意填充 */
export const MAX_MEDIA_LINKS = 10;

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "m4v", "mov", "ogv"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "aac", "wav", "ogg", "oga", "flac", "opus"]);

/** 直链媒体判定：按 URL 路径扩展名识别可原生播放的视频/音频 */
export function detectDirectMedia(url: string): MediaType | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const ext = parsed.pathname.split(".").pop()?.toLowerCase() ?? "";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return null;
}

export interface MediaPreview {
  url: string;
  kind: "embed" | MediaType;
  /** kind=embed 时为 provider 白名单生成的 iframe HTML（渲染时必须套 sandbox） */
  html?: string;
  sandbox?: string;
  provider?: string;
}

/**
 * 统一判定一个 URL 是否可预览：
 * 先查 oEmbed provider 白名单（embed），再退直链扩展名（原生 video/audio）。
 * 返回 null 表示无法预览（仍可作为普通链接展示）。
 */
export function resolveMediaPreview(url: string): MediaPreview | null {
  const embed = matchProvider(url);
  if (embed && (embed.provider === "YouTube" || embed.provider === "Bilibili" || embed.provider === "Vimeo")) {
    return { url, kind: "embed", html: embed.html, sandbox: embed.sandbox, provider: embed.provider };
  }
  const direct = detectDirectMedia(url);
  if (direct) return { url, kind: direct, provider: direct === "video" ? "视频" : "音频" };
  return null;
}

/** 从 content HTML 提取所有 <a href>（服务端无 DOM，用正则；href 实体不还原，交给 URL 容错） */
export function extractMediaUrlsFromContent(html: string): string[] {
  if (!html) return [];
  const urls: string[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1] ?? m[2];
    if (href) urls.push(href);
  }
  return urls;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 清洗扩展提交的媒体链接：
 * - 仅接受 http(s) URL 与 video/audio 类型（URL 本身可判定时以 URL 为准）
 * - 按 URL 去重；剔除与主页面 URL 相同的项（主 URL 即条目本身，无需重复）
 * - 截断到 MAX_MEDIA_LINKS
 */
export function normalizeMediaLinks(
  links: MediaLinkInput[] | null | undefined,
  pageUrl: string
): NormalizedMediaLink[] {
  if (!Array.isArray(links)) return [];
  let pageOriginPath: string | null = null;
  try {
    const page = new URL(pageUrl);
    pageOriginPath = `${page.origin}${page.pathname}`;
  } catch {
    pageOriginPath = null;
  }

  const seen = new Set<string>();
  const result: NormalizedMediaLink[] = [];
  for (const link of links) {
    if (result.length >= MAX_MEDIA_LINKS) break;
    const url = typeof link?.url === "string" ? link.url.trim() : "";
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    if (pageOriginPath && `${parsed.origin}${parsed.pathname}` === pageOriginPath) continue;
    const key = parsed.href;
    if (seen.has(key)) continue;
    seen.add(key);

    const direct = detectDirectMedia(url);
    const type: MediaType | null =
      direct ?? (link?.type === "video" || link?.type === "audio" ? link.type : null);
    if (!type) continue;

    const title = typeof link?.title === "string" ? link.title.trim().slice(0, 200) : "";
    result.push({ type, url: parsed.href, title });
  }
  return result;
}

/** 「页面媒体」小节标题，data-organize-media 便于识别来源 */
export const MEDIA_SECTION_HEADING = "页面媒体";

/** 拼装「页面媒体」HTML 小节；空数组返回空串（不追加任何内容） */
export function buildMediaSectionHtml(links: NormalizedMediaLink[]): string {
  if (links.length === 0) return "";
  const items = links
    .map((link) => {
      const icon = link.type === "video" ? "🎬" : "🎧";
      const label = link.title || link.url;
      return `<p>${icon} <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></p>`;
    })
    .join("");
  return `<h2 data-organize-media="1">${MEDIA_SECTION_HEADING}</h2>${items}`;
}

/** 把媒体小节追加到正文末尾；section 为空时原样返回 */
export function appendMediaSection(contentHtml: string, sectionHtml: string): string {
  if (!sectionHtml) return contentHtml;
  const base = contentHtml?.trimEnd() ?? "";
  return base ? `${base}\n${sectionHtml}` : sectionHtml;
}
