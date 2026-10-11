"use client";
import { readingSourceLabel } from "@/lib/reading/source";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { DashboardSection, DashboardViewHeader } from "./dashboard-layout";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  FileText,
  CheckCircle2,
  TrendingUp,
  Tag as TagIcon,
  Globe,
  Loader2,
  ListChecks,
  Calendar,
} from "@/components/icons";
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
          const host = readingSourceLabel(item.url);
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

  const {
    totals,
    averageProgress,
    dailyItems,
    dailyRead,
    dailyTasks,
    weeklyStats,
    topTags,
    topSources,
  } = data ?? DEFAULT_DATA;
  const hasAnyData =
    totals.items > 0 ||
    totals.notes > 0 ||
    totals.tasksTotal > 0 ||
    totals.highlights > 0 ||
    totals.favorites > 0;
  const readRate =
    totals.items > 0 ? Math.round((totals.read / totals.items) * 100) : 0;

  return (
    <div className="dashboard-view space-y-5">
      <DashboardViewHeader
        title="趋势统计"
        description="累计概览与最近 30 天的活动趋势"
      />
      {loading ? (
        <div className="dashboard-loading" role="status">
          <Loader2 className="h-5 w-5 animate-spin" /> 加载中…
        </div>
      ) : error ? (
        <EmptyState
          icon={TrendingUp}
          title="加载失败"
          description={error}
          action={
            <Button variant="outline" onClick={loadStats}>
              重试
            </Button>
          }
        />
      ) : !hasAnyData ? (
        <EmptyState
          icon={TrendingUp}
          title="还没有统计数据"
          description="开始添加文章、笔记和任务后，这里会显示你的统计信息"
        />
      ) : (
        <>
          <div className="dashboard-content-grid">
            <MetricGroup
              title="文章"
              icon={BookOpen}
              total={totals.items}
              metrics={[
                { label: "未读", value: totals.unread },
                { label: "在读", value: totals.reading },
                { label: "已读", value: totals.read },
              ]}
            />
            <MetricGroup
              title="任务"
              icon={ListChecks}
              total={totals.tasksTotal}
              metrics={[
                { label: "待办", value: totals.tasksTodo },
                { label: "进行中", value: totals.tasksInProgress },
                { label: "已完成", value: totals.tasksDone },
              ]}
            />
            <MetricGroup
              title="笔记"
              icon={FileText}
              total={totals.notes}
              metrics={[
                { label: "高亮摘录", value: totals.highlights },
                { label: "收藏", value: totals.favorites },
                { label: "置顶文章", value: totals.pinned },
              ]}
            />
          </div>

          <DashboardSection
            title="本周概览"
            icon={Calendar}
            actions={
              <span className="text-xs text-muted-foreground">周一至今</span>
            }
          >
            <dl className="dashboard-inline-metrics">
              {[
                { label: "新增文章", value: weeklyStats.itemsAdded },
                { label: "完成任务", value: weeklyStats.tasksCompleted },
                { label: "新增笔记", value: weeklyStats.notesAdded },
              ].map((metric) => (
                <div key={metric.label}>
                  <dt>{metric.label}</dt>
                  <dd>{metric.value}</dd>
                </div>
              ))}
            </dl>
          </DashboardSection>

          <div className="dashboard-content-grid">
            <DashboardSection
              title="最近 30 天活动"
              icon={TrendingUp}
              className="lg:col-span-2"
              actions={
                <span className="text-xs text-muted-foreground">每日数量</span>
              }
            >
              <DailyBars
                added={dailyItems}
                read={dailyRead}
                tasks={dailyTasks}
              />
            </DashboardSection>

            <DashboardSection title="阅读进度" icon={BookOpen}>
              <div className="space-y-5">
                <ProgressRow label="已读率" value={readRate} />
                <ProgressRow
                  label="平均阅读进度"
                  value={Math.round(averageProgress * 100)}
                />
                <div>
                  <p className="mb-2 text-xs text-muted-foreground">
                    文章状态分布
                  </p>
                  <div
                    className="flex h-2 overflow-hidden rounded-full bg-muted"
                    role="img"
                    aria-label={`未读 ${totals.unread}，在读 ${totals.reading}，已读 ${totals.read}`}
                  >
                    <div
                      className="bg-muted-foreground/30"
                      style={{ width: `${pct(totals.unread, totals.items)}%` }}
                    />
                    <div
                      className="bg-primary/40"
                      style={{ width: `${pct(totals.reading, totals.items)}%` }}
                    />
                    <div
                      className="bg-primary"
                      style={{ width: `${pct(totals.read, totals.items)}%` }}
                    />
                  </div>
                  <dl className="dashboard-stat-rows mt-3">
                    <div>
                      <dt>
                        <span className="bg-muted-foreground/30" />
                        未读
                      </dt>
                      <dd>{totals.unread}</dd>
                    </div>
                    <div>
                      <dt>
                        <span className="bg-primary/40" />
                        在读
                      </dt>
                      <dd>{totals.reading}</dd>
                    </div>
                    <div>
                      <dt>
                        <span className="bg-primary" />
                        已读
                      </dt>
                      <dd>{totals.read}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </DashboardSection>
          </div>

          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <DashboardSection
              title="常用标签"
              icon={TagIcon}
              actions={
                <span className="text-xs text-muted-foreground">
                  Top 5 · 使用次数
                </span>
              }
            >
              <RankingRows
                empty="还没有标签被使用"
                entries={topTags.map((tag) => ({
                  id: tag.id,
                  label: tag.name,
                  count: tag.count,
                  color: tag.color ? `var(--tag-${tag.color})` : undefined,
                }))}
              />
            </DashboardSection>
            <DashboardSection
              title="文章来源"
              icon={Globe}
              actions={
                <span className="text-xs text-muted-foreground">
                  Top 5 · 文章数
                </span>
              }
            >
              <RankingRows
                empty="还没有文章"
                entries={topSources.map((source) => ({
                  id: source.host,
                  label: source.host,
                  count: source.count,
                }))}
              />
            </DashboardSection>
          </div>
        </>
      )}
    </div>
  );
}

