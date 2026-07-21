"use client";

import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "./status-badge";
import type { ReadingItem, ReadingStatus } from "@organize/shared";
import { ExternalLink, Trash2 } from "lucide-react";

interface ReadingCardProps {
  item: ReadingItem;
  onStatusChange?: (id: string, status: ReadingStatus) => void;
  onDelete?: (id: string) => void;
}

export function ReadingCard({ item, onStatusChange, onDelete }: ReadingCardProps) {
  const cycleStatus = (current: ReadingStatus): ReadingStatus => {
    const order: ReadingStatus[] = ["unread", "reading", "read"];
    const idx = order.indexOf(current);
    return order[(idx + 1) % order.length];
  };

  return (
    <Card className="group hover:shadow-md transition-all duration-200">
      <CardContent className="p-4">
        <div className="flex gap-4">
          {item.cover_image && (
            <div className="relative w-20 h-20 rounded-md overflow-hidden shrink-0 hidden sm:block">
              <Image
                src={item.cover_image}
                alt=""
                fill
                sizes="80px"
                className="object-cover"
                loading="lazy"
              />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-medium leading-tight line-clamp-2">
                {item.title || item.url}
              </h3>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded hover:bg-accent"
                  title="打开原文"
                >
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </a>
                {onDelete && (
                  <button
                    onClick={() => onDelete(item.id)}
                    className="p-1.5 rounded hover:bg-accent"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </button>
                )}
              </div>
            </div>

            {item.excerpt && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {item.excerpt}
              </p>
            )}

            <div className="flex items-center gap-3 mt-3">
              <StatusBadge
                status={item.reading_status}
                onClick={
                  onStatusChange
                    ? () => onStatusChange(item.id, cycleStatus(item.reading_status))
                    : undefined
                }
              />

              {item.reading_progress > 0 && item.reading_status !== "read" && (
                <div className="flex items-center gap-1.5">
                  <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${Math.round(item.reading_progress * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {Math.round(item.reading_progress * 100)}%
                  </span>
                </div>
              )}

              <span className="text-xs text-muted-foreground">
                {new Date(item.created_at).toLocaleDateString("zh-CN")}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
