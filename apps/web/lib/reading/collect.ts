/**
 * 稍后读统一收集服务（P1-01）。
 *
 * 这是「规范化 URL → 抓取 → 保存 → 事件通知」的唯一入口：阅读库快速添加、
 * 全局 Quick Add、命令面板、批量导入、系统分享页都必须走 collectReadingItem，
 * 不得各自直连 reading_items 写入。
 *
 * 冻结语义（改动须同步 lib/reading/collect.test.ts 与 ROADMAP）：
 * 1. URL 规范化：extractFirstUrl 从任意粘贴文本提取第一个 http(s) URL；
 *    提取不到 → error（invalid-url），不写库。
 * 2. 抓取失败策略：不中断保存，降级为「仅存链接」——title 取规范化 URL，
 *    content/excerpt/cover_image 为 null，结局 saved-link-only，UI 必须明示。
 * 3. 去重：限定 user_id（显式 eq 过滤，RLS 双保险），按规范化 URL 精确匹配
 *    活跃条目（deleted_at is null；RLS 本就只暴露活跃行）。命中 → duplicate，
 *    不插新行、不更新、不发事件。软删除条目对客户端不可见（021 RLS），
 *    再次保存会产生新条目、回收站副本保持不动，由用户在垃圾箱处置。
 * 4. 写入字段固定映射（8 字段）：user_id / url / title / content / excerpt /
 *    cover_image / reading_status=unread / reading_progress=0。
 *    ScrapeResult 的 site_name/author/published_time 无对应列，不入库。
 * 5. 事件：saved / saved-link-only 成功后发一次 reading:item-created。
 * 6. 去重查询或写库失败 → error 结局，调用方必须把失败呈现给用户，禁止假成功。
 *    已知限制：去重查询与插入非原子，极端并发（多标签页同时提交同一 URL）
 *    可能产生两行；未加部分唯一索引是因为恢复 RPC 为明文插入且历史数据可能
 *    已有同 URL 活跃重复行，会破坏 v4 备份往返合同。
 * 7. 物料分支：kind=material 的输入先校验并转成安全 HTML，使用内容指纹 URN
 *    作为去重键，不抓取网络。复用账户校验/8 字段映射/活跃去重/事件语义，
 *    并追加分类与主题标签；标签失败仅警告，重复保存时补齐标签。
 */
import { extractFirstUrl } from "@/lib/inbox/batch-import";
import { scrapeUrl } from "@/lib/scraper/client";
import { createClient } from "@/lib/supabase/client";
import { appEvents } from "@/lib/plugin/events";
import type { MaterialResult } from "@organize/plugin-sdk";
import { materialResultToArticle } from "@/lib/materials/article";
import { MATERIAL_URI_PREFIX } from "./source";

export type CollectStatus = "saved" | "saved-link-only" | "duplicate" | "error";

export type CollectErrorReason = "invalid-url" | "invalid-material" | "unauthenticated" | "save-failed";

export interface CollectResult {
  status: CollectStatus;
  /** saved/saved-link-only 为新行 id；duplicate 为既有行 id；error 为 null */
  itemId: string | null;
  /** 规范化 URL；invalid-url 时为 null */
  url: string | null;
  /** 最终标题（仅存链接时为规范化 URL；duplicate 时为既有条目标题） */
  title: string | null;
  errorReason?: CollectErrorReason;
  /** error 时用户可读的原因 */
  message?: string;
  /** 正文已保存、标签部分失败时明确提示，重试导入只补标签不重复建条目。 */
  warning?: string;
}

export interface MaterialCollectInput {
  kind: "material";
  key: string;
  result: MaterialResult;
  sources: string[];
}

