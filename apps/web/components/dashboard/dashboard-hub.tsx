"use client";

import { BarChart3, CalendarDays, Sun } from "@/components/icons";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageSearch } from "@/components/layout/page-search";
import ReviewView from "./review-view";
import StatsView from "./stats-view";
import TodayView from "./today-view";
import { cn } from "@/lib/utils";

type DashboardView = "today" | "review" | "stats";

const VIEWS: Array<{
  id: DashboardView;
  label: string;
  shortLabel: string;
  icon: typeof Sun;
}> = [
  { id: "today", label: "今天", shortLabel: "今天", icon: Sun },
  { id: "review", label: "日历回顾", shortLabel: "回顾", icon: CalendarDays },
  { id: "stats", label: "趋势统计", shortLabel: "统计", icon: BarChart3 },
];

export function DashboardHub() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const requested = searchParams.get("view");
  const current: DashboardView =
    requested === "review" || requested === "stats" ? requested : "today";

  const changeView = (view: DashboardView) => {
    const params = new URLSearchParams(searchParams.toString());
    if (view === "today") params.delete("view");
    else params.set("view", view);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div className="space-y-5">
      <div className="dashboard-view-switcher">
        <div>
          <strong>工作台</strong>
        </div>
        <div className="dashboard-view-switcher-tools">
        <div role="tablist" aria-label="工作台视图">
          {VIEWS.map((view) => {
            const Icon = view.icon;
            const selected = current === view.id;
            return (
              <button
                key={view.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-label={view.label}
                className={cn(selected && "is-active")}
                onClick={() => changeView(view.id)}
              >
                <Icon className="h-4 w-4" />
                <span aria-hidden="true" className="hidden sm:inline">
                  {view.label}
                </span>
                <span aria-hidden="true" className="sm:hidden">
                  {view.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
        {/* 页内搜索：与「工作台」标题同一行、内容框最右侧。
            只在「今天」视图渲染——回顾是日历、统计是图表，没有可被关键词筛的列表。 */}
        {current === "today" && (
          <PageSearch
            value={search}
            onChange={setSearch}
            placeholder="搜索工作台（标题 / 标签）"
          />
        )}
        </div>
      </div>

      <div role="tabpanel">
        {current === "today" && <TodayView search={search} />}
        {current === "review" && <ReviewView />}
        {current === "stats" && <StatsView />}
      </div>
    </div>
  );
}
