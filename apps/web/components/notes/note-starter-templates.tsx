"use client";

import { useRef } from "react";
import {
  BookOpen,
  CalendarDays,
  FileText,
  GanttChart,
  ListTodo,
  Users,
  type DsIconComponent,
} from "@/components/icons";
import {
  starterTemplateName,
  type StarterTemplateId,
} from "@/lib/notes/starter-templates";

export type StarterOptionId = StarterTemplateId | "blank";

interface StarterOption {
  id: StarterOptionId;
  icon: DsIconComponent;
  name: string;
  description: string;
}

const OPTIONS: StarterOption[] = [
  { id: "meeting", icon: Users, name: starterTemplateName("meeting"), description: "会议信息、议题、结论与行动项" },
  { id: "weekly", icon: CalendarDays, name: starterTemplateName("weekly"), description: "本周工作、下周计划、问题与风险" },
  { id: "reading", icon: BookOpen, name: starterTemplateName("reading"), description: "书籍信息、摘录与我的想法" },
  { id: "project", icon: GanttChart, name: starterTemplateName("project"), description: "目标、里程碑与下一步行动" },
  { id: "todo", icon: ListTodo, name: starterTemplateName("todo"), description: "一组可直接勾选的待办事项" },
  { id: "blank", icon: FileText, name: "空白页", description: "不使用模板，直接开始书写" },
];

interface NoteStarterTemplatesProps {
  onSelect: (id: StarterOptionId) => void;
  /** Esc / 空白页：本次打开会话不再显示面板 */
  onDismiss: () => void;
}

/**
 * 空白笔记的「快速开始」面板（仅正文为空且可编辑时由页面挂载）。
 * 键盘：Tab 进入，方向键在选项间移动，Enter 选择，Esc 关闭。
 */
export function NoteStarterTemplates({ onSelect, onDismiss }: NoteStarterTemplatesProps) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % OPTIONS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + OPTIONS.length) % OPTIONS.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = OPTIONS.length - 1;
    }
    if (next !== null) {
      event.preventDefault();
      itemRefs.current[next]?.focus();
    }
  };

  return (
    <div role="group" aria-label="快速开始" className="mb-6" onKeyDown={(event) => {
      // 焦点在面板容器上（而非某个按钮）时也让 Esc 可达
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    }}>
      <div className="mb-2 text-xs font-medium text-muted-foreground">快速开始</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {OPTIONS.map((option, index) => {
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              onClick={() => onSelect(option.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className="flex min-h-11 flex-col items-start gap-1 rounded-lg border bg-card px-3 py-2.5 text-left ring-offset-background transition-colors duration-100 motion-reduce:duration-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-[3px]"
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Icon className="h-4 w-4 text-muted-foreground" />
                {option.name}
              </span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
