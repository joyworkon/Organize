"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { LessonCard } from "@/components/lessons/lesson-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Lightbulb,
  Plus,
  Search,
  Loader2,
} from "lucide-react";
import type { LessonWithTags, Tag, LessonType } from "@organize/shared";
import { LESSON_TYPE_CONFIG } from "@organize/shared";

type TypeFilter = "all" | LessonType;

export default function LessonsPage() {
  const router = useRouter();
  const [lessons, setLessons] = useState<LessonWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const fetchLessons = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: lessonsData } = await supabase
        .from("lessons")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      const lessonsList = (lessonsData || []) as any[];

      const { data: tagLinks } = await supabase
        .from("lesson_tags")
        .select("lesson_id, tag_id");

      const { data: tagsData } = await supabase
        .from("tags")
        .select("id, name")
        .eq("user_id", user.id);

      const tagMap = new Map((tagsData || []).map((t) => [t.id, t as Tag]));

      const linksByLesson = new Map<string, Tag[]>();
      for (const link of tagLinks || []) {
        const tag = tagMap.get(link.tag_id);
        if (tag) {
          const existing = linksByLesson.get(link.lesson_id) || [];
          existing.push(tag);
          linksByLesson.set(link.lesson_id, existing);
        }
      }

      const lessonsWithTags: LessonWithTags[] = lessonsList.map((l) => ({
        ...l,
        tags: linksByLesson.get(l.id) || [],
      }));

      setLessons(lessonsWithTags);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchLessons();
  }, [fetchLessons]);

  const handleDelete = async (lessonId: string) => {
    await supabase.from("lesson_tags").delete().eq("lesson_id", lessonId);
    await supabase.from("lessons").delete().eq("id", lessonId);
    await fetchLessons();
  };

  const handleCreate = () => {
    router.push("/lessons/new");
  };

  const filtered = lessons.filter((l) => {
    if (typeFilter !== "all" && l.lesson_type !== typeFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const title = (l.title || "").toLowerCase();
      const textContent = l.content ? JSON.stringify(l.content).toLowerCase() : "";
      return title.includes(q) || textContent.includes(q);
    }
    return true;
  });

  const stats = {
    total: lessons.length,
    reflection: lessons.filter((l) => l.lesson_type === "reflection").length,
    lesson: lessons.filter((l) => l.lesson_type === "lesson").length,
    insight: lessons.filter((l) => l.lesson_type === "insight").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">经验总结</h1>
          <p className="text-muted-foreground mt-1">
            共 {stats.total} 条经验 · {stats.reflection} 篇复盘 · {stats.lesson} 条经验 · {stats.insight} 个灵感
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          记录经验
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索经验..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={typeFilter} onValueChange={(v: TypeFilter) => setTypeFilter(v)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {Object.entries(LESSON_TYPE_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>
                {cfg.icon} {cfg.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          加载中...
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Lightbulb className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-30" />
            <p className="text-muted-foreground mb-4">
              {search || typeFilter !== "all"
                ? "没有匹配的经验"
                : "还没有记录经验"}
            </p>
            {!search && typeFilter === "all" && (
              <Button onClick={handleCreate}>记录第一条经验</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((lesson) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
