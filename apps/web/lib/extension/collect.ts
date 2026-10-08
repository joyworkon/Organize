/**
 * 浏览器扩展收集内核（服务端版，P1-01 收集语义的延伸）。
 *
 * 与 lib/reading/collect.ts 的 collectReadingItem 同一冻结语义：
 * 规范化 URL（extractFirstUrl）→ 去重（user_id 限定 + 活跃条目）→ 抓取
 * （失败降级仅存链接）→ 固定 8 字段插入。差异点：
 * - 运行在服务端：抓取走 lib/scraper 的服务端 scrapeUrl，认证由 route 层用
 *   Bearer JWT 完成（deps.supabase 已带用户身份，RLS 生效）；
 * - 不发 reading:item-created 事件（appEvents 是浏览器内事件总线）；
 * - 支持携带页面内检测到的媒体链接：清洗后以「页面媒体」小节追加进 content
 *   （正文抓取失败且带媒体时，content 仅含该小节——视频页常无正文可抓，
 *   保留媒体链接才能在详情页在线预览）；不带媒体时与仅存链接完全一致
 *   （content/excerpt/cover_image 为 null）。
 * - 扩展可传 pageTitle 作为抓取失败时的标题回退（页面 document.title）。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScrapeResult } from "@organize/shared";
import { extractFirstUrl } from "@/lib/inbox/batch-import";
import {
  appendMediaSection,
  buildMediaSectionHtml,
  normalizeMediaLinks,
  type MediaLinkInput,
} from "@/lib/extension/media";

export type ExtensionCollectStatus = "saved" | "saved-link-only" | "duplicate" | "error";

export interface ExtensionCollectInput {
  /** route 层验证 Bearer JWT 后得到的用户 id（RLS 与行归属的事实来源） */
  userId: string;
  rawUrl: string;
  /** 扩展端页面标题（document.title），抓取失败时的标题回退 */
  pageTitle?: string | null;
  /** 扩展端检测到的页面内视频/音频链接 */
  mediaLinks?: MediaLinkInput[] | null;
}

export interface ExtensionCollectResult {
  status: ExtensionCollectStatus;
  itemId: string | null;
  url: string | null;
  title: string | null;
  errorReason?: "invalid-url" | "unauthenticated" | "save-failed";
  message?: string;
}

export interface ExtensionCollectDeps {
  /** 已带用户 Authorization 的 supabase-js client（route 层构造，RLS 按用户生效） */
  supabase: SupabaseClient;
  /** 服务端抓取函数（lib/scraper 的 scrapeUrl：返回 { data, error }，不 throw） */
  scrapeUrl: (url: string) => Promise<{
    data?: ScrapeResult | null;
    error?: { message?: string } | null;
  } | null | undefined>;
}

export async function collectForExtension(
  deps: ExtensionCollectDeps,
  input: ExtensionCollectInput
): Promise<ExtensionCollectResult> {
  const normalizedUrl = extractFirstUrl(input?.rawUrl ?? "");
  if (!normalizedUrl) {
    return {
      status: "error",
      itemId: null,
      url: null,
      title: null,
      errorReason: "invalid-url",
      message: "没有找到有效的链接",
    };
  }

  // 去重：限定当前用户 + 规范化 URL 精确匹配活跃条目（与 collect.ts 同语义）
  const { data: existingRows, error: queryError } = await deps.supabase
    .from("reading_items")
    .select("id, title")
    .eq("user_id", input.userId)
    .eq("url", normalizedUrl)
    .is("deleted_at", null)
    .limit(1);
  if (queryError) {
    return {
      status: "error",
      itemId: null,
      url: normalizedUrl,
      title: null,
      errorReason: "save-failed",
      message: queryError.message,
    };
  }
  const existing = existingRows?.[0];
  if (existing) {
    return {
      status: "duplicate",
      itemId: existing.id,
      url: normalizedUrl,
      title: existing.title ?? normalizedUrl,
    };
  }

  // 抓取失败 → 仅存链接，不中断
  let scraped: ScrapeResult | null = null;
  try {
    const { data } = (await deps.scrapeUrl(normalizedUrl)) ?? {};
    scraped = data ?? null;
  } catch {
    scraped = null;
  }

  const mediaLinks = normalizeMediaLinks(input.mediaLinks, normalizedUrl);
  const mediaSection = buildMediaSectionHtml(mediaLinks);
  const content = appendMediaSection(scraped?.content ?? "", mediaSection) || null;
  const title = scraped?.title || input.pageTitle?.trim() || normalizedUrl;

  const { data: inserted, error: insertError } = await deps.supabase
    .from("reading_items")
    .insert({
      user_id: input.userId,
      url: normalizedUrl,
      title,
      content,
      excerpt: scraped?.excerpt ?? null,
      cover_image: scraped?.cover_image ?? null,
      reading_status: "unread",
      reading_progress: 0,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return {
      status: "error",
      itemId: null,
      url: normalizedUrl,
      title,
      errorReason: "save-failed",
      message: insertError?.message ?? "保存失败",
    };
  }

  return {
    status: scraped ? "saved" : "saved-link-only",
    itemId: inserted.id,
    url: normalizedUrl,
    title,
  };
}
