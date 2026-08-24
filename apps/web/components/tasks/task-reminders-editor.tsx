"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Plus, Trash2 } from "lucide-react";
import type { Task, TaskReminder } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  reminderFireAt,
  reminderLabel,
  TASK_REMINDER_PRESETS,
} from "@/lib/tasks/reminders";

interface TaskRemindersEditorProps {
  task: Pick<
    Task,
    "id" | "user_id" | "schedule_start_at" | "schedule_end_at" | "due_date"
  >;
}

export function TaskRemindersEditor({ task }: TaskRemindersEditorProps) {
  const supabase = useMemo(() => createClient(), []);
  const [reminders, setReminders] = useState<TaskReminder[]>([]);
  const [preset, setPreset] = useState<string>("start:-10");
  const [saving, setSaving] = useState(false);

  const loadReminders = useCallback(async () => {
    const { data, error } = await supabase
      .from("task_reminders")
      .select("*")
      .eq("task_id", task.id)
      .order("created_at", { ascending: true });
    if (error) {
      toast({ title: "读取提醒失败", variant: "destructive" });
      return;
    }
    setReminders((data || []) as TaskReminder[]);
  }, [supabase, task.id]);

  useEffect(() => {
    void loadReminders();
  }, [loadReminders]);

  const addReminder = async () => {
    if (reminders.length >= 3) return;
    const selected = TASK_REMINDER_PRESETS.find((item) => item.value === preset);
    if (!selected) return;
    if (!task.schedule_start_at && !task.due_date) {
      toast({ title: "请先设置任务日期", variant: "destructive" });
      return;
    }
    if (
      reminders.some(
        (item) =>
          item.anchor === selected.anchor &&
          item.offset_minutes === selected.offsetMinutes
      )
    ) {
      toast({ title: "该提醒已存在" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("task_reminders").insert({
      user_id: task.user_id,
      task_id: task.id,
      anchor: selected.anchor,
      offset_minutes: selected.offsetMinutes,
      notified_at: null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "添加提醒失败", description: error.message, variant: "destructive" });
      return;
    }
    await loadReminders();
  };

  const removeReminder = async (id: string) => {
    const previous = reminders;
    setReminders((items) => items.filter((item) => item.id !== id));
    const { error } = await supabase.from("task_reminders").delete().eq("id", id);
    if (error) {
      setReminders(previous);
      toast({ title: "删除提醒失败", variant: "destructive" });
    }
  };

  return (
    <section className="mt-6 rounded-lg border p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Bell className="h-4 w-4" />
        提醒
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {reminders.length}/3
        </span>
      </div>
      <div className="space-y-2">
        {reminders.map((reminder) => {
          const fireAt = reminderFireAt(task, reminder);
          return (
            <div key={reminder.id} className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm">{reminderLabel(reminder)}</p>
                <p className="text-xs text-muted-foreground">
                  {fireAt ? fireAt.toLocaleString("zh-CN") : "等待设置任务日期"}
                  {reminder.notified_at ? " · 已发送" : ""}
                </p>
              </div>
              <button
                type="button"
                aria-label="删除提醒"
                onClick={() => void removeReminder(reminder.id)}
                className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
      {reminders.length < 3 && (
        <div className="mt-3 flex gap-2">
          <Select value={preset} onValueChange={setPreset}>
            <SelectTrigger aria-label="提醒时间" className="h-9 min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_REMINDER_PRESETS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            disabled={saving}
            onClick={() => void addReminder()}
            className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-sm hover:bg-muted disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            添加
          </button>
        </div>
      )}
    </section>
  );
}
