/**
 * 服务端导入收集入口（阶段 D）——collectReadingItem 的服务端变体。
 *
 * 任务书 §九：「文档提取结果如需进入阅读条目，扩展经过验证的统一收集入口」。
 * 本函数与 lib/reading/collect.ts 的物料分支保持同一套冻结语义：
 *   1. 去重键 = 内容指纹 URN（`urn:organize:import:{sha256}`），按 user_id + 活跃行精确匹配；
 *      命中 → duplicate，不插新行、不更新（重试导入只回指既有条目，幂等）。
 *   2. 写入固定 8 字段映射（user_id / url / title / content / excerpt /
 *      cover_image=null / reading_status=unread / reading_progress=0）。
 *   3. 标签失败仅 warning，不破坏正文（与物料分支一致）。
 * 差异（服务端语境，均不破坏语义）：
 *   - 不抓取网络（导入正文已提取，绝不送 scrape）；
 *   - supabase client 与 userId 由路由注入（服务端无浏览器 session 语义）；
 *   - 不发 appEvents（客户端事件总线是浏览器侧；导入路由响应驱动 UI 刷新）。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { IMPORT_URI_PREFIX } from "./source";

export interface ImportCollectInput {
  /** 文件内容 sha256（hex），作为稳定去重键 */
  key: string;
  title: string;
  /** 已是安全 HTML（lib/imports 全量转义产出） */
  html: string;
  excerpt: string;
  tags?: string[];
}

export interface ImportCollectResult {
  status: "saved" | "duplicate" | "error";
  itemId: string | null;
  title: string | null;
  /** 正文已保存、标签部分失败时提示 */
  warning?: string;
  message?: string;
}

export async function collectImportItem(
  supabase: SupabaseClient,
  userId: string,
  input: ImportCollectInput,
): Promise<ImportCollectResult> {
  if (!/^[a-f0-9]{64}$/.test(input.key)) {
    return { status: "error", itemId: null, title: null, message: "导入标识无效" };
  }
  if (!input.title.trim() || !input.html.trim()) {
    return { status: "error", itemId: null, title: null, message: "导入内容为空" };
  }
  const urn = `${IMPORT_URI_PREFIX}${input.key}`;

  // 去重：限定当前用户 + URN 精确匹配活跃行（与 collect.ts 同语义）
  const { data: existingRows, error: queryError } = await supabase
    .from("reading_items")
    .select("id, title")
    .eq("user_id", userId)
    .eq("url", urn)
    .is("deleted_at", null)
    .limit(1);
  if (queryError) {
    return { status: "error", itemId: null, title: null, message: queryError.message };
  }
  const existing = existingRows?.[0];
  if (existing) {
    return { status: "duplicate", itemId: existing.id, title: existing.title ?? input.title };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("reading_items")
    .insert({
      user_id: userId,
      url: urn,
      title: input.title.trim().slice(0, 200),
      content: input.html,
      excerpt: input.excerpt.slice(0, 500),
      cover_image: null,
      reading_status: "unread",
      reading_progress: 0,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return { status: "error", itemId: null, title: input.title, message: insertError?.message ?? "保存失败" };
  }

  // 标签：失败仅 warning（与物料分支一致）
  let warning: string | undefined;
  if (input.tags?.length) {
    try {
      for (const name of input.tags.slice(0, 8)) {
        const clean = name.trim().slice(0, 30);
        if (!clean) continue;
        const { data: tag, error } = await supabase
          .from("tags").upsert({ user_id: userId, name: clean }, { onConflict: "user_id,name" })
          .select("id").single();
        if (error || !tag) throw new Error("标签保存失败");
        const linked = await supabase
          .from("item_tags").upsert({ item_id: inserted.id, tag_id: tag.id }, { onConflict: "item_id,tag_id" });
        if (linked.error) throw new Error("标签关联失败");
      }
    } catch { warning = "正文已保存，但部分标签未保存"; }
  }

  return { status: "saved", itemId: inserted.id, title: input.title, ...(warning ? { warning } : {}) };
}
