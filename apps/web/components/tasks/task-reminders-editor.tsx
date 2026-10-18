"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Plus, Trash2 } from "@/components/icons";
import type { Task, TaskReminder } from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { isOnline } from "@/lib/offline/network";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  reminderFireAt,
  reminderLabel,
  TASK_REMINDER_PRESETS,
} from "@/lib/tasks/reminders";
import {
  TASK_REMINDERS_LIST_LOAD_ERROR_MESSAGE,
  nextRemindersAfterLoad,
} from "@/lib/tasks/reminders-list-load";

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
  /** 首屏加载中：空白闪现不该被当成「没有提醒」 */
  const [loading, setLoading] = useState(true);
  /** 提醒列表加载失败（在线时）：没有已加载的列表时显示错误 + 重试，而不是「0/3」空白 */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 上次成功快照：刷新失败时原样保留（load 的闭包读不到最新 state） */
  const remindersRef = useRef<TaskReminder[]>([]);

  const loadReminders = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("task_reminders")
      .select("*")
      .eq("task_id", task.id)
      .order("created_at", { ascending: true });
    setLoading(false);
    // 失败保留上次成功快照 + 错误态与重试，不得伪装成「当前没有提醒」
    const plan = nextRemindersAfterLoad({
      previous: remindersRef.current,
      data: data ?? null,
      error,
    });
    remindersRef.current = plan.reminders;
    setReminders(plan.reminders);
    setLoadError(plan.loadError);
    // 离线时的失败是预期行为，由顶栏离线角标表达，不另弹 toast
    if (plan.loadError && isOnline()) {
      toast({ title: TASK_REMINDERS_LIST_LOAD_ERROR_MESSAGE, variant: "destructive" });
    }
  }, [supabase, task.id]);

  const retryLoad = () => {
    setLoadError(null);
    void loadReminders();
  };

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
      return;
    }
    // 删除成功同步 ref，避免下次刷新失败时从旧快照「复活」已删提醒
    remindersRef.current = remindersRef.current.filter((item) => item.id !== id);
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
        {loading && reminders.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">加载中…</p>
        ) : loadError && reminders.length === 0 ? (
          /* 加载失败不得伪装成「0/3 空白」：无快照给错误空态 + 重试 */
          <div
            className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2"
            role="alert"
          >
            <span className="text-sm text-destructive">{loadError}</span>
            <Button type="button" size="sm" variant="outline" onClick={retryLoad}>
              重试
            </Button>
          </div>
        ) : (
          <>
            {/* 刷新失败但已有列表：保留列表 + 持久行内提示 + 就地重试（toast 会消失） */}
            {loadError && (
              <div
                className="flex items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2"
                role="alert"
              >
                <span className="text-xs text-destructive">{loadError}</span>
                <Button type="button" size="sm" variant="outline" onClick={retryLoad}>
                  重试
                </Button>
              </div>
            )}
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
          </>
        )}
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
