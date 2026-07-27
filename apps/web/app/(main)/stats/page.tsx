"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  BookOpen,
  FileText,
  Clock,
  CheckCircle2,
  Pin,
  TrendingUp,
  Tag as TagIcon,
  Globe,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DailyBucket {
  date: string;
  count: number;
}
interface StatsData {
  totals: {
    items: number;
    notes: number;
    unread: number;
    reading: number;
    read: number;
    pinned: number;
  };
  averageProgress: number;
  dailyItems: DailyBucket[];
  dailyRead: DailyBucket[];
  topTags: Array<{ id: string; name: string; count: number }>;
  topSources: Array<{ host: string; count: number }>;
}

const DAYS = 30;

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function StatsPage() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setData(null);
        return;
      }

      const since = new Date();
      since.setDate(since.getDate() - (DAYS - 1));
      const sinceIso = since.toISOString();

      const [itemsRes, notesRes, pinnedItemsRes, itemTagsRes, noteTagsRes] = await Promise.all([
        supabase
          .from("reading_items")
          .select("id, reading_status, reading_progress, created_at, updated_at, url, is_pinned")
          .eq("user_id", user.id),
        supabase.from("notes").select("id").eq("user_id", user.id),
        supabase.from("reading_items").select("id").eq("user_id", user.id).eq("is_pinned", true),
        supabase.from("item_tags").select("tag_id"),
        supabase.from("note_tags").select("tag_id"),
      ]);

      const items = itemsRes.data || [];
      const notes = notesRes.data || [];
      const pinnedItems = pinnedItemsRes.data || [];

      const totals = {
        items: items.length,
        notes: notes.length,
        unread: items.filter((i: any) => i.reading_status === "unread").length,
        reading: items.filter((i: any) => i.reading_status === "reading").length,
        read: items.filter((i: any) => i.reading_status === "read").length,
        pinned: pinnedItems.length,
      };

      const averageProgress =
        items.length === 0
          ? 0
          : items.reduce((sum: number, i: any) => sum + (i.reading_progress || 0), 0) / items.length;

      const dailyMap = new Map<string, number>();
      const readMap = new Map<string, number>();
      for (let i = DAYS - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dailyMap.set(formatDate(d), 0);
        readMap.set(formatDate(d), 0);
      }
      for (const item of items) {
        const createdDate = formatDate(new Date(item.created_at));
        if (dailyMap.has(createdDate)) {
          dailyMap.set(createdDate, (dailyMap.get(createdDate) || 0) + 1);
        }
        if (item.reading_status === "read" && item.updated_at) {
          const updatedDate = formatDate(new Date(item.updated_at));
          if (new Date(item.updated_at) >= since && readMap.has(updatedDate)) {
            readMap.set(updatedDate, (readMap.get(updatedDate) || 0) + 1);
          }
        }
      }
      const dailyItems = Array.from(dailyMap, ([date, count]) => ({ date, count }));
      const dailyRead = Array.from(readMap, ([date, count]) => ({ date, count }));

      const tagUse = new Map<string, number>();
      for (const r of itemTagsRes.data || []) {
        tagUse.set(r.tag_id, (tagUse.get(r.tag_id) || 0) + 1);
      }
      for (const r of noteTagsRes.data || []) {
        tagUse.set(r.tag_id, (tagUse.get(r.tag_id) || 0) + 1);
      }
      const usedTagIds = Array.from(tagUse.keys());
      let topTags: StatsData["topTags"] = [];
      if (usedTagIds.length > 0) {
        const { data: tagRows } = await supabase
          .from("tags")
          .select("id, name")
          .in("id", usedTagIds);
        topTags = (tagRows || [])
          .map((t: any) => ({ id: t.id, name: t.name, count: tagUse.get(t.id) || 0 }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
      }

      const hostMap = new Map<string, number>();
      for (const item of items) {
        try {
          const host = new URL(item.url).hostname.replace(/^www\./, "");
          hostMap.set(host, (hostMap.get(host) || 0) + 1);
        } catch {
          // skip invalid URL
        }
      }
      const topSources = Array.from(hostMap, ([host, count]) => ({ host, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      setData({
        totals,
        averageProgress,
        dailyItems,
        dailyRead,
        topTags,
        topSources,
      });
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">统计</h1>
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          加载中...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">统计</h1>
        <p className="text-muted-foreground">加载失败</p>
      </div>
    );
  }

  const { totals, averageProgress, dailyItems, dailyRead, topTags, topSources } = data;
  const readRate = totals.items > 0 ? Math.round((totals.read / totals.items) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">阅读统计</h1>
        <p className="text-muted-foreground mt-1">最近 30 天的阅读和笔记数据</p>
      </div>

      {/* 顶部数字卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard icon={BookOpen} label="总文章" value={totals.items} />
        <StatCard icon={Clock} label="未读" value={totals.unread} />
        <StatCard icon={BookOpen} label="在读" value={totals.reading} accent />
        <StatCard icon={CheckCircle2} label="已读" value={totals.read} primary />
        <StatCard icon={FileText} label="笔记" value={totals.notes} />
        <StatCard icon={Pin} label="置顶" value={totals.pinned} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 阅读进度概览 */}
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              阅读进度概览
            </h3>
            <div className="space-y-4">
              <ProgressRow label="已读率" value={readRate} suffix="%" />
              <ProgressRow
                label="平均阅读进度"
                value={Math.round(averageProgress * 100)}
                suffix="%"
              />
              <div>
                <p className="text-xs text-muted-foreground mb-2">状态分布</p>
                <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                  <div
                    className="bg-muted-foreground/40"
                    style={{ width: `${pct(totals.unread, totals.items)}%` }}
                    title={`未读 ${totals.unread}`}
                  />
                  <div
                    className="bg-accent-foreground/60"
                    style={{ width: `${pct(totals.reading, totals.items)}%` }}
                    title={`在读 ${totals.reading}`}
                  />
                  <div
                    className="bg-primary"
                    style={{ width: `${pct(totals.read, totals.items)}%` }}
                    title={`已读 ${totals.read}`}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>未读 {totals.unread}</span>
                  <span>在读 {totals.reading}</span>
                  <span>已读 {totals.read}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 最近 30 天活动柱状图 */}
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              最近 30 天活动
            </h3>
            <DailyBars
              added={dailyItems}
              read={dailyRead}
              max={Math.max(
                1,
                ...dailyItems.map((d) => d.count),
                ...dailyRead.map((d) => d.count)
              )}
            />
            <div className="flex items-center gap-4 mt-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-primary/70" /> 新增
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-primary" /> 已读
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Top 标签 */}
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <TagIcon className="h-4 w-4 text-primary" />
              标签 Top 5
            </h3>
            {topTags.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有标签被使用</p>
            ) : (
              <div className="space-y-2">
                {topTags.map((tag, i) => {
                  const max = topTags[0].count;
                  return (
                    <div key={tag.id} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="truncate">{tag.name}</span>
                          <span className="text-muted-foreground">{tag.count}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${(tag.count / max) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top 来源 */}
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              来源站点 Top 5
            </h3>
            {topSources.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有文章</p>
            ) : (
              <div className="space-y-2">
                {topSources.map((src, i) => {
                  const max = topSources[0].count;
                  return (
                    <div key={src.host} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="truncate">{src.host}</span>
                          <span className="text-muted-foreground">{src.count}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary/60 rounded-full transition-all"
                            style={{ width: `${(src.count / max) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function pct(part: number, total: number) {
  return total === 0 ? 0 : (part / total) * 100;
}

function StatCard({
  icon: Icon,
  label,
  value,
  primary = false,
  accent = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  primary?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <Icon
        className={cn(
          "h-4 w-4 mx-auto mb-1",
          primary ? "text-primary" : accent ? "text-accent-foreground" : "text-muted-foreground"
        )}
      />
      <p className={cn("text-2xl font-bold", primary && "text-primary")}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function ProgressRow({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="font-medium">
          {value}
          {suffix}
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

function DailyBars({
  added,
  read,
  max,
}: {
  added: DailyBucket[];
  read: DailyBucket[];
  max: number;
}) {
  return (
    <div className="flex items-end gap-0.5 h-32">
      {added.map((d, i) => {
        const r = read[i]?.count || 0;
        const addH = (d.count / max) * 100;
        const readH = (r / max) * 100;
        return (
          <div
            key={d.date}
            className="flex-1 flex flex-col-reverse items-stretch relative group"
            title={`${d.date} · 新增 ${d.count} · 已读 ${r}`}
          >
            <div
              className="bg-primary/70 group-hover:bg-primary/80 transition-colors rounded-sm"
              style={{ height: `${addH}%` }}
            />
            <div
              className="bg-primary group-hover:bg-primary/90 transition-colors rounded-sm"
              style={{ height: `${readH}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
