"use client";
/**
 * 任务日期组件（任务2/3 通用）：
 * 单日/起止范围、全天/时间、重复规则。
 * 任务书：日期/时间段页签、今天/明天/下周一/今晚快捷项、清除/取消/确定。
 */
import { useState, useEffect } from "react";
import { Calendar, Clock, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { TaskRecurrenceRule } from "@organize/shared";

export interface TaskSchedule {
  schedule_start_at: string | null;
  schedule_end_at: string | null;
  all_day: boolean;
  timezone: string | null;
  recurrence_rule: TaskRecurrenceRule | null;
}

interface TaskDatePickerProps {
  value: TaskSchedule;
  onChange: (v: TaskSchedule) => void;
}

// 日期串必须按本地墙钟生成：全天任务存的是本地零点的 ISO（UTC 侧可能是前一天），
// 用 toISOString 截断会把 <input type="date"> 回填成错的一天，确定时再写回就整体平移。
export function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function toTimeInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toTimeString().slice(0, 5);
}
export function fromDateInput(date: string, time?: string): string {
  const dt = new Date(date + (time ? `T${time}` : "T00:00:00"));
  return dt.toISOString();
}

const RECURRENCE_LABELS: Record<string, string> = {
  daily: "每天", weekly: "每周", monthly: "每月", yearly: "每年",
};

export function TaskDatePicker({ value, onChange }: TaskDatePickerProps) {
  const [mode, setMode] = useState<"single" | "range">(
    value.schedule_end_at && value.schedule_start_at !== value.schedule_end_at ? "range" : "single"
  );
  const [draft, setDraft] = useState<TaskSchedule>(value);

  useEffect(() => { setDraft(value); }, [value]);

  const startDate = toDateInput(draft.schedule_start_at);
  const startTime = toTimeInput(draft.schedule_start_at);
  const endDate = toDateInput(draft.schedule_end_at);
  const endTime = toTimeInput(draft.schedule_end_at);

  const update = (patch: Partial<TaskSchedule>) => {
    const next = { ...draft, ...patch };
    // 结束不得早于开始
    if (next.schedule_start_at && next.schedule_end_at && next.schedule_end_at < next.schedule_start_at) {
      next.schedule_end_at = next.schedule_start_at;
    }
    setDraft(next);
  };

  const apply = () => {
    // 全天时设时间为 00:00
    let final = { ...draft };
    if (draft.all_day && draft.schedule_start_at) {
      const d = new Date(draft.schedule_start_at);
      final.schedule_start_at = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
      if (final.schedule_end_at) {
        const e = new Date(final.schedule_end_at);
        final.schedule_end_at = new Date(e.getFullYear(), e.getMonth(), e.getDate(), 23, 59).toISOString();
      }
    }
    if (mode === "single") final.schedule_end_at = null;
    onChange(final);
  };

  const clear = () => {
    const cleared: TaskSchedule = {
      schedule_start_at: null, schedule_end_at: null, all_day: false,
      timezone: null, recurrence_rule: null,
    };
    setDraft(cleared);
    onChange(cleared);
  };

  // 快捷项
  const quick = (label: string, days: number, time?: string) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    if (time) {
      const [h, m] = time.split(":");
      d.setHours(Number(h), Number(m), 0, 0);
    }
    update({ schedule_start_at: d.toISOString(), all_day: !time });
  };

  return (
    <div className="organize-task-date-picker space-y-3">
      {/* 日期/时间段 页签 */}
      <div className="flex gap-1 border-b">
        <button
          type="button"
          onClick={() => setMode("single")}
          className={cn("px-3 py-1.5 text-sm border-b-2 -mb-px", mode === "single" ? "border-primary text-primary" : "border-transparent text-muted-foreground")}
        >日期</button>
        <button
          type="button"
          onClick={() => setMode("range")}
          className={cn("px-3 py-1.5 text-sm border-b-2 -mb-px", mode === "range" ? "border-primary text-primary" : "border-transparent text-muted-foreground")}
        >时间段</button>
      </div>

      {/* 快捷项 */}
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => quick("今天", 0)} className="px-2 py-1 text-xs rounded border hover:bg-muted">今天</button>
        <button onClick={() => quick("明天", 1)} className="px-2 py-1 text-xs rounded border hover:bg-muted">明天</button>
        <button onClick={() => quick("下周一", (8 - new Date().getDay()) % 7 || 7)} className="px-2 py-1 text-xs rounded border hover:bg-muted">下周一</button>
        <button onClick={() => quick("今晚", 0, "20:00")} className="px-2 py-1 text-xs rounded border hover:bg-muted">今晚</button>
      </div>

      {/* 开始日期 */}
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input type="date" value={startDate} onChange={(e) => update({ schedule_start_at: e.target.value ? fromDateInput(e.target.value, draft.all_day ? undefined : startTime) : null })} className="w-auto" />
        {!draft.all_day && (
          <Input type="time" value={startTime} onChange={(e) => update({ schedule_start_at: fromDateInput(startDate, e.target.value) })} className="w-auto" />
        )}
      </div>

      {/* 结束日期（range 模式） */}
      {mode === "range" && (
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input type="date" value={endDate} onChange={(e) => update({ schedule_end_at: e.target.value ? fromDateInput(e.target.value, draft.all_day ? undefined : endTime) : null })} className="w-auto" />
          {!draft.all_day && (
            <Input type="time" value={endTime} onChange={(e) => update({ schedule_end_at: fromDateInput(endDate, e.target.value) })} className="w-auto" />
          )}
        </div>
      )}

      {/* 全天 + 重复 */}
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={draft.all_day} onChange={(e) => update({ all_day: e.target.checked })} />
          全天
        </label>
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">重复</span>
          <Select
            value={draft.recurrence_rule?.frequency || "none"}
            onValueChange={(v) => update({ recurrence_rule: v === "none" ? null : { frequency: v as TaskRecurrenceRule["frequency"], interval: 1 } })}
          >
            <SelectTrigger className="w-auto h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">无</SelectItem>
              {Object.entries(RECURRENCE_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={clear}><X className="h-3.5 w-3.5" />清除</Button>
        <Button size="sm" onClick={apply}><Check className="h-3.5 w-3.5" />确定</Button>
      </div>
    </div>
  );
}
