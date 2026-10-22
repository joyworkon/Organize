"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pin } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { filterUnscheduledTasks } from "@/lib/tasks/calendar-unscheduled";
import { cn } from "@/lib/utils";
import type { TaskWithTags } from "@organize/shared";

/**
 * 日历「未排期任务托盘」：桌面右侧面板 + 手机底部 sheet 共用同一套行组件。
 *
 * 桌面行的拖拽复用日历既有 pointer 基础设施：条目自身 setPointerCapture，
 * 坐标经 onDragStart/Move/End 上抛给页面，页面再把会话下发给日历视图算落点；
 * Esc 时页面清掉会话（dragTaskId 变 null），行观察到后标记取消并吞掉随后的 click。
 * 手机（draggable=false）不走拖拽，只用「今天 / 明天」快捷按钮。
 */

/** 与月格拖拽一致的位移阈值：超过才算拖拽，否则视为轻点。 */
const TRAY_DRAG_MOVE_PX = 5;

export type UnscheduledQuickShortcut = "today" | "tomorrow";

interface TrayDragCallbacks {
  onDragStart: (task: TaskWithTags, clientX: number, clientY: number) => void;
  onDragMove: (taskId: string, clientX: number, clientY: number, moved: boolean) => void;
  /** 松手（已越过阈值）：坐标为抬起点，页面用它补最后一次落点计算。 */
  onDragEnd: (task: TaskWithTags, clientX: number, clientY: number) => void;
  onDragCancel: (task: TaskWithTags) => void;
  /** 页面当前拖拽会话的任务 id；会话消失（Esc / 松手）时行内标记取消。 */
  dragTaskId: string | null;
}

interface TrayTaskRowProps extends Partial<TrayDragCallbacks> {
  task: TaskWithTags;
  /** 桌面面板开启 pointer 拖拽；手机 sheet 行只用快捷按钮。 */
  draggable: boolean;
  onOpenTask: (task: TaskWithTags) => void;
  onQuickSchedule: (task: TaskWithTags, shortcut: UnscheduledQuickShortcut) => void;
}

interface TraySession {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
  cancelled: boolean;
}

function TrayTaskRow({
  task,
  draggable,
  onOpenTask,
  onQuickSchedule,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  dragTaskId,
}: TrayTaskRowProps) {
  const sessionRef = useRef<TraySession | null>(null);
  const suppressClickRef = useRef(false);

  // 页面在 Esc 时清掉拖拽会话；条目仍持有 pointer capture，这里就地取消。
  useEffect(() => {
    if (dragTaskId !== task.id && sessionRef.current) {
      sessionRef.current.cancelled = true;
      suppressClickRef.current = true;
    }
  }, [dragTaskId, task.id]);

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!draggable || !onDragStart || event.button !== 0 || !event.isPrimary || sessionRef.current) return;
    // 快捷按钮 / 输入不启动拖拽（行自身是拖拽把手）。
    const interactive = (event.target as HTMLElement).closest("button, input, [role='button']");
    if (interactive && interactive !== event.currentTarget) return;
    sessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      cancelled: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    onDragStart(task, event.clientX, event.clientY);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId || session.cancelled || !onDragMove) return;
    session.moved =
      session.moved || Math.hypot(event.clientX - session.startX, event.clientY - session.startY) >= TRAY_DRAG_MOVE_PX;
    onDragMove(task.id, event.clientX, event.clientY, session.moved);
  };

  const finishSession = (event: React.PointerEvent<HTMLElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return null;
    sessionRef.current = null;
    return session;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const session = finishSession(event);
    if (!session) return;
    if (session.cancelled) {
      suppressClickRef.current = true;
      return;
    }
    if (session.moved) {
      suppressClickRef.current = true;
      onDragEnd?.(task, event.clientX, event.clientY);
    }
    // 未移动的轻点交给 click 打开任务详情。
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLElement>) => {
    if (finishSession(event)) {
      suppressClickRef.current = true;
      onDragCancel?.(task);
    }
  };

  const dragging = dragTaskId === task.id;

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        data-unscheduled-task-id={task.id}
        aria-label={`排期任务：${task.title}`}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          onOpenTask(task);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenTask(task);
          }
        }}
        onPointerDown={draggable ? handlePointerDown : undefined}
        onPointerMove={draggable ? handlePointerMove : undefined}
        onPointerUp={draggable ? handlePointerUp : undefined}
        onPointerCancel={draggable ? handlePointerCancel : undefined}
        onLostPointerCapture={draggable ? handlePointerCancel : undefined}
        className={cn(
          "flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
          "transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          draggable && "cursor-grab active:cursor-grabbing",
          dragging && "opacity-40"
        )}
        style={{ touchAction: draggable ? "none" : undefined }}
      >
        {task.is_pinned && <Pin aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
        <span className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 min-h-0 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              onQuickSchedule(task, "today");
            }}
          >
            今天
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 min-h-0 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              onQuickSchedule(task, "tomorrow");
            }}
          >
            明天
          </Button>
        </span>
      </div>
    </li>
  );
}

