"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X, Loader2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskDatePopover } from "./task-date-popover";
import { CountdownFormFields } from "./countdown-form-fields";
import { useIsNarrowViewport } from "@/components/canvas/use-is-narrow-viewport";
import { countdownFormError, type CountdownFormValue } from "@/lib/tasks/countdown";
import { isImeComposing } from "@/lib/input/submit-guard";
import { toast } from "@/hooks/use-toast";
import type { useTaskWorkspaceData } from "@/lib/tasks/workspace";
import type { CountdownDay, TaskList, TaskWithTags } from "@organize/shared";
import type { TaskSchedule } from "./task-date-picker";

export interface CalendarCreateAnchor {
  rect?: Pick<DOMRect, "x" | "y" | "width" | "height">;
  focusTarget?: HTMLElement;
}
export interface CalendarCreateRange { start: Date; end?: Date; anchor?: CalendarCreateAnchor }
export interface CalendarCreatePreview { start: Date; end?: Date; allDay: boolean; title: string }

export function calendarCreateAnchor(element: HTMLElement, rect = element.getBoundingClientRect()): CalendarCreateAnchor {
  return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, focusTarget: element };
}

export function initialCalendarSchedule(range: CalendarCreateRange): TaskSchedule {
  const start = new Date(range.start);
  // A date-only cell represents an all-day event; explicit grid ranges preserve midnight.
  const allDay = !range.end && start.getHours() === 0 && start.getMinutes() === 0;
  return {
    schedule_start_at: start.toISOString(),
    schedule_end_at: allDay ? null : (range.end ?? new Date(start.getTime() + 3_600_000)).toISOString(),
    all_day: allDay, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, recurrence_rule: null,
  };
}

function localKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const clock = (date: Date) => date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
export function calendarScheduleLabel(schedule: TaskSchedule): string {
  if (!schedule.schedule_start_at) return "选择日期和时间";
  const start = new Date(schedule.schedule_start_at);
  const day = `${start.getMonth() + 1}月${start.getDate()}日`;
  if (schedule.all_day) return `${day} 全天`;
  const end = schedule.schedule_end_at ? new Date(schedule.schedule_end_at) : null;
  return `${day} ${start.toLocaleDateString("zh-CN", { weekday: "short" })} ${clock(start)}${end ? ` – ${localKey(start) === localKey(end) ? "" : `${end.getMonth() + 1}月${end.getDate()}日 `}${clock(end)}` : ""}`;
}

interface CalendarQuickCreateProps {
  range: CalendarCreateRange;
  supabase: ReturnType<typeof useTaskWorkspaceData>["supabase"];
  lists: TaskList[];
  defaultListId: string | null;
  onClose: () => void;
  onPreviewChange: (preview: CalendarCreatePreview) => void;
  onTaskCreated: (task: TaskWithTags, more: boolean) => void;
  onCountdownCreated: (day: CountdownDay) => void;
}

