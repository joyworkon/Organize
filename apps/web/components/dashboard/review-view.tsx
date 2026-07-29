"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  CheckCircle2,
  BookOpen,
  FileText,
  Highlighter,
  Clock,
  Loader2,
} from "lucide-react";
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
}

interface Note {
  id: string;
  title: string | null;
  updated_at: string;
}

interface Highlight {
  id: string;
  content: string;
  color: "yellow" | "green" | "blue" | "pink" | "purple";
  reading_items: { title: string | null } | null;
  created_at: string;
}

interface ReviewData {
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

function getReadingStatusLabel(status: string): string {
  switch (status) {
    case "reading":
      return "在读";
    case "read":
      return "已读";
    default:
      return "未读";
  }
}

export default function ReviewView() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const today = new Date();

  const loadData = useCallback(
    async (date: Date) => {
      setLoading(true);
      setError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setData(null);
          return;
        }

        const { start, end } = getDayRange(date);
        const startIso = start.toISOString();
        const endIso = end.toISOString();

        const [tasksRes, readingRes, notesRes, highlightsRes] = await Promise.all([
          supabase
            .from("tasks")
            .select("id, title, category, completed_at")
            .eq("user_id", user.id)
            .eq("status", "done")
            .gte("completed_at", startIso)
            .lte("completed_at", endIso)
            .order("completed_at", { ascending: true }),
          supabase
            .from("reading_items")
            .select("id, title, reading_status, reading_progress")
            .eq("user_id", user.id)
            .neq("reading_status", "unread")
            .gte("updated_at", startIso)
            .lte("updated_at", endIso)
            .order("updated_at", { ascending: false })
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
            .select("id, content, color, created_at, reading_items(title)")
            .eq("user_id", user.id)
            .gte("created_at", startIso)
            .lte("created_at", endIso)
            .order("created_at", { ascending: false })
            .limit(10),
        ]);

        setData({
          tasks: (tasksRes.data || []) as Task[],
          readingItems: (readingRes.data || []) as ReadingItem[],
          notes: (notesRes.data || []) as Note[],
          highlights: (highlightsRes.data || []) as Highlight[],
        });
      } catch (err) {
        console.error("Failed to load review data:", err);
        setError("加载数据失败，请重试");
      } finally {
        setLoading(false);
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
    setSelectedDate(prev);
  };

  const goToNextDay = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    setSelectedDate(next);
  };

  const goToToday = () => {
    setSelectedDate(new Date());
  };

  const isToday = isSameDay(selectedDate, today);

  const stats = data
    ? {
        completedTasks: data.tasks.length,
        readingItems: data.readingItems.length,
        newNotes: data.notes.length,
        newHighlights: data.highlights.length,
        readingMinutes: data.readingItems.length * 15,
      }
    : null;

  return (
    <div className="min-h-screen">
      <div className="border-b pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Calendar className="h-6 w-6 text-primary" />
              每日回顾
            </h1>
            <p className="text-muted-foreground mt-1">{formatDateDisplay(selectedDate)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goToPrevDay}
              className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              aria-label="前一天"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goToToday}
              className={cn(
                "px-3 py-1.5 text-sm rounded-md transition-colors",
                isToday
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              今天
            </button>
            <button
              type="button"
              onClick={goToNextDay}
              disabled={isToday}
              className={cn(
                "inline-flex items-center justify-center rounded-md p-2 transition-colors",
                isToday
                  ? "text-muted-foreground/40 cursor-not-allowed"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
              aria-label="后一天"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 md:p-6">
        <div className="max-w-3xl mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              加载中...
            </div>
          ) : error ? (
            <div className="text-center py-12 text-muted-foreground">{error}</div>
          ) : data ? (
            <div className="rounded-lg border bg-card">
              <div className="p-5 border-b">
                <h2 className="font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  今日完成
                </h2>
              </div>
              <div className="p-5">
                {data.tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    今天还没有完成任务，加油 💪
                  </p>
                ) : (
                  <div className="space-y-1">
                    {data.tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-2 p-2 rounded hover:bg-accent transition-colors"
                      >
                        <Checkbox checked disabled className="data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                        <span
                          className={cn(
                            "w-2 h-2 rounded-full shrink-0",
                            CATEGORY_COLORS[task.category]
                          )}
                          title={CATEGORY_LABELS[task.category]}
                        />
                        <span className="text-sm flex-1 truncate">{task.title}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {formatTime(task.completed_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-5 border-b">
                <h2 className="font-semibold flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-orange-500" />
                  今日阅读
                </h2>
              </div>
              <div className="p-5">
                {data.readingItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    今天还没有阅读记录
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
                            {getReadingStatusLabel(item.reading_status)}
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
              </div>

              <div className="p-5 border-b">
                <h2 className="font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-green-500" />
                  今日笔记
                </h2>
              </div>
              <div className="p-5">
                {data.notes.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    今天还没有创建或编辑笔记
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
              </div>

              <div className="p-5 border-b">
                <h2 className="font-semibold flex items-center gap-2">
                  <Highlighter className="h-4 w-4 text-yellow-500" />
                  今日高亮
                </h2>
              </div>
              <div className="p-5">
                {data.highlights.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    今天还没有添加高亮
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.highlights.map((highlight) => (
                      <div
                        key={highlight.id}
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
                              highlight.color === "purple" && "bg-purple-400"
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
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {stats && (
                <>
                  <div className="p-5 border-b">
                    <h2 className="font-semibold flex items-center gap-2">
                      <Clock className="h-4 w-4 text-primary" />
                      今日统计
                    </h2>
                  </div>
                  <div className="p-5">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-primary">{stats.completedTasks}</p>
                        <p className="text-xs text-muted-foreground">完成任务</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold">{stats.readingItems}</p>
                        <p className="text-xs text-muted-foreground">阅读文章</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold">{stats.newNotes}</p>
                        <p className="text-xs text-muted-foreground">新建笔记</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold">{stats.newHighlights}</p>
                        <p className="text-xs text-muted-foreground">新增高亮</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold">{stats.readingMinutes}</p>
                        <p className="text-xs text-muted-foreground">阅读分钟(预估)</p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