export async function collectReadingItem(rawInput: string | MaterialCollectInput, options: { expectedUserId?: string } = {}): Promise<CollectResult> {
  let article: ReturnType<typeof materialResultToArticle> | null = null;
  if (typeof rawInput !== "string") {
    try {
      if (rawInput.kind !== "material" || !/^[a-f0-9]{64}$/.test(rawInput.key)) throw new Error("物料标识无效");
      if (!Array.isArray(rawInput.sources) || !rawInput.sources.length || rawInput.sources.length > 7 || rawInput.sources.some((s) => typeof s !== "string" || s.length > 1000)) throw new Error("物料来源无效");
      article = materialResultToArticle(rawInput.result, rawInput.sources);
    } catch (error) {
      return { status: "error", itemId: null, url: null, title: null, errorReason: "invalid-material", message: error instanceof Error ? error.message : "物料无效" };
    }
  }
  const normalizedUrl = typeof rawInput === "string" ? extractFirstUrl(rawInput ?? "") : `${MATERIAL_URI_PREFIX}${rawInput.key}`;
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

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || (options.expectedUserId && options.expectedUserId !== user.id)) {
    return {
      status: "error",
      itemId: null,
      url: normalizedUrl,
      title: null,
      errorReason: "unauthenticated",
      message: "请先登录",
    };
  }

  // 去重：限定当前用户 + 规范化 URL 精确匹配（RLS 只暴露活跃行，is 条件显式表达语义）
  const { data: existingRows, error: queryError } = await supabase
    .from("reading_items")
    .select("id, title")
    .eq("user_id", user.id)
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
  const applyMaterialTags = async (itemId: string): Promise<string | undefined> => {
    if (!article) return;
    try {
      for (const name of article.tags) {
        const { data: tag, error } = await supabase.from("tags").upsert({ user_id: user.id, name }, { onConflict: "user_id,name" }).select("id").single();
        if (error || !tag) throw new Error("标签保存失败");
        const linked = await supabase.from("item_tags").upsert({ item_id: itemId, tag_id: tag.id }, { onConflict: "item_id,tag_id" });
        if (linked.error) throw new Error("标签关联失败");
      }
    } catch { return "正文已保存，但部分标签未保存；可重试保存补齐标签"; }
  };
  if (existing) {
    return {
      status: "duplicate",
      itemId: existing.id,
      url: normalizedUrl,
      title: existing.title ?? normalizedUrl,
      ...(article ? { warning: await applyMaterialTags(existing.id) } : {}),
    };
  }

  // 抓取失败 → 冻结语义：仅存链接，不中断
  let scraped: Awaited<ReturnType<typeof scrapeUrl>> | null = null;
  try {
    if (article) {
      scraped = { url: normalizedUrl, title: article.title, content: article.content, excerpt: article.excerpt, cover_image: null, site_name: null, author: null, published_time: null };
    } else {
    scraped = await scrapeUrl(normalizedUrl);
    }
  } catch {
    scraped = null;
  }

  const title = scraped?.title || normalizedUrl;
  const { data: inserted, error: insertError } = await supabase
    .from("reading_items")
    .insert({
      user_id: user.id,
      url: normalizedUrl,
      title,
      content: scraped?.content ?? null,
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

  const warning = await applyMaterialTags(inserted.id);
  appEvents.emit("reading:item-created", {
    itemId: inserted.id,
    url: normalizedUrl,
    title,
  });

  return {
    status: scraped ? "saved" : "saved-link-only",
    itemId: inserted.id,
    url: normalizedUrl,
    title,
    ...(warning ? { warning } : {}),
  };
}

/** 统一 toast 文案：所有入口用同一套措辞，失败必须可见 */
export function collectResultToast(result: CollectResult): {
  title: string;
  variant?: "destructive";
} {
  switch (result.status) {
    case "saved":
      return { title: "已保存到稍后读" };
    case "saved-link-only":
      return { title: "已保存（正文抓取失败，仅存链接）" };
    case "duplicate":
      return { title: "该链接已在稍后读中" };
    case "error":
      return { title: result.message || "添加失败，请重试", variant: "destructive" };
  }
}
