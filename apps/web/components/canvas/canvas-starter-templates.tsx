"use client";

/**
 * 空白画布的「快速开始」面板：完全空白且可编辑的画布在视口中央显示，
 * 选一个起步结构一次性插入（一条可撤销历史），或选「空白画布」直接开始。
 *
 * 显示/隐藏由工作区与视口决定（空白 + 可编辑 + 非预览 + 本次会话未关闭），
 * 本组件只负责选项、键盘与可访问性：Tab 进入，方向键 / Home / End 在选项间移动，
 * Enter 选择，Esc 关闭（本次打开会话不再显示）。
 */

import { useRef } from "react";
import {
  FileText,
  GanttChart,
  GitGraph,
  Kanban,
  LayoutGrid,
  Lightbulb,
  type DsIconComponent,
} from "@/components/icons";
import {
  canvasStarterTemplateName,
  type CanvasStarterTemplateId,
} from "@/lib/canvas/starter-templates";

export type CanvasStarterOptionId = CanvasStarterTemplateId | "blank";

interface StarterOption {
  id: CanvasStarterOptionId;
  icon: DsIconComponent;
  name: string;
  description: string;
}

const OPTIONS: StarterOption[] = [
  { id: "brainstorm", icon: Lightbulb, name: canvasStarterTemplateName("brainstorm"), description: "中心主题加六张便签，先发散再归类" },
  { id: "flowchart", icon: GitGraph, name: canvasStarterTemplateName("flowchart"), description: "开始到结束四个节点，箭头连线相接" },
  { id: "kanban", icon: Kanban, name: canvasStarterTemplateName("kanban"), description: "待办 / 进行中 / 完成三列卡片" },
  { id: "swot", icon: LayoutGrid, name: canvasStarterTemplateName("swot"), description: "优势、劣势、机会、威胁四象限" },
  { id: "project", icon: GanttChart, name: canvasStarterTemplateName("project"), description: "目标、三阶段里程碑与下一步行动" },
  { id: "blank", icon: FileText, name: "空白画布", description: "关闭面板，直接在画布上开始" },
];

export interface CanvasStarterTemplatesProps {
  onSelect: (template: CanvasStarterTemplateId) => void;
  /** Esc / 「空白画布」：本次打开会话不再显示面板。 */
  onDismiss: () => void;
}

export function CanvasStarterTemplates({ onSelect, onDismiss }: CanvasStarterTemplatesProps) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const choose = (id: CanvasStarterOptionId) => {
    if (id === "blank") onDismiss();
    else onSelect(id);
  };

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
      event.stopPropagation();
      itemRefs.current[next]?.focus();
    }
  };

  return (
    <div
      className="canvas-starter-panel"
      role="group"
      aria-label="快速开始"
      data-testid="canvas-starter-panel"
      onKeyDown={(event) => {
        // 焦点在面板容器而非某个按钮上时也让 Esc 可达
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onDismiss();
        }
      }}
    >
      <div className="canvas-starter-head">
        <h2 className="canvas-starter-title">快速开始</h2>
        <p className="canvas-starter-subtitle">选一个起步结构，一次插入、一步撤销；也可以直接双击画布空白处新建页面。</p>
      </div>
      <div className="canvas-starter-grid">
        {OPTIONS.map((option, index) => {
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              className="canvas-starter-option"
              data-starter-option={option.id}
              onClick={() => choose(option.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span className="canvas-starter-option-name">
                <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                {option.name}
              </span>
              <span className="canvas-starter-option-desc">{option.description}</span>
            </button>
          );
        })}
      </div>
      <p className="canvas-starter-foot">Esc 关闭 · 开始编辑后面板自动消失</p>
    </div>
  );
}