export function CalendarQuickCreate({ range, supabase, lists, defaultListId, onClose, onPreviewChange, onTaskCreated, onCountdownCreated }: CalendarQuickCreateProps) {
  const mobile = useIsNarrowViewport();
  const headingId = useId();
  const errorId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const moreRef = useRef(false);
  const [tab, setTab] = useState<"task" | "countdown">("task");
  const [title, setTitle] = useState("");
  const [schedule, setSchedule] = useState(() => initialCalendarSchedule(range));
  const [listId, setListId] = useState(defaultListId);
  const [countdown, setCountdown] = useState<CountdownFormValue>({ title: "", target_date: localKey(range.start), repeat_annually: false });
  useEffect(() => { contentRef.current?.querySelector<HTMLInputElement>("input")?.focus(); }, [tab]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<{ height: number; bottom: number } | null>(null);
  const virtualRef = useMemo(() => ({ current: { getBoundingClientRect: () => {
    const rect = range.anchor?.rect;
    return rect ? new DOMRect(rect.x, rect.y, rect.width, rect.height) : new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
  } } }), [range.anchor]);

  useEffect(() => {
    const start = tab === "countdown" ? new Date(`${countdown.target_date}T00:00:00`) : new Date(schedule.schedule_start_at ?? range.start);
    if (Number.isNaN(start.getTime())) return;
    onPreviewChange({ start, end: tab === "task" && schedule.schedule_end_at ? new Date(schedule.schedule_end_at) : undefined, allDay: tab === "countdown" || schedule.all_day, title: tab === "task" ? title : countdown.title });
  }, [title, schedule, tab, countdown, onPreviewChange, range.start]);

  useEffect(() => {
    const visual = window.visualViewport;
    if (!mobile || !visual) return;
    const update = () => setViewport({ height: visual.height, bottom: Math.max(0, window.innerHeight - visual.offsetTop - visual.height) });
    update();
    visual.addEventListener("resize", update);
    visual.addEventListener("scroll", update);
    return () => { visual.removeEventListener("resize", update); visual.removeEventListener("scroll", update); };
  }, [mobile]);

  const scheduleError = !schedule.schedule_start_at ? "请选择开始日期" : !schedule.all_day && schedule.schedule_end_at && new Date(schedule.schedule_end_at) <= new Date(schedule.schedule_start_at) ? "结束时间需晚于开始时间" : null;
  const dismiss = () => { if (!savingRef.current) onClose(); };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    if (!moreRef.current) range.anchor?.focusTarget?.focus({ preventScroll: true });
  };
  const save = async (more = false) => {
    if (savingRef.current) return;
    const validation = tab === "task" ? (!title.trim() ? "请填写标题" : scheduleError) : countdownFormError(countdown);
    if (validation) { setError(validation); return; }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("未登录");
      if (tab === "task") {
        const start = new Date(schedule.schedule_start_at!);
        if (schedule.all_day) start.setHours(0, 0, 0, 0);
        const payload = {
          id: crypto.randomUUID(), user_id: user.id, title: title.trim(), status: "todo", priority: "medium", category: "work", list_id: listId,
          ...schedule, schedule_start_at: start.toISOString(), schedule_end_at: schedule.all_day ? null : schedule.schedule_end_at, due_date: start.toISOString(),
        };
        const result = await supabase.from("tasks").insert(payload).select("*").single();
        if (result.error) throw result.error;
        if (!result.data) throw new Error("未能读取新任务，请重试");
        moreRef.current = more;
        onTaskCreated({ ...result.data, tags: [] } as TaskWithTags, more);
        window.dispatchEvent(new CustomEvent("organize:tasks-changed"));
      } else {
        const result = await supabase.from("countdown_days").insert({ user_id: user.id, title: countdown.title.trim(), target_date: countdown.target_date, repeat_annually: countdown.repeat_annually }).select("*").single();
        if (result.error) throw result.error;
        if (!result.data) throw new Error("未能读取新倒数日，请重试");
        onCountdownCreated(result.data as CountdownDay);
        window.dispatchEvent(new CustomEvent("organize:countdown-changed"));
      }
      toast({ title: tab === "task" ? "任务已添加" : "倒数日已添加" });
      onClose();
    } catch (caught) {
      setError((caught as { message?: string })?.message || "添加失败，请重试");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const content = <div ref={contentRef} className="space-y-3" data-calendar-quick-create="">
    <div className="flex items-center gap-2">
      <div className="flex flex-1 rounded-lg bg-muted p-1 text-sm">
        <Button type="button" size="sm" variant="ghost" disabled={saving} aria-pressed={tab === "task"} className={`flex-1 ${tab === "task" ? "bg-background hover:bg-background" : "text-muted-foreground"}`} onClick={() => { setTab("task"); titleRef.current?.focus(); }}>任务</Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} aria-pressed={tab === "countdown"} className={`flex-1 ${tab === "countdown" ? "bg-background hover:bg-background" : "text-muted-foreground"}`} onClick={() => { setTab("countdown"); setCountdown((current) => ({ ...current, title: current.title || title })); }}>倒数日</Button>
      </div>
      <Button type="button" size="icon" variant="ghost" aria-label="关闭创建卡" disabled={saving} onClick={dismiss}><X className="h-4 w-4" /></Button>
    </div>
    <div onKeyDown={(event) => {
      if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT" && (event.target as HTMLElement).closest("[data-calendar-quick-create]") === contentRef.current && !isImeComposing(event) && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void save();
      }
    }}>
      <fieldset disabled={saving} className="space-y-3">
        {tab === "task" ? <>
          <label className="block space-y-2 text-sm font-medium">标题<Input ref={titleRef} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：整理周报" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} /></label>
          <TaskDatePopover value={schedule} onChange={setSchedule} className="z-[80] max-h-[calc(100dvh-5rem)] max-w-[calc(100vw-1rem)]" trigger={<Button type="button" variant="ghost" className="h-auto w-full justify-start whitespace-normal px-2 text-left text-sm" aria-label="修改日期和时间">{calendarScheduleLabel(schedule)}</Button>} />
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={schedule.all_day} onCheckedChange={(checked) => setSchedule((current) => ({ ...current, all_day: checked === true }))} />全天</label>
          <div className="flex items-center gap-2 text-sm"><label htmlFor={`${headingId}-list`}>清单</label><Select value={listId ?? "none"} onValueChange={(value) => setListId(value === "none" ? null : value)}><SelectTrigger id={`${headingId}-list`} className="ml-auto w-40"><SelectValue placeholder="无清单" /></SelectTrigger><SelectContent className="z-[80]"><SelectItem value="none">无清单</SelectItem>{lists.filter((list) => !list.deleted_at).map((list) => <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>)}</SelectContent></Select></div>
        </> : <CountdownFormFields value={countdown} onChange={setCountdown} disabled={saving} />}
      </fieldset>
    </div>
    {(error || (tab === "task" && scheduleError)) && <p id={errorId} role="alert" className="text-sm text-destructive">{error || scheduleError}</p>}
    <div className="flex items-center justify-between gap-2 border-t pt-3">
      {tab === "task" ? <Button type="button" variant="ghost" size="sm" disabled={saving || Boolean(scheduleError)} onClick={() => void save(true)}>更多选项</Button> : <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={dismiss}>取消</Button>}
      <Button type="button" size="sm" disabled={saving || (tab === "task" && Boolean(scheduleError))} onClick={() => void save()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}添加</Button>
    </div>
  </div>;

  if (mobile) return <Dialog open onOpenChange={(open) => { if (!open) dismiss(); }}>
    <DialogContent hideCloseButton aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); contentRef.current?.querySelector<HTMLInputElement>("input")?.focus(); }} onCloseAutoFocus={restoreFocus} onEscapeKeyDown={(event) => { if (savingRef.current) event.preventDefault(); }} onInteractOutside={(event) => { if (savingRef.current) event.preventDefault(); }} className="rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))]" style={{ left: 0, top: "auto", bottom: viewport?.bottom ?? 0, transform: "none", width: "100%", maxWidth: "none", maxHeight: viewport ? Math.max(0, viewport.height - 64) : "calc(100dvh - 64px)" }}>
      <DialogTitle className="sr-only">新建日历事项</DialogTitle>{content}
    </DialogContent>
  </Dialog>;
  return <Popover open onOpenChange={(open) => { if (!open) dismiss(); }}>
    <PopoverAnchor virtualRef={virtualRef} />
    <PopoverContent side={range.anchor?.rect ? "right" : "bottom"} align={range.anchor?.rect ? "start" : "center"} sideOffset={range.anchor?.rect ? 8 : 0} collisionPadding={8} aria-labelledby={headingId} aria-describedby={undefined} data-calendar-create-placement={range.anchor?.rect ? "anchored" : "center"} className="w-72 max-w-[calc(100vw-1rem)] overflow-y-auto" style={{ maxHeight: "calc(100dvh - 16px)", ...(range.anchor?.rect ? {} : { transform: "translateY(-50%)" }) }} onOpenAutoFocus={(event) => { event.preventDefault(); titleRef.current?.focus(); }} onCloseAutoFocus={restoreFocus} onEscapeKeyDown={(event) => { if (savingRef.current) event.preventDefault(); }} onInteractOutside={(event) => { if (savingRef.current) event.preventDefault(); }}>
      <h2 id={headingId} className="sr-only">新建日历事项</h2>{content}
    </PopoverContent>
  </Popover>;
}
