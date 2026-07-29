"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  ListChecks,
  Star,
  Highlighter,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";

interface DailyBucket {
  date: string;
  count: number;
}

interface WeeklyStats {
  itemsAdded: number;
  tasksCompleted: number;
  notesAdded: number;
}

interface StatsData {
  totals: {
    items: number;
    notes: number;
    unread: number;
    reading: number;
    read: number;
    pinned: number;
    tasksTotal: number;
    tasksDone: number;
    tasksInProgress: number;
    tasksTodo: number;
    highlights: number;
    favorites: number;
  };
  averageProgress: number;
  dailyItems: DailyBucket[];
  dailyRead: DailyBucket[];
  dailyTasks: DailyBucket[];
  weeklyStats: WeeklyStats;
  topTags: Array<{ id: string; name: string; count: number; color?: string }>;
  topSources: Array<{ host: string; count: number }>;
}

const DAYS = 30;

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getWeekStart(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

const DEFAULT_DATA: StatsData = {
  totals: {
    items: 0,
    notes: 0,
    unread: 0,
    reading: 0,
    read: 0,
    pinned: 0,
    tasksTotal: 0,
    tasksDone: 0,
    tasksInProgress: 0,
    tasksTodo: 0,
    highlights: 0,
    favorites: 0,
  },
  averageProgress: 0,
  dailyItems: [],
  dailyRead: [],
  dailyTasks: [],
  weeklyStats: {
    itemsAdded: 0,
    tasksCompleted: 0,
    notesAdded: 0,
  },
  topTags: [],
  topSources: [],
};

export default function StatsView() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setData(DEFAULT_DATA);
        return;
      }

      const since = new Date();
      since.setDate(since.getDate() - (DAYS - 1));
      since.setHours(0, 0, 0, 0);

      const weekStart = getWeekStart(new Date());

      const results = await Promise.allSettled([
        supabase
          .from("reading_items")
          .select("id, reading_status, reading_progress, created_at, updated_at, url, is_pinned")
          .eq("user_id", user.id),
        supabase.from("notes").select("id, created_at").eq("user_id", user.id),
        supabase.from("reading_items").select("id").eq("user_id", user.id).eq("is_pinned", true),
        supabase.from("tasks").select("id, status, completed_at, created_at").eq("user_id", user.id),
        supabase.from("highlights").select("id").eq("user_id", user.id),
        supabase.from("favorites").select("id").eq("user_id", user.id),
        supabase.from("item_tags").select("tag_id"),
        supabase.from("note_tags").select("tag_id"),
      ]);

      const [
        itemsRes,
        notesRes,
        pinnedItemsRes,
        tasksRes,
        highlightsRes,
        favoritesRes,
        itemTagsRes,
        noteTagsRes,
      ] = results;

      const items = itemsRes.status === "fulfilled" && !itemsRes.value.error ? (itemsRes.value.data || []) : [];
      const notes = notesRes.status === "fulfilled" && !notesRes.value.error ? (notesRes.value.data || []) : [];
      const pinnedItems = pinnedItemsRes.status === "fulfilled" && !pinnedItemsRes.value.error ? (pinnedItemsRes.value.data || []) : [];
      const tasks = tasksRes.status === "fulfilled" && !tasksRes.value.error ? (tasksRes.value.data || []) : [];
      const highlightsCount = highlightsRes.status === "fulfilled" && !highlightsRes.value.error ? (highlightsRes.value.data?.length || 0) : 0;
      const favoritesCount = favoritesRes.status === "fulfilled" && !favoritesRes.value.error ? (favoritesRes.value.data?.length || 0) : 0;
      const itemTags = itemTagsRes.status === "fulfilled" && !itemTagsRes.value.error ? (itemTagsRes.value.data || []) : [];
      const noteTags = noteTagsRes.status === "fulfilled" && !noteTagsRes.value.error ? (noteTagsRes.value.data || []) : [];

      const totals = {
        items: items.length,
        notes: notes.length,
        unread: items.filter((i: any) => i.reading_status === "unread").length,
        reading: items.filter((i: any) => i.reading_status === "reading").length,
        read: items.filter((i: any) => i.reading_status === "read").length,
        pinned: pinnedItems.length,
        tasksTotal: tasks.length,
        tasksDone: tasks.filter((t: any) => t.status === "done").length,
        tasksInProgress: tasks.filter((t: any) => t.status === "in_progress").length,
        tasksTodo: tasks.filter((t: any) => t.status === "todo").length,
        highlights: highlightsCount,
        favorites: favoritesCount,
      };

      const averageProgress =
        items.length === 0
          ? 0
          : items.reduce((sum: number, i: any) => sum + (i.reading_progress || 0), 0) / items.length;

      const dailyMap = new Map<string, number>();
      const readMap = new Map<string, number>();
      const taskMap = new Map<string, number>();
      for (let i = DAYS - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = formatDate(d);
        dailyMap.set(dateStr, 0);
        readMap.set(dateStr, 0);
        taskMap.set(dateStr, 0);
      }

      let weeklyItemsAdded = 0;
      let weeklyNotesAdded = 0;
      let weeklyTasksCompleted = 0;

      for (const item of items) {
        const createdDate = formatDate(new Date(item.created_at));
        if (dailyMap.has(createdDate)) {
          dailyMap.set(createdDate, (dailyMap.get(createdDate) || 0) + 1);
        }
        const itemCreatedAt = new Date(item.created_at);
        if (itemCreatedAt >= weekStart) {
          weeklyItemsAdded++;
        }
        if (item.reading_status === "read" && item.updated_at) {
          const updatedDate = formatDate(new Date(item.updated_at));
          if (new Date(item.updated_at) >= since && readMap.has(updatedDate)) {
            readMap.set(updatedDate, (readMap.get(updatedDate) || 0) + 1);
          }
        }
      }

      for (const note of notes) {
        const noteCreatedAt = new Date(note.created_at);
        if (noteCreatedAt >= weekStart) {
          weeklyNotesAdded++;
        }
      }

      for (const task of tasks) {
        if (task.status === "done" && task.completed_at) {
          const completedDate = formatDate(new Date(task.completed_at));
          if (taskMap.has(completedDate)) {
            taskMap.set(completedDate, (taskMap.get(completedDate) || 0) + 1);
          }
          const taskCompletedAt = new Date(task.completed_at);
          if (taskCompletedAt >= weekStart) {
            weeklyTasksCompleted++;
          }
        }
      }

      const dailyItems = Array.from(dailyMap, ([date, count]) => ({ date, count }));
      const dailyRead = Array.from(readMap, ([date, count]) => ({ date, count }));
      const dailyTasks = Array.from(taskMap, ([date, count]) => ({ date, count }));

      const weeklyStats: WeeklyStats = {
        itemsAdded: weeklyItemsAdded,
        tasksCompleted: weeklyTasksCompleted,
        notesAdded: weeklyNotesAdded,
      };

      const tagUse = new Map<string, number>();
      for (const r of itemTags) {
        tagUse.set(r.tag_id, (tagUse.get(r.tag_id) || 0) + 1);
      }
      for (const r of noteTags) {
        tagUse.set(r.tag_id, (tagUse.get(r.tag_id) || 0) + 1);
      }
      const usedTagIds = Array.from(tagUse.keys());
      let topTags: StatsData["topTags"] = [];
      if (usedTagIds.length > 0) {
        try {
          const { data: tagRows, error: tagError } = await supabase
            .from("tags")
            .select("id, name, color")
            .eq("user_id", user.id)
            .in("id", usedTagIds);
          if (!tagError) {
            topTags = (tagRows || [])
              .map((t: any) => ({ id: t.id, name: t.name, color: t.color, count: tagUse.get(t.id) || 0 }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 5);
          }
        } catch {
          topTags = [];
        }
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
        dailyTasks,
        weeklyStats,
        topTags,
        topSources,
      });
    } catch (err) {
      console.error("Failed to load stats:", err);
      setError(err instanceof Error ? err.message : "加载统计数据失败");
      setData(DEFAULT_DATA);
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

  if (error && !data) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">统计</h1>
        <EmptyState
          icon={Loader2}
          title="加载失败"
          description={error}
          action={
            <Button onClick={loadStats}>
              重试
            </Button>
          }
        />
      </div>
    );
  }

  const totals = data?.totals ?? DEFAULT_DATA.totals;
  const averageProgress = data?.averageProgress ?? DEFAULT_DATA.averageProgress;
  const dailyItems = data?.dailyItems ?? DEFAULT_DATA.dailyItems;
  const dailyRead = data?.dailyRead ?? DEFAULT_DATA.dailyRead;
  const dailyTasks = data?.dailyTasks ?? DEFAULT_DATA.dailyTasks;
  const weeklyStats = data?.weeklyStats ?? DEFAULT_DATA.weeklyStats;
  const topTags = data?.topTags ?? DEFAULT_DATA.topTags;
  const topSources = data?.topSources ?? DEFAULT_DATA.topSources;

  const hasAnyData =
    totals.items > 0 ||
    totals.notes > 0 ||
    totals.tasksTotal > 0;

  const readRate = totals.items > 0 ? Math.round((totals.read / totals.items) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">阅读统计</h1>
        <p className="text-muted-foreground mt-1">最近 30 天的阅读、笔记和任务数据</p>
      </div>

      {!hasAnyData ? (
        <EmptyState
          icon={TrendingUp}
          title="还没有统计数据"
          description="开始添加文章、笔记和任务后，这里会显示你的统计信息"
        />
      ) : (
        <>
          {/* 顶部数字卡片 - 可滚动 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <StatCard icon={BookOpen} label="总文章" value={totals.items} />
            <StatCard icon={Clock} label="未读" value={totals.unread} />
            <StatCard icon={BookOpen} label="在读" value={totals.reading} accent />
            <StatCard icon={CheckCircle2} label="已读" value={totals.read} primary />
            <StatCard icon={FileText} label="笔记" value={totals.notes} />
            <StatCard icon={Pin} label="置顶" value={totals.pinned} />
            <StatCard icon={ListChecks} label="总任务" value={totals.tasksTotal} />
            <StatCard icon={CheckCircle2} label="完成任务" value={totals.tasksDone} primary />
            <StatCard icon={ListChecks} label="进行中" value={totals.tasksInProgress} accent />
            <StatCard icon={Clock} label="待办" value={totals.tasksTodo} />
            <StatCard icon={Highlighter} label="高亮" value={totals.highlights} />
            <StatCard icon={Star} label="收藏" value={totals.favorites} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* 本周概览 */}
            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  本周概览
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <BookOpen className="h-5 w-5 mx-auto mb-2 text-primary" />
                    <p className="text-2xl font-bold text-primary">{weeklyStats.itemsAdded}</p>
                    <p className="text-xs text-muted-foreground">新增文章</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <CheckCircle2 className="h-5 w-5 mx-auto mb-2 text-green-500" />
                    <p className="text-2xl font-bold text-green-500">{weeklyStats.tasksCompleted}</p>
                    <p className="text-xs text-muted-foreground">完成任务</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <FileText className="h-5 w-5 mx-auto mb-2 text-blue-500" />
                    <p className="text-2xl font-bold text-blue-500">{weeklyStats.notesAdded}</p>
                    <p className="text-xs text-muted-foreground">新增笔记</p>
                  </div>
                </div>
              </CardContent>
            </Card>

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
            <Card className="lg:col-span-2">
              <CardContent className="p-5">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  最近 30 天活动
                </h3>
                <DailyBars
                  added={dailyItems}
                  read={dailyRead}
                  tasks={dailyTasks}
                  max={Math.max(
                    1,
                    ...dailyItems.map((d) => d.count),
                    ...dailyRead.map((d) => d.count),
                    ...dailyTasks.map((d) => d.count)
                  )}
                />
                <div className="flex flex-wrap items-center gap-4 mt-3 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-primary/70" /> 新增文章
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-primary" /> 已读
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-green-500" /> 完成任务
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
                      const max = topTags[0]?.count || 1;
                      return (
                        <div key={tag.id} className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                          <div className="flex-1">
                            <div className="flex justify-between text-sm mb-1">
                              <span className="truncate flex items-center gap-1.5">
                                {tag.color && (
                                  <span
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: `var(--tag-${tag.color})` }}
                                  />
                                )}
                                {tag.name}
                              </span>
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
                      const max = topSources[0]?.count || 1;
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
        </>
      )}
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
  tasks,
  max,
}: {
  added: DailyBucket[];
  read: DailyBucket[];
  tasks: DailyBucket[];
  max: number;
}) {
  return (
    <div className="flex items-end gap-0.5 h-32">
      {added.map((d, i) => {
        const r = read[i]?.count || 0;
        const t = tasks[i]?.count || 0;
        const addH = (d.count / max) * 100;
        const readH = (r / max) * 100;
        const taskH = (t / max) * 100;
        return (
          <div
            key={d.date}
            className="flex-1 flex flex-col-reverse items-stretch relative group"
            title={`${d.date} · 新增 ${d.count} · 已读 ${r} · 完成任务 ${t}`}
          >
            <div
              className="bg-primary/70 group-hover:bg-primary/80 transition-colors rounded-sm"
              style={{ height: `${addH}%` }}
            />
            <div
              className="bg-primary group-hover:bg-primary/90 transition-colors rounded-sm"
              style={{ height: `${readH}%` }}
            />
            <div
              className="bg-green-500 group-hover:bg-green-600 transition-colors rounded-sm"
              style={{ height: `${taskH}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
