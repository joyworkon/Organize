"use client";

// 资料库「全部」视系统一卡片（阶段 C）：标题/正文摘要 + 来源徽标 + 时间 + 标签
// + 阅读状态（仅 reading）+ 仅存链接标识。点击：reading → /library/[id]，
// memo → /library?view=memos&memo=<id>（速记视图内定位高亮）。
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/reading/status-badge";
import { isInternalUrn, readingSourceLabel } from "@/lib/reading/source";
import { cn } from "@/lib/utils";
import type { LibraryItem } from "@organize/shared";
import { Feather, Globe, Link2, PackageOpen } from "@/components/icons";
import { AddToCanvasButton } from "./add-to-canvas-dialog";

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
    <Link href={href} className="block">
      <Card className="transition-colors duration-150 hover:bg-accent">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Icon className="h-3 w-3 shrink-0" />
            <span className="truncate">{label}</span>
            {item.is_link_only && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                <Link2 className="h-2.5 w-2.5" />
                仅存链接
              </span>
            )}
            {item.reading_status && (
              <span className="ml-auto shrink-0" onClick={(e) => e.preventDefault()}>
                <StatusBadge status={item.reading_status} />
              </span>
            )}
          </div>
          <h2 className="mt-1 line-clamp-2 font-medium leading-tight">{cardTitle(item)}</h2>
          {item.excerpt && item.source_type === "reading" && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.excerpt}</p>
          )}
          {item.source_type === "memo" && item.excerpt && (
            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {item.excerpt}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>{new Date(item.created_at).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}</span>
            {item.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
                #{tag}
              </span>
            ))}
            <span className="ml-auto" onClick={(e) => e.preventDefault()}>
              <AddToCanvasButton item={item} />
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
