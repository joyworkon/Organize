"use client";

import { useState } from "react";
import { ChevronDown, Filter } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TagBadge } from "@/components/tags/tag-badge";
import { cn } from "@/lib/utils";
import {
  TASK_CATEGORY_CONFIG,
  TASK_PRIORITY_CONFIG,
  TASK_STATUS_CONFIG,
  type TagWithCount,
  type TaskCategory,
  type TaskPriority,
  type TaskStatus,
} from "@organize/shared";

/**
 * 待办筛选面板（U-layout 第四步）。
 *
 * 改版前：待办页在清单头与首条任务之间摊开一条筛选横带（状态 / 分类 / 优先级 /
 * 标签四个控件），默认值全是「全部 X」，一排占位文字比任务本身更抢眼；移动端另有
 * 一套折叠开关。现在收成清单头里的单个「筛选」触发器 + 一个面板，桌面与移动共用，
 * 生效条数直接标在触发器上，所以「有没有筛选」比展开一排下拉更好读。
 *
 * 面板内部**不使用嵌套 Select**（Radix Select 开在 Popover 内会与外层
 * DismissableLayer 打架），四组条件统一用 chip 单选/多选按钮。
 */
export interface TaskFilterState {
  status: "all" | TaskStatus;
  category: "all" | TaskCategory;
  priority: "all" | TaskPriority;
  tagIds: string[];
}

export const EMPTY_TASK_FILTER: TaskFilterState = {
  status: "all",
  category: "all",
  priority: "all",
  tagIds: [],
};

/** 生效筛选条数：三组单选各算 1，标签按选中个数累加（与改版前的计数语义一致）。 */
export function countActiveTaskFilters(value: TaskFilterState): number {
  return (
    (value.status !== "all" ? 1 : 0)
    + (value.category !== "all" ? 1 : 0)
    + (value.priority !== "all" ? 1 : 0)
    + value.tagIds.length
  );
}

/** 标签选中态切换（选中则移除，未选中则追加，保持点击顺序）。 */
export function toggleTaskFilterTag(value: TaskFilterState, tagId: string): TaskFilterState {
  return {
    ...value,
    tagIds: value.tagIds.includes(tagId)
      ? value.tagIds.filter((id) => id !== tagId)
      : [...value.tagIds, tagId],
  };
}

interface ChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Chip({ active, onClick, children }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      {children}
    </button>
  );
}

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

interface TaskFilterMenuProps {
  value: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
  tags: TagWithCount[];
  className?: string;
}

export function TaskFilterMenu({ value, onChange, tags, className }: TaskFilterMenuProps) {
  const [open, setOpen] = useState(false);
  const activeCount = countActiveTaskFilters(value);
  const hasFilter = activeCount > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="筛选任务"
          className={cn("gap-1.5", hasFilter ? "border-primary text-primary" : "organize-filter-idle", className)}
        >
          <Filter className="h-3.5 w-3.5" />
          筛选{hasFilter ? ` · ${activeCount}` : ""}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[17.5rem] space-y-3 p-3">
        <ChipGroup label="按状态筛选">
          <Chip active={value.status === "all"} onClick={() => onChange({ ...value, status: "all" })}>全部</Chip>
          {(Object.entries(TASK_STATUS_CONFIG) as [TaskStatus, { label: string }][]).map(([key, config]) => (
            <Chip key={key} active={value.status === key} onClick={() => onChange({ ...value, status: key })}>
              {config.label}
            </Chip>
          ))}
        </ChipGroup>

        <ChipGroup label="按分类筛选">
          <Chip active={value.category === "all"} onClick={() => onChange({ ...value, category: "all" })}>全部</Chip>
          {(Object.entries(TASK_CATEGORY_CONFIG) as [TaskCategory, { label: string; icon: string }][]).map(([key, config]) => (
            <Chip key={key} active={value.category === key} onClick={() => onChange({ ...value, category: key })}>
              {config.icon} {config.label}
            </Chip>
          ))}
        </ChipGroup>

        <ChipGroup label="按优先级筛选">
          <Chip active={value.priority === "all"} onClick={() => onChange({ ...value, priority: "all" })}>全部</Chip>
          {(Object.entries(TASK_PRIORITY_CONFIG) as [TaskPriority, { label: string }][]).map(([key, config]) => (
            <Chip key={key} active={value.priority === key} onClick={() => onChange({ ...value, priority: key })}>
              {config.label}
            </Chip>
          ))}
        </ChipGroup>

        <ChipGroup label="按标签筛选">
          {tags.length === 0 ? (
            <p className="py-1 text-xs text-muted-foreground">还没有标签</p>
          ) : (
            <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
              {tags.map((tag) => (
                <TagBadge
                  key={tag.id}
                  tag={tag}
                  active={value.tagIds.includes(tag.id)}
                  onClick={() => onChange(toggleTaskFilterTag(value, tag.id))}
                />
              ))}
            </div>
          )}
        </ChipGroup>

        {hasFilter && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-full text-xs"
            onClick={() => onChange({ ...EMPTY_TASK_FILTER })}
          >
            清除筛选（{activeCount}）
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
