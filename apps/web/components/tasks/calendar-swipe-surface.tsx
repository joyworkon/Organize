"use client";

import { useRef, type HTMLAttributes, type PointerEvent as ReactPointerEvent } from "react";
import { acceptSwipePointer, advanceSwipe, beginSwipe, type SwipeGesture } from "@/lib/tasks/calendar-swipe";
import { cn } from "@/lib/utils";

interface CalendarSwipeSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  /** 达到阈值时调用：-1 上一页，1 下一页（与顶栏按钮同一 step）。 */
  onSwipeStep: (direction: -1 | 1) => void;
}

/** 与壳断点一致（ui-change-guide：767px 单断点）；jsdom 没有 matchMedia，视为窄屏以便测试。 */
function isNarrowViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(max-width: 767px)").matches;
}

/**
 * 手机日历左右滑动翻页的承载容器。
 * - `touch-pan-y`：纵向滚动继续交给浏览器（纵向手势会收到 pointercancel，自然不翻页）；横向位移才进到这里。
 * - 只在手机宽度、非鼠标指针下工作；桌面（≥md）恢复 touch-auto 且 pointerdown 直接忽略。
 * - 任务芯片 / 倒数日 / resize 热区在有改期回调时都 stopPropagation，收不到它们的手势；
 *   时间网格空白拖选不阻止冒泡，但本组件在 pointermove 达阈值时就翻页，网格会因日期范围变化自行取消拖选。
 * - 每次手势最多翻一页。
 */
export function CalendarSwipeSurface({ onSwipeStep, className, children, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, ...rest }: CalendarSwipeSurfaceProps) {
  const gestureRef = useRef<SwipeGesture | null>(null);

  const handleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    onPointerDown?.(event);
    if (!acceptSwipePointer(event) || !isNarrowViewport()) return;
    gestureRef.current = beginSwipe(event.pointerId, event.clientX, event.clientY);
  };

  const handleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    onPointerMove?.(event);
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const next = advanceSwipe(gesture, event.clientX, event.clientY);
    gestureRef.current = next.gesture;
    if (next.step) onSwipeStep(next.step);
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId === event.pointerId) gestureRef.current = null;
  };

  return (
    <div
      {...rest}
      data-calendar-swipe=""
      className={cn("touch-pan-y touch-pinch-zoom md:touch-auto", className)}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={(event) => { onPointerUp?.(event); finish(event); }}
      onPointerCancel={(event) => { onPointerCancel?.(event); finish(event); }}
    >
      {children}
    </div>
  );
}
