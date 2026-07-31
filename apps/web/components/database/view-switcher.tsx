"use client";

import { useState, useRef, useEffect } from "react";
import {
  Table2, Kanban, List, LayoutGrid, CalendarDays, GanttChart, BarChart3, LayoutDashboard,
  Plus, Trash2,
} from "lucide-react";
import type { DatabaseView, DatabaseViewType } from "@organize/shared";

const VIEW_TYPE_META: Record<string, { icon: typeof Table2; label: string }> = {
  table: { icon: Table2, label: "表格" },
  board: { icon: Kanban, label: "看板" },
  list: { icon: List, label: "列表" },
  gallery: { icon: LayoutGrid, label: "画廊" },
  calendar: { icon: CalendarDays, label: "日历" },
  timeline: { icon: GanttChart, label: "时间轴" },
  chart: { icon: BarChart3, label: "图表" },
  admin: { icon: LayoutDashboard, label: "面板" },
};

/** 支持新建的视图类型（M4 基础视图 + M5 图表/管理面板） */
const CREATABLE_VIEW_TYPES: DatabaseViewType[] = [
  "table", "board", "list", "gallery", "calendar", "timeline", "chart", "admin",
];

function generateViewId(): string {
  return `view_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

interface ViewSwitcherProps {
  views: DatabaseView[];
  activeViewId: string;
  onViewChange: (viewId: string) => void;
  onAddView?: (view: DatabaseView) => void;
  onDeleteView?: (viewId: string) => void;
  readOnly?: boolean;
}

export function ViewSwitcher({
  views,
  activeViewId,
  onViewChange,
  onAddView,
  onDeleteView,
  readOnly = false,
}: ViewSwitcherProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen && !contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) setContextMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen, contextMenu]);

  const handleAdd = (type: DatabaseViewType) => {
    const meta = VIEW_TYPE_META[type];
    const newView: DatabaseView = {
      id: generateViewId(),
      name: meta?.label || type,
      type,
      config: {},
    };
    onAddView?.(newView);
    setMenuOpen(false);
    onViewChange(newView.id);
  };

  return (
    <div className="organize-db-view-switcher" contentEditable={false}>
      <div className="organize-db-view-tabs">
        {views.map((view) => {
          const meta = VIEW_TYPE_META[view.type] || VIEW_TYPE_META.table;
          const isActive = view.id === activeViewId;
          return (
            <div key={view.id} className="organize-db-view-tab-wrap">
              <button
                type="button"
                className={`organize-db-view-tab ${isActive ? "is-active" : ""}`}
                onClick={() => onViewChange(view.id)}
                onContextMenu={(e) => {
                  if (readOnly || views.length <= 1) return;
                  e.preventDefault();
                  setContextMenu(view.id);
                }}
              >
                <meta.icon className="h-3.5 w-3.5" />
                <span>{view.name || meta.label}</span>
              </button>
              {contextMenu === view.id && !readOnly && views.length > 1 && (
                <div ref={ctxRef} className="organize-db-view-ctx-menu">
                  <button
                    type="button"
                    className="organize-db-menu-item is-danger"
                    onClick={() => { onDeleteView?.(view.id); setContextMenu(null); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />删除视图
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <div className="organize-db-view-add" ref={menuRef}>
          <button
            type="button"
            className="organize-db-view-add-btn"
            onClick={() => setMenuOpen(!menuOpen)}
            title="新增视图"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <div className="organize-db-view-type-menu">
              <div className="organize-db-menu-label">选择视图类型</div>
              {CREATABLE_VIEW_TYPES.map((type) => {
                const meta = VIEW_TYPE_META[type];
                return (
                  <button
                    key={type}
                    type="button"
                    className="organize-db-menu-item"
                    onClick={() => handleAdd(type)}
                  >
                    <meta.icon className="h-3.5 w-3.5" />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ViewSwitcher;
