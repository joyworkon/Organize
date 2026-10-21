"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  Calendar,
  Check,
  CheckCircle2,
  CopyPlus,
  ExternalLink,
  Repeat2,
  Trash2,
  XCircle,
} from "@/components/icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuIcon,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  useContextMenu,
} from "@/components/ui/context-menu";
import {
  calendarReschedulePatch,
  nextWeekStartLabel,
  type CalendarRescheduleShortcut,
} from "@/lib/tasks/calendar-reschedule";
import type { CalendarWeekStart } from "@/lib/tasks/calendar-view-options";
import { getTaskDate } from "@/lib/tasks/calendar-agenda";
import { isRecurringProjection, recurringSource } from "@/lib/tasks/recurring-occurrences";
import type { TaskWithTags } from "@organize/shared";

/**
 * 日历任务条目的右键 / 长按 / 键盘菜单。
 *
 * 与任务列表右键菜单、画布右键菜单共用 ui/context-menu 原语（视觉一致）；
 * 由 TaskMonthView 持有单例，各视图只需在任务条目上带 data-calendar-task-id，
 * 打开方式走根容器的事件委托（contextmenu / 指针长按 / 键盘），不改各条目
 * 已有的拖拽与点击处理。
 */

export interface CalendarTaskMenuRequest {
  task: TaskWithTags;
  x: number;
  y: number;
  /** 键盘打开（Shift+F10 / ContextMenu 键）时聚焦第一个菜单项。 */
  keyboard?: boolean;
  /** 每次打开递增；同一任务换位置重开也要触发 effect。 */
  nonce: number;
}

export interface CalendarTaskMenuActions {
  onOpenDetail: (task: TaskWithTags) => void;
  onToggleDone?: (task: TaskWithTags) => void;
  onReschedule?: (task: TaskWithTags, shortcut: CalendarRescheduleShortcut) => void;
  onDuplicate?: (task: TaskWithTags) => void;
  onDelete?: (task: TaskWithTags) => void;
}

/** 菜单条目上标识任务；根容器按它把事件解析回任务。 */
export const CALENDAR_TASK_ID_ATTR = "data-calendar-task-id";

export function findCalendarTaskId(node: EventTarget | null): string | null {
  if (!(node instanceof Element)) return null;
  const holder = node.closest<HTMLElement>(`[${CALENDAR_TASK_ID_ATTR}]`);
  return holder?.getAttribute(CALENDAR_TASK_ID_ATTR) ?? null;
}

/**
 * 聚焦任务条目时的快捷键：Space / x 切换完成，Delete / Backspace 删除，
 * Shift+F10 / ContextMenu 打开菜单。Enter 保持原生（打开详情）。
 * 带修饰键不处理（⌥↑/⌥↓ 微调时间保留）；勾选框与输入类目标自己处理按键。
 */
export function handleCalendarTaskKeyDown(
  event: React.KeyboardEvent,
  task: TaskWithTags,
  actions: {
    onToggleDone?: (task: TaskWithTags) => void;
    onDelete?: (task: TaskWithTags) => void;
    onOpenMenu: (task: TaskWithTags, position: { x: number; y: number }) => void;
  }
): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const native = event.nativeEvent;
  if (native.isComposing || event.keyCode === 229) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, [contenteditable='true'], [role='checkbox']")) return;
  const key = event.key;
  if ((key === " " || key === "x" || key === "X") && actions.onToggleDone) {
    event.preventDefault();
    event.stopPropagation();
    actions.onToggleDone(task);
    return;
  }
  if ((key === "Delete" || key === "Backspace") && actions.onDelete) {
    event.preventDefault();
    event.stopPropagation();
    actions.onDelete(task);
    return;
  }
  if (key === "ContextMenu" || (key === "F10" && event.shiftKey)) {
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    actions.onOpenMenu(task, { x: rect.left, y: rect.bottom + 4 });
  }
}

