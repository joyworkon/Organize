"use client";

import { useId, useRef, useState } from "react";
import { Check, Filter, X } from "@/components/icons";
import { COLOR_STYLES } from "@/components/tags/tag-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_CALENDAR_TASK_FILTER,
  activeCalendarFilterCount,
  isCalendarFilterActive,
  type CalendarTaskFilter,
} from "@/lib/tasks/calendar-filters";
import { cn } from "@/lib/utils";
import { TASK_PRIORITY_CONFIG, type Tag, type TagColor, type TaskPriority } from "@organize/shared";

/**
 * 日历筛选栏三件套：
 * - `CalendarFilterButton`：工具栏「筛选」按钮 + 条件弹层（关键词 / 优先级 / 标签多选）；
 * - `CalendarFilterChips`：筛选生效时日历上方的条件 chip 行（逐个移除 + 清除筛选）；
 * - `CalendarFilterEmptyHint`：可见范围无匹配任务时的轻提示。
 * 状态与持久化都在页面层（calendar/page.tsx），这里只负责展示与上报变更。
 */

const PRIORITIES: readonly TaskPriority[] = ["high", "medium", "low"];

type FilterTag = Pick<Tag, "id" | "name" | "color">;

interface CalendarFilterProps {
  filter: CalendarTaskFilter;
  /** 用户已有标签（弹层多选列表与 chip 取名/配色）。 */
  tags: FilterTag[];
  onChange: (next: CalendarTaskFilter) => void;
}

function tagColorClass(color: FilterTag["color"]): string {
  return (color && COLOR_STYLES[color as TagColor]) || COLOR_STYLES.blue;
}

function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function CalendarFilterButton({ filter, tags, onChange }: CalendarFilterProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const keywordId = useId();
  const count = activeCalendarFilterCount(filter);
  const active = isCalendarFilterActive(filter);
  const patch = (partial: Partial<CalendarTaskFilter>) => onChange({ ...filter, ...partial });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // 与「日历显示选项」菜单同模式：Esc/点外关闭时把焦点还给触发器。
        if (!next) triggerRef.current?.focus();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          size="sm"
          aria-label="筛选日历任务"
          title="筛选日历任务"
          aria-expanded={open}
          className="shrink-0"
        >
          <Filter className="h-4 w-4" />
          筛选
          {count > 0 && (
            <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[10px] font-semibold leading-4 tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={8} aria-label="日历筛选条件" className="w-72 p-3">
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor={keywordId} className="mb-1 block text-xs font-medium text-muted-foreground">
              关键词
            </label>
            <Input
              id={keywordId}
              aria-label="按关键词筛选"
              value={filter.query}
              onChange={(event) => patch({ query: event.target.value })}
              placeholder="标题或描述包含…"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">优先级</span>
            <div role="group" aria-label="按优先级筛选" className="flex gap-1">
              {PRIORITIES.map((priority) => {
                const selected = filter.priorities.includes(priority);
                const config = TASK_PRIORITY_CONFIG[priority];
                return (
                  <button
                    key={priority}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => patch({ priorities: toggleValue(filter.priorities, priority) })}
                    className={cn(
                      "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md border px-2 text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-8",
                      selected
                        ? "border-primary bg-primary/5 font-medium text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <span aria-hidden className={cn("h-2 w-2 rounded-full", config.dot)} />
                    {config.label}
                  </button>
                );
              })}
            </div>
          </div>
          {tags.length > 0 && (
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">标签</span>
              <ul role="group" aria-label="按标签筛选" className="max-h-44 overflow-y-auto">
                {tags.map((tag) => {
                  const selected = filter.tagIds.includes(tag.id);
                  return (
                    <li key={tag.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => patch({ tagIds: toggleValue(filter.tagIds, tag.id) })}
                        className={cn(
                          "flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm hover:bg-muted",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9"
                        )}
                      >
                        <span
                          className={cn(
                            "inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium",
                            tagColorClass(tag.color)
                          )}
                        >
                          <span className="truncate">{tag.name}</span>
                        </span>
                        {selected && <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="flex justify-end border-t pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!active}
              onClick={() => onChange({ ...DEFAULT_CALENDAR_TASK_FILTER })}
            >
              清除筛选
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CalendarFilterChips({ filter, tags, onChange, onClear }: CalendarFilterProps & { onClear: () => void }) {
  if (!isCalendarFilterActive(filter)) return null;
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const query = filter.query.trim();
  const chipClass = "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium";
  const removeClass = cn(
    "grid h-4 w-4 shrink-0 place-items-center rounded-full hover:bg-black/10 dark:hover:bg-white/10",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  );
  const removeIcon = <X aria-hidden className="h-3 w-3" />;

  return (
    <div
      role="group"
      aria-label="当前筛选条件"
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-4 py-1.5 md:px-6"
    >
      {filter.tagIds.map((tagId) => {
        const tag = tagsById.get(tagId);
        if (!tag) return null;
        return (
          <span key={tagId} className={cn(chipClass, tagColorClass(tag.color))}>
            <span className="max-w-32 truncate">{tag.name}</span>
            <button
              type="button"
              aria-label={`移除筛选条件：标签 ${tag.name}`}
              onClick={() => onChange({ ...filter, tagIds: filter.tagIds.filter((id) => id !== tagId) })}
              className={removeClass}
            >
              {removeIcon}
            </button>
          </span>
        );
      })}
      {filter.priorities.map((priority) => {
        const config = TASK_PRIORITY_CONFIG[priority];
        return (
          <span key={priority} className={cn(chipClass, "bg-muted text-foreground")}>
            <span aria-hidden className={cn("h-2 w-2 rounded-full", config.dot)} />
            优先级：{config.label}
            <button
              type="button"
              aria-label={`移除筛选条件：优先级 ${config.label}`}
              onClick={() => onChange({ ...filter, priorities: filter.priorities.filter((item) => item !== priority) })}
              className={removeClass}
            >
              {removeIcon}
            </button>
          </span>
        );
      })}
      {query && (
        <span className={cn(chipClass, "bg-muted text-foreground")}>
          <span className="max-w-32 truncate">关键词：{query}</span>
          <button
            type="button"
            aria-label={`移除筛选条件：关键词 ${query}`}
            onClick={() => onChange({ ...filter, query: "" })}
            className={removeClass}
          >
            {removeIcon}
          </button>
        </span>
      )}
      <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={onClear}>
        清除筛选
      </Button>
    </div>
  );
}

/** 筛选生效但可见范围内没有任务时的轻提示（非弹窗）。 */
export function CalendarFilterEmptyHint({ onClear }: { onClear?: () => void }) {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-2 border-b px-4 py-2 text-sm text-muted-foreground"
    >
      <span>当前筛选下没有任务</span>
      {onClear && (
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onClear}>
          清除筛选
        </Button>
      )}
    </div>
  );
}
