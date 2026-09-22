/**
 * 资料来源快照（阶段 E）：画布「资料」面板 / 「更新快照」共用的来源读取。
 *
 * 语义（任务书 §十）：插入画布的是独立可编辑快照；来源读取只服务于
 * 「更新快照」（重建副本）与「打开来源」，画布内容永不回写来源。
 * 读取走 supabase 客户端（mock 下同一接口走内存 mockDb，RLS 语义一致）：
 * 查不到 = 已删除或无权限，调用方必须保留旧快照并提示。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LibraryItem } from "@organize/shared";
import type { CanvasSourceRef } from "@/lib/canvas/model";
import { MATERIAL_CARD_EXCERPT_MAX } from "@/lib/canvas/model";

/** 从资料库条目（LibraryItem）构建来源引用（快照时间 = 插入时刻）。 */
export function sourceRefFromLibraryItem(item: LibraryItem): CanvasSourceRef {
  return {
    kind: item.source_type === "memo" ? "memo" : "reading",
    id: item.id,
    title: item.title || firstLine(item.excerpt ?? "") || "未命名资料",
    excerpt: item.excerpt ?? "",
    url: item.url ?? "",
    updatedAt: new Date().toISOString(),
  };
}

/** 取文本首行（去掉首尾空白；memo 无标题时用正文首行当标题）。 */
export function firstLine(text: string): string {
  return text.split("\n", 1)[0]?.trim() ?? "";
}

/** 卡片/摘录快照的摘录截断（与 model 的 MATERIAL_CARD_EXCERPT_MAX 对齐）。 */
export function excerptSnapshot(text: string): string {
  const t = text.trim();
  return t.length > MATERIAL_CARD_EXCERPT_MAX ? `${t.slice(0, MATERIAL_CARD_EXCERPT_MAX)}…` : t;
}

export interface SourceSnapshot {
  title: string;
  /** 快照正文（卡片 text / 摘录 text）。 */
  text: string;
  /** 来源正文 HTML 中第一张图的地址（无则 null）。 */
  imageSrc: string | null;
  /** 图片 alt/名称（写入图片块 alt）。 */
  imageAlt: string | null;
  sourceRef: CanvasSourceRef;
}

/** 从正文 HTML 取第一张图的 src（不解析脚本；属性正则只匹配 src/alt）。 */
export function firstImageSrcFromHtml(html: string): { src: string; alt: string } | null {
  const img = /<img\b[^>]*>/i.exec(html);
  if (!img) return null;
  const tag = img[0];
  const src = /\bsrc\s*=\s*"([^"]+)"/i.exec(tag) ?? /\bsrc\s*=\s*'([^']+)'/i.exec(tag);
  if (!src || !src[1]) return null;
  const alt = /\balt\s*=\s*"([^"]*)"/i.exec(tag) ?? /\balt\s*=\s*'([^']*)'/i.exec(tag);
  return { src: src[1], alt: alt?.[1] ?? "" };
}

/** 读取 reading 条目当前内容并构建快照；查不到（删除/无权限）返回 null。 */
export async function fetchReadingSnapshot(
  supabase: SupabaseClient,
  id: string,
): Promise<SourceSnapshot | null> {
  const { data } = await supabase
    .from("reading_items")
    .select("id, title, excerpt, content, url, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    id: string;
    title: string | null;
    excerpt: string | null;
    content: string | null;
    url: string | null;
    updated_at: string | null;
  };
  const img = row.content ? firstImageSrcFromHtml(row.content) : null;
  const plain = stripHtml(row.excerpt || row.content || "");
  return {
    title: row.title || firstLine(plain) || "未命名资料",
    text: excerptSnapshot(plain),
    imageSrc: img?.src ?? null,
    imageAlt: img?.alt || row.title || null,
    sourceRef: {
      kind: "reading",
      id: row.id,
      title: row.title || firstLine(plain) || "未命名资料",
      excerpt: excerptSnapshot(plain),
      url: row.url ?? "",
      updatedAt: new Date().toISOString(),
    },
  };
}

/** 读取 memo 当前内容并构建快照；查不到返回 null。 */
export async function fetchMemoSnapshot(
  supabase: SupabaseClient,
  id: string,
): Promise<SourceSnapshot | null> {
  const { data } = await supabase
    .from("memos")
    .select("id, content, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as { id: string; content: string; updated_at: string | null };
  const title = firstLine(row.content) || "未命名速记";
  return {
    title,
    text: excerptSnapshot(row.content),
    imageSrc: null,
    imageAlt: null,
    sourceRef: {
      kind: "memo",
      id: row.id,
      title,
      excerpt: excerptSnapshot(row.content),
      url: "",
      updatedAt: new Date().toISOString(),
    },
  };
}

/** 按来源引用读取快照（分发 reading/memo）。 */
export async function fetchSourceSnapshot(
  supabase: SupabaseClient,
  ref: CanvasSourceRef,
): Promise<SourceSnapshot | null> {
  return ref.kind === "memo"
    ? fetchMemoSnapshot(supabase, ref.id)
    : fetchReadingSnapshot(supabase, ref.id);
}

/** 极简 HTML→纯文本（快照用：去标签、块级换行、解实体；不信任外部内容）。 */
export function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 按来源图片地址取 Blob（插入画布时复制为画布自有资产，
 * 源文件删除不误删画布图片——资产生命周期解耦，任务书 §十）。
 * 支持 http(s)（公网直取）与站内 /storage 路径（带凭据同域请求）。
 */
export async function fetchImageBlob(src: string): Promise<Blob> {
  const res = await fetch(src, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`图片读取失败（HTTP ${res.status}）`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error("来源地址不是图片");
  return blob;
}
