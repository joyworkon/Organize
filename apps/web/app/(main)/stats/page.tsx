"use client";

import { useEffect, useState } from "react";
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

export default function StatsPage() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">统计</h1>
        <p className="text-muted-foreground">加载中...</p>
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
        <StatCard icon={BookOpen} label="总文章" value={totals.items} color="text-blue-500" />
        <StatCard icon={Clock} label="未读" value={totals.unread} color="text-gray-500" />
        <StatCard icon={BookOpen} label="在读" value={totals.reading} color="text-orange-500" />
        <StatCard icon={CheckCircle2} label="已读" value={totals.read} color="text-green-500" />
        <StatCard icon={FileText} label="笔记" value={totals.notes} color="text-purple-500" />
        <StatCard icon={Pin} label="置顶" value={totals.pinned} color="text-yellow-500" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 阅读进度概览 */}
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              阅读进度概览
            </h3>
            <div className="space-y-4">
              <ProgressRow label="已读率" value={readRate} suffix="%" />
              <ProgressRow
                label="平均阅读进度"
                value={Math.round(averageProgress * 100)}
                suffix="%"
              />
              {/* 三态分布条 */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">状态分布</p>
                <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                  <div
                    className="bg-gray-400"
                    style={{ width: `${pct(totals.unread, totals.items)}%` }}
                    title={`未读 ${totals.unread}`}
                  />
                  <div
                    className="bg-orange-400"
                    style={{ width: `${pct(totals.reading, totals.items)}%` }}
                    title={`在读 ${totals.reading}`}
                  />
                  <div
                    className="bg-green-500"
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
              <TrendingUp className="h-4 w-4" />
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
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> 新增
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-green-500" /> 已读
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Top 标签 */}
        <Card>
          <CardContent className="p-5">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <TagIcon className="h-4 w-4" />
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
              <Globe className="h-4 w-4" />
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
                            className="h-full bg-blue-400 rounded-full transition-all"
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
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <Icon className={cn("h-4 w-4 mx-auto mb-1", color)} />
      <p className="text-2xl font-bold">{value}</p>
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
            {/* 已读在上，新增在下 */}
            <div
              className="bg-blue-500 group-hover:bg-blue-600 transition-colors rounded-sm"
              style={{ height: `${addH}%` }}
            />
            <div
              className="bg-green-500 group-hover:bg-green-600 transition-colors rounded-sm"
              style={{ height: `${readH}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
