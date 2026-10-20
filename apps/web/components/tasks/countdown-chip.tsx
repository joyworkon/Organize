"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { CountdownDay } from "@organize/shared";
import { Hourglass } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { showConfirm } from "@/components/ui/prompt-dialog";
import { CountdownFormFields } from "./countdown-form-fields";
import { annualOccurrenceDate, countdownDisplay, countdownDragMoved, countdownDropDate, countdownFormError, formatCountdownDate, rescheduleCountdownTarget, type CountdownFormValue } from "@/lib/tasks/countdown";
import { cn } from "@/lib/utils";

export interface CountdownActions {
  onUpdateCountdown?: (id: string, patch: CountdownFormValue, optimistic?: boolean) => Promise<boolean>;
  onDeleteCountdown?: (id: string) => Promise<boolean>;
}
const CountdownContext = createContext<CountdownActions & {
  dragDate: string | null;
  setDragDate: (date: string | null) => void;
}>({ dragDate: null, setDragDate: () => {} });

export function CountdownProvider({ children, ...actions }: CountdownActions & { children: ReactNode }) {
  const [dragDate, setDragDate] = useState<string | null>(null);
  return <CountdownContext.Provider value={{ ...actions, dragDate, setDragDate }}>{children}</CountdownContext.Provider>;
}
export const useCountdownInteractions = () => useContext(CountdownContext);

export function CountdownChip({ item, compact = false }: { item: CountdownDay; compact?: boolean }) {
  const { onUpdateCountdown, onDeleteCountdown, setDragDate } = useCountdownInteractions();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = { title: item.title, target_date: item.target_date, repeat_annually: item.repeat_annually };
  const [form, setForm] = useState<CountdownFormValue>(fields);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const drag = useRef<{ pointerId: number; x: number; y: number; moved: boolean; surface: HTMLElement; element: HTMLButtonElement } | null>(null);
  useEffect(() => () => {
    const session = drag.current;
    if (!session) return;
    drag.current = null;
    setDragDate(null);
    if (session.element.hasPointerCapture(session.pointerId)) session.element.releasePointerCapture(session.pointerId);
  }, [setDragDate]);
  const suppressClick = useRef(false);
  const display = countdownDisplay(item);

  const clearDrag = () => {
    const session = drag.current;
    drag.current = null;
    setDragDate(null);
    if (session && trigger.current?.hasPointerCapture(session.pointerId)) trigger.current.releasePointerCapture(session.pointerId);
  };
  const cancelDrag = () => {
    if (!drag.current) return;
    suppressClick.current = true;
    clearDrag();
  };
  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const session = drag.current;
    if (!session || session.pointerId !== event.pointerId) return null;
    session.moved ||= countdownDragMoved(session.x, session.y, event.clientX, event.clientY);
    const cells = Array.from(session.surface.querySelectorAll<HTMLElement>("[data-countdown-date]")).map((cell) => {
      const rect = cell.getBoundingClientRect();
      return { date: cell.dataset.countdownDate!, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    const target = session.moved ? countdownDropDate(cells, event.clientX, event.clientY, session.surface.dataset.countdownSurface === "all-day") : null;
    setDragDate(target);
    return target;
  };
  return (
    <Popover open={open} onOpenChange={(next) => {
      if (confirming) return;
      setOpen(next);
      if (next) { setEditing(false); setForm(fields); setError(null); }
    }}>
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          title={`倒数日 · ${item.title}`}
          aria-label={`倒数日 · ${item.title}`}
          className={cn("inline-flex min-w-0 max-w-full items-center gap-0.5 truncate rounded bg-muted px-1 text-left text-[10px] leading-4 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px] focus-visible:ring-offset-background", compact && "leading-3", onUpdateCountdown && "cursor-grab active:cursor-grabbing")}
          style={{ touchAction: onUpdateCountdown ? "none" : undefined }}
          onClick={(event) => {
            event.stopPropagation();
            if (suppressClick.current && event.detail > 0) event.preventDefault();
            suppressClick.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") event.stopPropagation();
            if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopPropagation(); cancelDrag(); }
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            suppressClick.current = false;
            const surface = event.currentTarget.closest<HTMLElement>("[data-countdown-surface]");
            if (!onUpdateCountdown || busy || open || !surface || event.button !== 0 || !event.isPrimary) return;
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, surface, element: event.currentTarget };
          }}
          onPointerMove={moveDrag}
          onPointerUp={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return;
            const target = moveDrag(event);
            const moved = drag.current.moved;
            suppressClick.current = moved;
            clearDrag();
            if (moved && target && onUpdateCountdown) {
              const target_date = rescheduleCountdownTarget(item, target);
              if (target_date !== item.target_date) void onUpdateCountdown(item.id, { title: item.title, repeat_annually: item.repeat_annually, target_date }, true);
            }
          }}
          onPointerCancel={(event) => { if (drag.current?.pointerId === event.pointerId) cancelDrag(); }}
          onLostPointerCapture={(event) => { if (drag.current?.pointerId === event.pointerId) cancelDrag(); }}
        >
          <Hourglass className="h-2.5 w-2.5 shrink-0" /><span className="truncate">{item.title}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} aria-labelledby={titleId} className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto"
        onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onInteractOutside={(event) => { if (confirming) event.preventDefault(); }}
        onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}
      >
        <h3 id={titleId} className="mb-3 break-words text-sm font-semibold">{editing ? "编辑倒数日" : item.title}</h3>
        {editing ? (
          <form onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !onUpdateCountdown) return;
            const invalid = countdownFormError(form);
            setError(invalid);
            if (invalid) return;
            setBusy(true);
            try {
              if (await onUpdateCountdown(item.id, { ...form, title: form.title.trim() })) setEditing(false);
            } finally { setBusy(false); }
          }}>
            <CountdownFormFields value={form} onChange={setForm} disabled={busy} />
            {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(false)}>取消</Button>
              <Button type="submit" disabled={busy}>保存</Button>
            </div>
          </form>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">目标日期：{formatCountdownDate(item.target_date)}</p>
            <p className="mt-2 text-sm font-medium tabular-nums">{display.label === "今天" ? "今天" : `${display.label} ${display.days} 天`}</p>
            {item.repeat_annually && <p className="mt-2 text-xs text-muted-foreground">每年重复 · 本年度日期：{formatCountdownDate(annualOccurrenceDate(item.target_date, new Date().getFullYear()))}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {onUpdateCountdown && <Button size="sm" variant="outline" onClick={() => { setForm(fields); setEditing(true); }}>编辑</Button>}
              {onDeleteCountdown && <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
                setConfirming(true);
                try {
                  const confirmed = await showConfirm({ title: `将「${item.title}」移入垃圾箱？`, description: "可在垃圾箱中恢复。", confirmText: "移入垃圾箱", destructive: true });
                  if (!confirmed) return;
                  setBusy(true);
                  if (await onDeleteCountdown(item.id)) setOpen(false);
                } finally { setConfirming(false); setBusy(false); }
              }}>删除</Button>}
            </div>
            <Link href="/tasks/countdown" className="mt-3 inline-block rounded text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">在倒数日页打开</Link>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
