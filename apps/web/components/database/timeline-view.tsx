"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Database as DatabaseRecord, DatabaseRow as DatabaseRowRecord, DatabaseProperty, DatabaseView } from "@organize/shared";

interface TimelineViewProps {
  databaseId: string;
  db: DatabaseRecord;
  rows: DatabaseRowRecord[];
  view: DatabaseView;
  readOnly?: boolean;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (86400000));
}

export function TimelineView({
  db,
  rows,
  view,
  readOnly = false,
}: TimelineViewProps) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const schema = useMemo<DatabaseProperty[]>(
    () => (Array.isArray(db.schema) && db.schema.length ? db.schema : [{ id: "prop_name", name: "名称", type: "text" }]),
    [db.schema]
  );

  // 开始/结束日期属性
  const startPropId = useMemo(() => {
    if (view.config.startPropertyId) return view.config.startPropertyId as string;
    const dates = schema.filter((p) => p.type === "date");
    return dates[0]?.id || "";
  }, [view.config.startPropertyId, schema]);

  const endPropId = useMemo(() => {
    if (view.config.endPropertyId) return view.config.endPropertyId as string;
    const dates = schema.filter((p) => p.type === "date");
    return dates[1]?.id || dates[0]?.id || "";
  }, [view.config.endPropertyId, schema]);

  const startProp = schema.find((p) => p.id === startPropId);
  const endProp = schema.find((p) => p.id === endPropId);
  const titleProp = schema.find((p) => p.type === "text") || schema[0];

  // 月范围
  const { year, month } = currentMonth;
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const totalDays = monthEnd.getDate();

  // 过滤有日期的行
  const timelineRows = useMemo(() => {
    if (!startProp) return [];
    return rows
      .map((row) => {
        const values = (row.values || {}) as Record<string, unknown>;
        const startVal = values[startPropId];
        const endVal = endPropId !== startPropId ? values[endPropId] : startVal;
        if (!startVal || typeof startVal !== "string") return null;
        const start = new Date(startVal.slice(0, 10) + "T00:00:00");
        const end = endVal && typeof endVal === "string"
          ? new Date(endVal.slice(0, 10) + "T00:00:00")
          : start;
        if (isNaN(start.getTime())) return null;
        const title = values[titleProp.id];
        return {
          row,
          title: title ? String(title) : "未命名",
          start,
          end: isNaN(end.getTime()) ? start : end,
        };
      })
      .filter(Boolean) as { row: DatabaseRowRecord; title: string; start: Date; end: Date }[];
  }, [rows, startPropId, endPropId, startProp, titleProp]);

  const prevMonth = () => {
    setCurrentMonth(({ year, month }) =>
      month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
    );
  };
  const nextMonth = () => {
    setCurrentMonth(({ year, month }) =>
      month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
    );
  };

  if (!startProp) {
    return (
      <div className="organize-db-timeline-empty">
        <p>时间轴视图需要至少一个「日期」属性作为开始时间。</p>
        <p className="organize-db-timeline-hint">添加两个日期列可显示时间区间条。</p>
      </div>
    );
  }

  const todayStr = toDateStr(new Date());

  return (
    <div className="organize-db-timeline">
      <div className="organize-db-timeline-nav">
        <button type="button" className="organize-db-calendar-nav-btn" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="organize-db-calendar-title">{year}年{month + 1}月</span>
        <button type="button" className="organize-db-calendar-nav-btn" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="organize-db-timeline-body">
        {/* 日期刻度 */}
        <div className="organize-db-timeline-header">
          <div className="organize-db-timeline-label-col" />
          <div className="organize-db-timeline-days">
            {Array.from({ length: totalDays }, (_, i) => {
              const d = new Date(year, month, i + 1);
              const ds = toDateStr(d);
              return (
                <div
                  key={i}
                  className={`organize-db-timeline-day ${ds === todayStr ? "is-today" : ""}`}
                >
                  {i + 1}
                </div>
              );
            })}
          </div>
        </div>

        {/* 行 */}
        {timelineRows.length === 0 ? (
          <div className="organize-db-timeline-no-rows">本月无时间数据</div>
        ) : (
          timelineRows.map(({ row, title, start, end }) => {
            // 计算条的位置（相对于本月）
            const barStart = Math.max(0, daysBetween(monthStart, start));
            const barEnd = Math.min(totalDays - 1, daysBetween(monthStart, end));
            // 如果完全不在本月内则不显示
            if (barStart > totalDays - 1 || barEnd < 0) return null;
            const left = (barStart / totalDays) * 100;
            const width = Math.max(((barEnd - barStart + 1) / totalDays) * 100, 100 / totalDays);

            return (
              <div key={row.id} className="organize-db-timeline-row">
                <div className="organize-db-timeline-label-col" title={title}>
                  {title}
                </div>
                <div className="organize-db-timeline-track">
                  <div
                    className="organize-db-timeline-bar"
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${toDateStr(start)} → ${toDateStr(end)}`}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default TimelineView;
