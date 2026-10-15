"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DashboardSection, DashboardViewHeader } from "./dashboard-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  BookOpen,
  FileText,
  Highlighter,
  Loader2,
} from "@/components/icons";
import { cn } from "@/lib/utils";

interface Task {
  id: string;
  title: string;
  category: "work" | "study" | "life";
  completed_at: string;
}

interface ReadingItem {
  id: string;
  title: string;
  reading_status: "unread" | "reading" | "read";
  reading_progress: number;
  activity_at: string;
  activity_type: "started" | "completed";
}

interface Note {
  id: string;
  title: string | null;
  updated_at: string;
  activity_at: string;
}

interface Highlight {
  id: string;
  content: string;
  color: "yellow" | "green" | "blue" | "pink" | "purple";
  reading_items: { title: string | null } | null;
  reading_item_id: string;
  created_at: string;
}

interface ReviewData {
  loadedDate: string;
  tasks: Task[];
  readingItems: ReadingItem[];
  notes: Note[];
  highlights: Highlight[];
}

const CATEGORY_COLORS: Record<string, string> = {
  work: "bg-blue-500",
  study: "bg-green-500",
  life: "bg-pink-500",
};

const CATEGORY_LABELS: Record<string, string> = {
  work: "工作",
  study: "学习",
  life: "生活",
};

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

function getDayRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function formatDateDisplay(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const weekday = WEEKDAYS[date.getDay()];
  return `${y}年${m}月${d}日 ${weekday}`;
}

