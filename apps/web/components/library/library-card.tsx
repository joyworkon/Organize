"use client";

// 资料库「全部」视系统一卡片（阶段 C）：标题/正文摘要 + 来源徽标 + 时间 + 标签
// + 阅读状态（仅 reading）+ 仅存链接标识。点击：reading → /library/[id]，
// memo → /library?view=memos&memo=<id>（速记视图内定位高亮）。
import Link from "next/link";
import { StatusBadge } from "@/components/reading/status-badge";
import { isInternalUrn, readingSourceLabel } from "@/lib/reading/source";
import type { LibraryItem } from "@organize/shared";
import { Feather, Globe, Link2, PackageOpen } from "@/components/icons";
import { AddToCanvasButton } from "./add-to-canvas-dialog";
import { AddToCollectionsButton } from "@/components/collections/add-to-collections-button";

function sourceBadge(item: LibraryItem): { label: string; Icon: typeof Globe } {
  if (item.source_type === "memo") return { label: "速记", Icon: Feather };
  if (item.url && isInternalUrn(item.url)) return { label: readingSourceLabel(item.url), Icon: PackageOpen };
  return { label: item.url ? readingSourceLabel(item.url) || "网页" : "网页", Icon: Globe };
}

function cardTitle(item: LibraryItem): string {
  if (item.source_type === "memo") {
    return (item.excerpt || "").split("\n")[0].trim() || "空速记";
  }
  return item.title || item.url || "无标题";
}

export function LibraryCard({ item }: { item: LibraryItem }) {
  const { label, Icon } = sourceBadge(item);
  const href =
    item.source_type === "memo"
      ? `/library?view=memos&memo=${item.id}`
      : `/library/${item.id}`;

  return (
    <article data-library-card className="group flex min-w-0 items-start gap-3 border-b py-4 last:border-b-0 hover:bg-accent/50">
      <Link href={href} className="min-w-0 flex-1 rounded-md px-1">
        <h2 className="line-clamp-2 text-sm font-medium leading-6">{cardTitle(item)}</h2>
        {item.excerpt && item.source_type === "reading" && (
          <p className="mt-1 line-clamp-1 text-xs leading-relaxed text-muted-foreground">{item.excerpt}</p>
        )}
        {item.source_type === "memo" && item.excerpt && item.excerpt.includes("\n") && (
          <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{item.excerpt}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[12rem] truncate">{label}</span>
          <span>{new Date(item.created_at).toLocaleDateString("zh-CN")}</span>
          {item.reading_status && <StatusBadge status={item.reading_status} />}
          {item.is_link_only && <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" />仅存链接</span>}
          {item.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">#{tag}</span>)}
          {item.tags.length > 3 && <span>+{item.tags.length - 3}</span>}
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
        <AddToCollectionsButton
          sourceType={item.source_type === "memo" ? "memo" : "reading"}
          id={item.id}
          hintTitle={item.source_type === "memo" ? (item.excerpt || "").split("\n")[0] : item.title}
          hintTags={item.tags}
        />
        <AddToCanvasButton item={item} />
      </div>
    </article>
  );
}
