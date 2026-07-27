"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Loader2, Save, Trash2 } from "lucide-react";
import type { LessonWithTags, LessonType } from "@organize/shared";
import { LESSON_TYPE_CONFIG } from "@organize/shared";

function nodeText(node: any): string {
  if (!node) return "";
  if (node.text) return node.text;
  if (node.content) return (node.content as any[]).map(nodeText).join("\n");
  return "";
}

function textToContent(text: string): Record<string, unknown> {
  if (!text.trim()) {
    return {
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    };
  }
  const paragraphs = text.split(/\n\n+/).map((p) => ({
    type: "paragraph",
    content: p.trim()
      ? p.split(/\n/).flatMap((line, i) => [
          ...(i > 0 ? [{ type: "hardBreak" }] : []),
          { type: "text", text: line },
        ])
      : [],
  }));
  return {
    type: "doc",
    content: paragraphs,
  };
}

export default function LessonEditorPage() {
  const router = useRouter();
  const params = useParams();
  const lessonId = params.id as string;
  const isNew = lessonId === "new";

  const supabase = createClient();
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [contentText, setContentText] = useState("");
  const [lessonType, setLessonType] = useState<LessonType>("reflection");

  const fetchLesson = useCallback(async () => {
    if (isNew) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("lessons")
        .select("*")
        .eq("id", lessonId)
        .eq("user_id", user.id)
        .single();

      if (data) {
        setTitle(data.title || "");
        setContentText(nodeText(data.content));
        setLessonType(data.lesson_type);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, lessonId, isNew]);

  useEffect(() => {
    fetchLesson();
  }, [fetchLesson]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const payload = {
        user_id: user.id,
        title: title.trim() || null,
        content: contentText.trim() ? textToContent(contentText) : null,
        lesson_type: lessonType,
      };

      if (isNew) {
        const { data, error } = await supabase
          .from("lessons")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        router.push(`/lessons/${data.id}`);
      } else {
        const { error } = await supabase
          .from("lessons")
          .update(payload)
          .eq("id", lessonId);
        if (error) throw error;
        router.push("/lessons");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (isNew) {
      router.push("/lessons");
      return;
    }
    if (!confirm("确定删除这条经验吗？")) return;
    await supabase.from("lesson_tags").delete().eq("lesson_id", lessonId);
    await supabase.from("lessons").delete().eq("id", lessonId);
    router.push("/lessons");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Link href="/lessons">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold flex-1">
          {isNew ? "记录经验" : "编辑经验"}
        </h1>
        {!isNew && (
          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={handleDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="type">类型</Label>
            <Select value={lessonType} onValueChange={(v: LessonType) => setLessonType(v)}>
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LESSON_TYPE_CONFIG).map(([key, cfg]) => (
                  <SelectItem key={key} value={key}>
                    {cfg.icon} {cfg.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">标题</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="给这条经验起个标题..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">内容</Label>
            <Textarea
              id="content"
              value={contentText}
              onChange={(e) => setContentText(e.target.value)}
              placeholder="写下你的收获、反思、经验教训或灵感想法...\n\n用空行分段"
              rows={20}
              className="resize-y min-h-[400px] font-mono text-base leading-relaxed"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            注：当前版本使用纯文本编辑，后续将升级为富文本编辑器，支持格式化、列表、引用等。
          </p>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => router.push("/lessons")} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {isNew ? "创建" : "保存"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