function dateParam(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateParam(value: string | null): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date();
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : new Date();
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export default function ReviewView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedDate, setSelectedDate] = useState(() => parseDateParam(searchParams.get("reviewDate")));
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const requestId = useRef(0);

  const today = new Date();

  const loadData = useCallback(
    async (date: Date) => {
      const request = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!user) {
          setData(null);
          return;
        }

        const { start, end } = getDayRange(date);
        const startIso = start.toISOString();
        const endIso = end.toISOString();

        const [tasksRes, readingStartedRes, readingCompletedRes, notesRes, highlightsRes] = await Promise.all([
          supabase
            .from("tasks")
            .select("id, title, category, completed_at")
            .eq("user_id", user.id)
            .eq("status", "done")
            .gte("completed_at", startIso)
            .lte("completed_at", endIso)
            .order("completed_at", { ascending: true })
            .limit(10),
          supabase
            .from("reading_items")
            .select("id, title, reading_status, reading_progress, started_reading_at")
            .eq("user_id", user.id)
            .gte("started_reading_at", startIso).lte("started_reading_at", endIso)
            .order("started_reading_at", { ascending: false })
            .limit(10),
          supabase
            .from("reading_items")
            .select("id, title, reading_status, reading_progress, completed_reading_at")
            .eq("user_id", user.id)
            .gte("completed_reading_at", startIso).lte("completed_reading_at", endIso)
            .order("completed_reading_at", { ascending: false })
            .limit(10),
          supabase
            .from("notes")
            .select("id, title, updated_at")
            .eq("user_id", user.id)
            .gte("updated_at", startIso)
            .lte("updated_at", endIso)
            .order("updated_at", { ascending: false })
            .limit(10),
          supabase
            .from("highlights")
            .select("id, content, color, created_at, reading_item_id, reading_items(title)")
            .eq("user_id", user.id)
            .gte("created_at", startIso)
            .lte("created_at", endIso)
            .order("created_at", { ascending: false })
            .limit(10),
        ]);

        const failed = [tasksRes, readingStartedRes, readingCompletedRes, notesRes, highlightsRes].find((result) => result.error);
        if (failed?.error) throw failed.error;
        if (request !== requestId.current) return;

        const readingItemsById = new Map<string, ReadingItem>();
        for (const item of readingStartedRes.data || []) {
          readingItemsById.set(item.id, { ...item, activity_at: item.started_reading_at, activity_type: "started" } as ReadingItem);
        }
        for (const item of readingCompletedRes.data || []) {
          readingItemsById.set(item.id, { ...item, activity_at: item.completed_reading_at, activity_type: "completed" } as ReadingItem);
        }
        const readingItems = [...readingItemsById.values()]
          .sort((a, b) => new Date(b.activity_at).getTime() - new Date(a.activity_at).getTime()).slice(0, 10);
        setData({
          loadedDate: dateParam(date),
          tasks: (tasksRes.data || []).slice(0, 10) as Task[],
          readingItems,
          notes: (notesRes.data || []).map((note) => ({ ...note, activity_at: note.updated_at })) as Note[],
          highlights: (highlightsRes.data || []) as Highlight[],
        });
      } catch (err) {
        console.error("Failed to load review data:", err);
        if (request === requestId.current) setError("加载数据失败，请重试");
      } finally {
        if (request === requestId.current) setLoading(false);
      }
    },
    [supabase]
  );

  useEffect(() => {
    loadData(selectedDate);
  }, [selectedDate, loadData]);

  const goToPrevDay = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    selectDate(prev);
  };

  const goToNextDay = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    selectDate(next);
  };

  const goToToday = () => {
    selectDate(new Date());
  };

  const selectDate = (date: Date) => {
    setSelectedDate(date);
    const params = new URLSearchParams(searchParams.toString());
    params.set("reviewDate", dateParam(date));
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const isToday = isSameDay(selectedDate, today);

  return (
    <div className="dashboard-view space-y-5">
      <DashboardViewHeader
        title="日历回顾"
        description={formatDateDisplay(selectedDate)}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={goToPrevDay}
              aria-label="前一天"
              className="h-8 w-8"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={goToToday}
              disabled={isToday}
            >
              回到今天
            </Button>
            <input
              type="date"
              aria-label="选择回顾日期"
              value={dateParam(selectedDate)}
              max={dateParam(today)}
              onChange={(event) => { if (event.target.value) selectDate(parseDateParam(event.target.value)); }}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={goToNextDay}
              disabled={isToday}
              aria-label="后一天"
              className="h-8 w-8"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />
      {loading ? (
        <div className="dashboard-loading" role="status">
          <Loader2 className="h-5 w-5 animate-spin" /> 加载中…
        </div>
      ) : error && (!data || data.loadedDate !== dateParam(selectedDate)) ? (
        <div className="dashboard-loading">
          <p>{error}{data && ` 上次成功日期为 ${data.loadedDate}。`}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadData(selectedDate)}
          >
            重试
          </Button>
        </div>
      ) : data ? (
        <>
          {error && (
            <div className="flex items-center justify-between rounded-lg border border-destructive/30 px-3 py-2 text-sm" role="alert">
              <span>该日期刷新失败，当前显示同一日期上次成功的内容。</span>
              <Button variant="outline" size="sm" onClick={() => void loadData(selectedDate)}>重试</Button>
            </div>
          )}
          <DashboardSection title="当日概览" icon={CheckCircle2}>
            <dl className="dashboard-inline-metrics metrics-4">
              {[
                { label: "完成任务（展示条数）", value: data.tasks.length },
                { label: "阅读活动（展示条数）", value: data.readingItems.length },
                { label: "最近更新笔记（展示条数）", value: data.notes.length },
                { label: "新增高亮（展示条数）", value: data.highlights.length },
              ].map((metric) => (
                <div key={metric.label}>
                  <dt>{metric.label}</dt>
                  <dd>{metric.value}</dd>
                </div>
              ))}
            </dl>
          </DashboardSection>
          <div className="dashboard-content-grid">
            <div className="min-w-0 space-y-4 lg:col-span-2">
              <DashboardSection
                title="完成任务（最多展示 10 条）"
                icon={CheckCircle2}
                actions={<Link href="/tasks?scope=completed" className="text-xs text-muted-foreground hover:text-foreground">查看全部</Link>}
              >
                {data.tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    这一天还没有完成任务，加油 💪
                  </p>
                ) : (
                  <div className="space-y-1">
                    {data.tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-2 p-2 rounded hover:bg-accent transition-colors"
                      >
                        <Checkbox
                          checked
                          disabled
                          className="data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                        />
                        <span
                          className={cn(
                            "w-2 h-2 rounded-full shrink-0",
                            CATEGORY_COLORS[task.category],
                          )}
                          title={CATEGORY_LABELS[task.category]}
                        />
                        <span className="text-sm flex-1 truncate">
                          {task.title}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {formatTime(task.completed_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </DashboardSection>
              <DashboardSection
                title="开始或完成阅读（最多展示 10 条）"
                icon={BookOpen}
                actions={<Link href="/library" className="text-xs text-muted-foreground hover:text-foreground">查看稍后读</Link>}
              >
                {data.readingItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    这一天还没有阅读记录
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.readingItems.map((item) => (
                      <Link
                        key={item.id}
                        href={`/library/${item.id}`}
                        className="flex flex-col gap-1.5 p-2 rounded hover:bg-accent transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm flex-1 truncate">
                            {item.title || "无标题"}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {item.activity_type === "completed" ? "完成阅读" : "开始阅读"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{
                                width: `${Math.round((item.reading_progress || 0) * 100)}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-10 text-right shrink-0">
                            {Math.round((item.reading_progress || 0) * 100)}%
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </DashboardSection>
            </div>
            <div className="min-w-0 space-y-4">
              <DashboardSection
                title="编辑于所选日的笔记（最多展示 10 条）"
                icon={FileText}
                actions={<Link href="/notes" className="text-xs text-muted-foreground hover:text-foreground">查看全部笔记</Link>}
              >
                {data.notes.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    这一天没有笔记更新记录
                  </p>
                ) : (
                  <div className="space-y-1">
                    {data.notes.map((note) => (
                      <Link
                        key={note.id}
                        href={`/notes/${note.id}`}
                        className="flex items-center gap-2 p-2 rounded hover:bg-accent transition-colors cursor-pointer"
                      >
                        <span className="text-sm flex-1 truncate">
                          {note.title || "无标题笔记"}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {formatTime(note.updated_at)}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  显示最后编辑于这一天的笔记，后续编辑会更新归属日期。
                </p>
              </DashboardSection>
              <DashboardSection
                title="高亮摘录（最多展示 10 条）"
                icon={Highlighter}
                actions={<Link href="/library" className="text-xs text-muted-foreground hover:text-foreground">查看文章</Link>}
              >
                {data.highlights.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    这一天还没有添加高亮
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.highlights.map((highlight) => (
                      <Link
                        key={highlight.id}
                        href={`/library/${highlight.reading_item_id}?hl=${highlight.id}`}
                        className="p-2 rounded hover:bg-accent transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={cn(
                              "w-1 h-auto self-stretch rounded-full shrink-0",
                              highlight.color === "yellow" && "bg-yellow-400",
                              highlight.color === "green" && "bg-green-400",
                              highlight.color === "blue" && "bg-blue-400",
                              highlight.color === "pink" && "bg-pink-400",
                              highlight.color === "purple" && "bg-purple-400",
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm line-clamp-2">
                              {truncateText(highlight.content, 50)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {highlight.reading_items?.title || "未知文章"}
                            </p>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </DashboardSection>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