/** 触屏长按（≥500ms 且位移 <8px）打开菜单；桌面鼠标不启用（右键即可）。 */
export function useTaskLongPress(
  openMenu: (task: TaskWithTags, position: { x: number; y: number }) => void,
  resolveTask: (id: string) => TaskWithTags | null,
  { delayMs = 500, moveTolerancePx = 8 }: { delayMs?: number; moveTolerancePx?: number } = {}
) {
  const timerRef = useRef<number | null>(null);
  const sessionRef = useRef<{ pointerId: number; x: number; y: number; id: string; element: Element } | null>(null);
  const openRef = useRef(openMenu);
  const resolveRef = useRef(resolveTask);
  useEffect(() => {
    openRef.current = openMenu;
    resolveRef.current = resolveTask;
  }, [openMenu, resolveTask]);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    sessionRef.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const start = useCallback(
    (event: React.PointerEvent) => {
      cancel();
      // 只在触屏/笔上启用；鼠标走 contextmenu。多指第二触点直接忽略。
      if (event.pointerType === "mouse" || event.button !== 0 || !event.isPrimary) return;
      const id = findCalendarTaskId(event.target);
      if (!id) return;
      const element = (event.target as Element).closest(`[${CALENDAR_TASK_ID_ATTR}]`);
      if (!element) return;
      sessionRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, id, element };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const session = sessionRef.current;
        sessionRef.current = null;
        const task = session ? resolveRef.current(session.id) : null;
        if (!session || !task) return;
        // 吞掉长按抬起后的兼容 mousedown/click：click 会打开详情/peek，
        // mousedown 落在菜单外时会把刚打开的菜单当「点外」误关
        const swallow = (event: Event) => {
          event.preventDefault();
          event.stopPropagation();
        };
        session.element.addEventListener("mousedown", swallow, { capture: true, once: true });
        session.element.addEventListener("click", swallow, { capture: true, once: true });
        openRef.current(task, { x: session.x, y: session.y });
      }, delayMs);
    },
    [cancel, delayMs]
  );

  const move = useCallback(
    (event: React.PointerEvent) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - session.x, event.clientY - session.y) >= moveTolerancePx) cancel();
    },
    [cancel, moveTolerancePx]
  );

  const end = useCallback(
    (event: React.PointerEvent) => {
      if (sessionRef.current?.pointerId === event.pointerId) cancel();
    },
    [cancel]
  );

  return {
    onPointerDownCapture: start,
    onPointerMoveCapture: move,
    onPointerUpCapture: end,
    onPointerCancelCapture: end,
  };
}