function pct(part: number, total: number) {
  return total === 0 ? 0 : (part / total) * 100;
}

function MetricGroup({
  title,
  icon,
  total,
  metrics,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  total: number;
  metrics: Array<{ label: string; value: number }>;
}) {
  return (
    <DashboardSection
      title={title}
      icon={icon}
      actions={<strong className="dashboard-stat-total">{total}</strong>}
    >
      <dl className="dashboard-stat-rows">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
      </dl>
    </DashboardSection>
  );
}

function ProgressRow({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <strong className="font-semibold tabular-nums">{value}%</strong>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

function RankingRows({
  entries,
  empty,
}: {
  entries: Array<{ id: string; label: string; count: number; color?: string }>;
  empty: string;
}) {
  const max = entries[0]?.count || 1;
  return entries.length === 0 ? (
    <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
  ) : (
    <ol className="dashboard-ranking">
      {entries.map((entry, index) => (
        <li key={entry.id}>
          <span className="text-xs text-muted-foreground tabular-nums">
            {index + 1}
          </span>
          <span className="dashboard-ranking-label" title={entry.label}>
            {entry.color && <i style={{ backgroundColor: entry.color }} />}
            <span className="min-w-0 truncate">{entry.label}</span>
          </span>
          <span className="dashboard-ranking-track" aria-hidden="true">
            <span style={{ width: `${(entry.count / max) * 100}%` }} />
          </span>
          <strong className="text-sm font-medium tabular-nums">
            {entry.count}
          </strong>
        </li>
      ))}
    </ol>
  );
}

function DailyBars({
  added,
  read,
  tasks,
}: {
  added: DailyBucket[];
  read: DailyBucket[];
  tasks: DailyBucket[];
}) {
  const max = Math.max(
    1,
    ...added.map((d) => d.count),
    ...read.map((d) => d.count),
    ...tasks.map((d) => d.count),
  );
  return (
    <div>
      <div
        className="dashboard-chart-scroll"
        tabIndex={0}
        role="region"
        aria-label="最近 30 天活动柱状图，可横向滚动"
      >
        <div className="dashboard-chart">
          <div className="dashboard-chart-scale" aria-hidden="true">
            <span>{max}</span>
            <span>{max / 2}</span>
            <span>0</span>
          </div>
          <div className="dashboard-chart-plot">
            {added.map((day, index) => {
              const counts = [
                day.count,
                read[index]?.count || 0,
                tasks[index]?.count || 0,
              ];
              const label = `${day.date} · 新增文章 ${counts[0]} · 已读 ${counts[1]} · 完成任务 ${counts[2]}`;
              return (
                <div
                  key={day.date}
                  className="dashboard-chart-day"
                  role="img"
                  aria-label={label}
                  title={label}
                >
                  {counts.map((count, series) => (
                    <span
                      key={series}
                      className={`dashboard-chart-bar series-${series}`}
                      style={{ height: `${(count / max) * 100}%` }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
          <div className="dashboard-chart-dates" aria-hidden="true">
            {added.map((day, index) => (
              <span key={day.date}>
                {index === 0 ||
                index === added.length - 1 ||
                (index % 7 === 0 && index < added.length - 4)
                  ? day.date.slice(5).replace("-", "/")
                  : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="dashboard-chart-legend">
        <span>
          <i className="series-0" />
          新增文章
        </span>
        <span>
          <i className="series-1" />
          已读文章
        </span>
        <span>
          <i className="series-2" />
          完成任务
        </span>
      </div>
    </div>
  );
}
