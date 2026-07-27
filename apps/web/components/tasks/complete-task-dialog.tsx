"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { Task, LessonType } from "@organize/shared";
import { LESSON_TYPE_CONFIG } from "@organize/shared";

interface CompleteTaskDialogProps {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  onComplete: (reflectionData?: { title?: string; content?: string; lessonType?: string }) => Promise<void>;
}

export function CompleteTaskDialog({ open, task, onClose, onComplete }: CompleteTaskDialogProps) {
  const [writingReflection, setWritingReflection] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [lessonType, setLessonType] = useState<LessonType>("reflection");
  const [saving, setSaving] = useState(false);

  const handleQuickComplete = async () => {
    setSaving(true);
    try {
      await onComplete();
      handleClose();
    } finally {
      setSaving(false);
    }
  };

  const handleSaveReflection = async () => {
    if (!task) return;
    setSaving(true);
    try {
      await onComplete({
        title: title.trim(),
        content: content.trim(),
        lessonType,
      });
      handleClose();
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setWritingReflection(false);
    setTitle("");
    setContent("");
    setLessonType("reflection");
    setSaving(false);
    onClose();
  };

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && handleClose()}>
      <DialogContent className="sm:max-w-md">
        {!writingReflection ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <DialogTitle>任务完成！</DialogTitle>
                  <DialogDescription>
                    「{task.title}」已标记为完成
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="py-4 text-center">
              <p className="text-sm text-muted-foreground">
                要写一段复盘总结吗？记录下这次任务的收获、经验或教训，方便以后回顾。
              </p>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={handleQuickComplete} disabled={saving} className="sm:flex-1">
                跳过，直接完成
              </Button>
              <Button onClick={() => setWritingReflection(true)} disabled={saving} className="sm:flex-1">
                写经验总结
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>写经验总结</DialogTitle>
              <DialogDescription>
                关联任务：{task.title}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid gap-2">
                <Label>类型</Label>
                <Select value={lessonType} onValueChange={(v: LessonType) => setLessonType(v)}>
                  <SelectTrigger>
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

              <div className="grid gap-2">
                <Label htmlFor="lesson-title">标题</Label>
                <Input
                  id="lesson-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`${task.title} - 复盘`}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="lesson-content">内容</Label>
                <Textarea
                  id="lesson-content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="这次任务有什么收获？遇到了什么问题？有什么经验教训？"
                  rows={5}
                  autoFocus
                />
              </div>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="outline" onClick={handleQuickComplete} disabled={saving}>
                取消，直接完成
              </Button>
              <Button onClick={handleSaveReflection} disabled={saving || !content.trim()}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                保存并完成任务
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
