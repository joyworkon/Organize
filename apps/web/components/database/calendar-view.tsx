"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Database as DatabaseRecord, DatabaseRow as DatabaseRowRecord, DatabaseProperty, DatabaseView } from "@organize/shared";

interface CalendarViewProps {
  databaseId: string;
  db: DatabaseRecord;
  rows: DatabaseRowRecord[];
  view: DatabaseView;
  readOnly?: boolean;
  onAddRow: (defaults?: Record<string, unknown>) => void;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CalendarView({
  db,
  rows,
  view,
  readOnly = false,
  onAddRow,
}: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const schema = useMemo<DatabaseProperty[]>(
    () => (Array.isArray(db.schema) && db.schema.length ? db.schema : [{ id: "prop_name", name: "名称", type: "text" }]),
    [db.schema]
  );

  // 找到日期属性
  const datePropId = useMemo(() => {
    if (view.config.datePropertyId) return view.config.datePropertyId as string;
    const dp = schema.find((p) => p.type === "date");
    return dp?.id || "";
  }, [view.config.datePropertyId, schema]);

  const dateProp = schema.find((p) => p.id === datePropId);
  const titleProp = schema.find((p) => p.type === "text") || schema[0];

  // 按日期分组行
  const rowsByDate = useMemo(() => {
    const map = new Map<string, DatabaseRowRecord[]>();
    if (!dateProp) return map;
    for (const row of rows) {
      const values = (row.values || {}) as Record<string, unknown>;
      const dateVal = values[datePropId];
      if (!dateVal || typeof dateVal !== "string") continue;
      // 支持 "2026-01-15" 或 ISO 格式
      const dateKey = dateVal.slice(0, 10);
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(row);
    }
    return map;
  }, [rows, datePropId, dateProp]);

  // 生成月网格
  const calendarDays = useMemo(() => {
    const { year, month } = currentMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    // 周一开始（0=周一）
    let startWeekday = firstDay.getDay() - 1;
    if (startWeekday < 0) startWeekday = 6;

    const days: { date: Date; dateStr: string; inMonth: boolean }[] = [];
    // 前面的填充日
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({ date: d, dateStr: toDateStr(d), inMonth: false });
    }
    // 本月
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d);
      days.push({ date, dateStr: toDateStr(date), inMonth: true });
    }
    // 后面填充到 42 格（6 行）或至少到整行
    while (days.length % 7 !== 0) {
      const last = days[days.length - 1].date;
      const next = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
      days.push({ date: next, dateStr: toDateStr(next), inMonth: false });
    }
    return days;
  }, [currentMonth]);

  const prevMonth = () => {
    setCurrentMonth(({ year, month }) => {
      if (month === 0) return { year: year - 1, month: 11 };
      return { year, month: month - 1 };
    });
  };

  const nextMonth = () => {
    setCurrentMonth(({ year, month }) => {
      if (month === 11) return { year: year + 1, month: 0 };
      return { year, month: month + 1 };
    });
  };

  const todayStr = toDateStr(new Date());

  if (!dateProp) {
    return (
      <div className="organize-db-calendar-empty">
        <p>日历视图需要一个「日期」属性。</p>
        <p className="organize-db-calendar-hint">请在表格视图中添加一个日期类型的列。</p>
      </div>
    );
  }

  return (
    <div className="organize-db-calendar">
      <div className="organize-db-calendar-nav">
        <button type="button" className="organize-db-calendar-nav-btn" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="organize-db-calendar-title">
          {currentMonth.year}年{currentMonth.month + 1}月
        </span>
        <button type="button" className="organize-db-calendar-nav-btn" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="organize-db-calendar-grid">
        <div className="organize-db-calendar-weekdays">
          {WEEKDAYS.map((d) => (
            <div key={d} className="organize-db-calendar-weekday">{d}</div>
          ))}
        </div>
        <div className="organize-db-calendar-days">
          {calendarDays.map(({ dateStr, inMonth }) => {
            const dayRows = rowsByDate.get(dateStr) || [];
            const isToday = dateStr === todayStr;
            return (
              <div
                key={dateStr}
                className={`organize-db-calendar-day ${inMonth ? "" : "is-outside"} ${isToday ? "is-today" : ""}`}
              >
                <div className="organize-db-calendar-day-num">
                  {parseInt(dateStr.slice(8, 10), 10)}
                </div>
                <div className="organize-db-calendar-day-items">
                  {dayRows.slice(0, 3).map((row) => {
                    const values = (row.values || {}) as Record<string, unknown>;
                    const title = values[titleProp.id];
                    return (
                      <div key={row.id} className="organize-db-calendar-item">
                        {title ? String(title) : "未命名"}
                      </div>
                    );
                  })}
                  {dayRows.length > 3 && (
                    <div className="organize-db-calendar-more">+{dayRows.length - 3}</div>
                  )}
                </div>
                {!readOnly && inMonth && (
                  <button
                    type="button"
                    className="organize-db-calendar-add"
                    onClick={() => onAddRow({ [datePropId]: dateStr })}
                    title="在此日期新增"
                  >
                    <Plus className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default CalendarView;
