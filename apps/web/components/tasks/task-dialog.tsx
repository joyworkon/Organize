"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { TagSelector } from "@/components/tags/tag-selector";
import { TagBadge } from "@/components/tags/tag-badge";
import type { Task, TaskPriority, TaskCategory, TaskStatus, Tag, ReadingItem, Note } from "@organize/shared";
import { TASK_PRIORITY_CONFIG, TASK_CATEGORY_CONFIG, TASK_STATUS_CONFIG } from "@organize/shared";

interface TaskDialogProps {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  onSave: (data: Partial<Task>, tagIds: string[]) => Promise<void>;
}

export function TaskDialog({ open, task, onClose, onSave }: TaskDialogProps) {
  const supabase = createClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [category, setCategory] = useState<TaskCategory>("work");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [dueDate, setDueDate] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState<string>("");
  const [actualMinutes, setActualMinutes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<Pick<Tag, "id" | "name" | "color">[]>([]);

  const [linkReadingId, setLinkReadingId] = useState<string>("");
  const [linkNoteId, setLinkNoteId] = useState<string>("");
  const [readingItems, setReadingItems] = useState<ReadingItem[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    if (open) {
      const loadData = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const [{ data: tagsData }, { data: readingsData }, { data: notesData }] = await Promise.all([
          supabase.from("tags").select("id, name, color").eq("user_id", user.id).order("name"),
          supabase.from("reading_items").select("id, title").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
          supabase.from("notes").select("id, title").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(50),
        ]);

        setAllTags((tagsData || []) as Tag[]);
        setReadingItems((readingsData || []) as ReadingItem[]);
        setNotes((notesData || []) as Note[]);
      };
      loadData();
    }
  }, [open, supabase]);

  useEffect(() => {
    if (open) {
      if (task) {
        setTitle(task.title || "");
        setDescription(task.description || "");
        setPriority(task.priority);
        setCategory(task.category);
        setStatus(task.status);
        setDueDate(task.due_date ? task.due_date.slice(0, 16) : "");
        setEstimatedMinutes(task.estimated_minutes ? String(task.estimated_minutes) : "");
        setActualMinutes(task.actual_minutes ? String(task.actual_minutes) : "");
        setSelectedTags(task.tags ? task.tags.map(t => ({ id: t.id, name: t.name, color: t.color })) : []);
        setLinkReadingId(task.reading_item_id || "");
        setLinkNoteId(task.note_id || "");
      } else {
        setTitle("");
        setDescription("");
        setPriority("medium");
        setCategory("work");
        setStatus("todo");
        setDueDate("");
        setEstimatedMinutes("");
        setActualMinutes("");
        setSelectedTags([]);
        setLinkReadingId("");
        setLinkNoteId("");
      }
    }
  }, [open, task]);

  const handleCreateTag = async (name: string): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from("tags")
      .upsert({ user_id: user.id, name, color: "blue" }, { onConflict: "user_id,name" })
      .select("id, name, color")
      .single();
    if (error || !data) return null;
    setAllTags(prev => {
      if (prev.some(t => t.id === data.id)) return prev;
      return [...prev, data as Tag];
    });
    return data.id;
  };

  const handleTagChange = async (next: Pick<Tag, "id" | "name" | "color">[]) => {
    const resolved: Pick<Tag, "id" | "name" | "color">[] = [];
    for (const t of next) {
      if (t.id.startsWith("new:")) {
        const realId = await handleCreateTag(t.name);
        if (realId) {
          const createdTag = allTags.find(tag => tag.id === realId);
          resolved.push({ id: realId, name: t.name, color: createdTag?.color || "blue" });
        }
      } else {
        resolved.push(t);
      }
    }
    setSelectedTags(resolved);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const data: Partial<Task> = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        category,
        status,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
        estimated_minutes: estimatedMinutes ? parseInt(estimatedMinutes, 10) : null,
        actual_minutes: actualMinutes ? parseInt(actualMinutes, 10) : null,
        reading_item_id: linkReadingId || null,
        note_id: linkNoteId || null,
      };
      if (status === "done" && task?.status !== "done") {
        data.completed_at = new Date().toISOString();
      } else if (status !== "done") {
        data.completed_at = null;
      }
      await onSave(data, selectedTags.map(t => t.id));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? "编辑任务" : "新建任务"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">标题 *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="要做什么？"
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">描述</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="补充细节..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>分类</Label>
              <Select value={category} onValueChange={(v: TaskCategory) => setCategory(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_CATEGORY_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>优先级</Label>
              <Select value={priority} onValueChange={(v: TaskPriority) => setPriority(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_PRIORITY_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {task && (
            <div className="space-y-2">
              <Label>状态</Label>
              <Select value={status} onValueChange={(v: TaskStatus) => setStatus(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TASK_STATUS_CONFIG).map(([key, cfg]) => (
                    <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="dueDate">截止日期</Label>
            <Input
              id="dueDate"
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="estimated">预估时间（分钟）</Label>
              <Input
                id="estimated"
                type="number"
                min="0"
                value={estimatedMinutes}
                onChange={(e) => setEstimatedMinutes(e.target.value)}
                placeholder="例如：60"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="actual">实际耗时（分钟）</Label>
              <Input
                id="actual"
                type="number"
                min="0"
                value={actualMinutes}
                onChange={(e) => setActualMinutes(e.target.value)}
                placeholder="完成后填写"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>标签</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {selectedTags.length > 0 && selectedTags.map((t) => (
                <TagBadge key={t.id} tag={{ id: t.id, name: t.name, color: t.color }} onRemove={() => {
                  setSelectedTags(prev => prev.filter(x => x.id !== t.id));
                }} />
              ))}
              <TagSelector
                selected={selectedTags}
                options={allTags}
                onChange={handleTagChange}
                triggerLabel={selectedTags.length > 0 ? "添加" : "添加标签"}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>关联阅读文章</Label>
              <Select value={linkReadingId} onValueChange={setLinkReadingId}>
                <SelectTrigger>
                  <SelectValue placeholder="无" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">无</SelectItem>
                  {readingItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {(item.title || item.url).slice(0, 40)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>关联笔记</Label>
              <Select value={linkNoteId} onValueChange={setLinkNoteId}>
                <SelectTrigger>
                  <SelectValue placeholder="无" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">无</SelectItem>
                  {notes.map((note) => (
                    <SelectItem key={note.id} value={note.id}>
                      {(note.title || "无标题").slice(0, 40)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {task ? "保存" : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