/** 打开后按坐标定位；键盘来源再把焦点放进第一个可用菜单项。 */
function CalendarTaskMenuOpener({ request }: { request: CalendarTaskMenuRequest }) {
  const { openMenu } = useContextMenu();
  useEffect(() => {
    openMenu({ x: request.x, y: request.y });
    if (!request.keyboard) return;
    const timer = window.setTimeout(() => {
      // jsdom/nwsapi 对 [attr=""] 空值选择器不命中，这里用存在性选择器
      const item = document.querySelector<HTMLElement>(
        "[data-context-menu-content] [role=menuitem]:not([data-disabled])"
      );
      item?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openMenu, request]);
  return null;
}

export function CalendarTaskMenu({
  request,
  onClose,
  weekStart = 1,
  actions,
}: {
  request: CalendarTaskMenuRequest | null;
  onClose: () => void;
  weekStart?: CalendarWeekStart;
  actions: CalendarTaskMenuActions;
}) {
  const task = request?.task ?? null;
  const projected = task ? isRecurringProjection(task) : false;
  const scheduled = task ? getTaskDate(task) !== null : false;
  const nextWeekLabel = nextWeekStartLabel(weekStart);

  return (
    <ContextMenu onOpenChange={(open) => { if (!open) onClose(); }}>
      {request && <CalendarTaskMenuOpener request={request} />}
      <ContextMenuContent data-testid="calendar-task-menu" className="min-w-44">
        {task && (
          <>
            <ContextMenuItem
              onSelect={() => actions.onOpenDetail(task)}
              data-testid="calendar-task-menu-open"
            >
              <ContextMenuIcon>
                <ExternalLink className="h-4 w-4" />
              </ContextMenuIcon>
              打开详情
              <ContextMenuShortcut>Enter</ContextMenuShortcut>
            </ContextMenuItem>
            {projected ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem disabled title="请在原任务上修改" className="data-[disabled]:pointer-events-auto">
                  <ContextMenuIcon>
                    <Repeat2 className="h-4 w-4" />
                  </ContextMenuIcon>
                  重复任务的后续发生，请在原任务上修改
                </ContextMenuItem>
              </>
            ) : (
              <>
                {actions.onToggleDone && (
                  <ContextMenuItem
                    onSelect={() => actions.onToggleDone?.(task)}
                    data-testid="calendar-task-menu-toggle"
                  >
                    <ContextMenuIcon>
                      {task.status === "done" ? <Check className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    </ContextMenuIcon>
                    {task.status === "done" ? "标记为未完成" : "标记完成"}
                    <ContextMenuShortcut>x</ContextMenuShortcut>
                  </ContextMenuItem>
                )}
                {actions.onReschedule && scheduled && (
                  <>
                    <ContextMenuSeparator />
                    <div role="presentation" className="px-2 pb-0.5 pt-1.5 text-xs font-medium text-muted-foreground">
                      改期
                    </div>
                    {(["today", "tomorrow"] as const).map((shortcut) => (
                      <ContextMenuItem
                        key={shortcut}
                        onSelect={() => actions.onReschedule?.(task, shortcut)}
                        data-testid={`calendar-task-menu-${shortcut}`}
                      >
                        <ContextMenuIcon>
                          <Calendar className="h-4 w-4" />
                        </ContextMenuIcon>
                        {shortcut === "today" ? "今天" : "明天"}
                      </ContextMenuItem>
                    ))}
                    <ContextMenuItem
                      onSelect={() => actions.onReschedule?.(task, "nextWeekStart")}
                      data-testid="calendar-task-menu-next-week"
                    >
                      <ContextMenuIcon>
                        <Calendar className="h-4 w-4" />
                      </ContextMenuIcon>
                      {nextWeekLabel}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => actions.onReschedule?.(task, "clear")}
                      data-testid="calendar-task-menu-clear"
                    >
                      <ContextMenuIcon>
                        <XCircle className="h-4 w-4" />
                      </ContextMenuIcon>
                      清除日期
                    </ContextMenuItem>
                  </>
                )}
                {actions.onDuplicate && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() => actions.onDuplicate?.(task)}
                      data-testid="calendar-task-menu-duplicate"
                    >
                      <ContextMenuIcon>
                        <CopyPlus className="h-4 w-4" />
                      </ContextMenuIcon>
                      复制一份
                    </ContextMenuItem>
                  </>
                )}
                {actions.onDelete && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() => actions.onDelete?.(task)}
                      className="text-destructive focus:text-destructive focus:bg-destructive/10"
                      data-testid="calendar-task-menu-delete"
                    >
                      <ContextMenuIcon className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </ContextMenuIcon>
                      删除
                      <ContextMenuShortcut>⌫</ContextMenuShortcut>
                    </ContextMenuItem>
                  </>
                )}
              </>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** 视图接线用：真实任务上执行动作（投影只会出现在打开详情里，这里统一归源）。 */
export function calendarTaskMenuSource(task: TaskWithTags): TaskWithTags {
  return recurringSource(task);
}

/** 供测试与调用方核对菜单是否会提供改期项（未排期任务不显示改期组）。 */
export function taskHasRescheduleOptions(task: TaskWithTags, weekStart: CalendarWeekStart = 1): boolean {
  return !isRecurringProjection(task)
    && calendarReschedulePatch(task, "tomorrow", new Date(), weekStart) !== null;
}