interface UnscheduledListProps {
  tasks: TaskWithTags[];
  draggable: boolean;
  onOpenTask: (task: TaskWithTags) => void;
  onQuickSchedule: (task: TaskWithTags, shortcut: UnscheduledQuickShortcut) => void;
  dragCallbacks?: TrayDragCallbacks;
}

function UnscheduledTaskList({ tasks, draggable, onOpenTask, onQuickSchedule, dragCallbacks }: UnscheduledListProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterUnscheduledTasks(tasks, query), [tasks, query]);
  const searchId = useRef(`unscheduled-search-${draggable ? "tray" : "sheet"}`).current;
  return (
    <>
      <div className="px-2 pb-2 pt-1">
        <label htmlFor={searchId} className="sr-only">搜索未排期任务</label>
        <Input
          id={searchId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索未排期任务"
          className="h-8 text-sm"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="px-3 pb-3 text-sm text-muted-foreground">
          {query ? "没有匹配的未排期任务" : "太好了，没有等待排期的任务"}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          {filtered.map((task) => (
            <TrayTaskRow
              key={task.id}
              task={task}
              draggable={draggable}
              onOpenTask={onOpenTask}
              onQuickSchedule={onQuickSchedule}
              {...(draggable && dragCallbacks ? dragCallbacks : {})}
            />
          ))}
        </ul>
      )}
    </>
  );
}

export function CalendarUnscheduledTray(props: Omit<UnscheduledListProps, "draggable">) {
  return (
    <aside
      data-calendar-unscheduled-tray=""
      aria-label="未排期任务"
      className="hidden w-72 shrink-0 flex-col border-l bg-background md:flex"
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">未排期任务</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{filterUnscheduledTasks(props.tasks).length}</span>
      </div>
      <UnscheduledTaskList {...props} draggable />
    </aside>
  );
}

export function CalendarUnscheduledSheet({
  open,
  onOpenChange,
  tasks,
  onOpenTask,
  onQuickSchedule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: TaskWithTags[];
  onOpenTask: (task: TaskWithTags) => void;
  onQuickSchedule: (task: TaskWithTags, shortcut: UnscheduledQuickShortcut) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        aria-describedby={undefined}
        className="rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-none"
        style={{ left: 0, top: "auto", bottom: 0, transform: "none", width: "100%", maxWidth: "none" }}
      >
        <DialogTitle className="pb-2 text-base font-semibold">未排期任务</DialogTitle>
        <div className="flex max-h-[60vh] min-h-0 flex-col">
          <UnscheduledTaskList
            tasks={tasks}
            draggable={false}
            onOpenTask={onOpenTask}
            onQuickSchedule={onQuickSchedule}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
