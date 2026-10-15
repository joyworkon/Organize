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
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  return (
    <div className="dashboard-hub space-y-5">
      <div className="dashboard-view-switcher">
        <strong className="dashboard-workbench-label">工作台</strong>
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
                id={`dashboard-tab-${view.id}`}
                aria-controls="dashboard-panel"
                tabIndex={selected ? 0 : -1}
                className={cn(selected && "is-active")}
                onClick={() => changeView(view.id)}
                onKeyDown={(event) => {
                  const index = VIEWS.findIndex(
                    (entry) => entry.id === current,
                  );
                  const nextIndex =
                    event.key === "ArrowRight"
                      ? (index + 1) % VIEWS.length
                      : event.key === "ArrowLeft"
                        ? (index + VIEWS.length - 1) % VIEWS.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? VIEWS.length - 1
                            : null;
                  if (nextIndex === null) return;
                  event.preventDefault();
                  changeView(VIEWS[nextIndex].id);
                  document
                    .getElementById(`dashboard-tab-${VIEWS[nextIndex].id}`)
                    ?.focus();
                }}
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
        {/* 搜索独占固定槽位，隐藏时不影响标签页的位置。 */}
        <div
          className="dashboard-search-slot"
          aria-hidden={current !== "today"}
        >
          {current === "today" && (
            <PageSearch
              value={search}
              onChange={setSearch}
              placeholder="搜索已加载内容（标题 / 标签）"
            />
          )}
        </div>
      </div>

      <div
        id="dashboard-panel"
        role="tabpanel"
        aria-labelledby={`dashboard-tab-${current}`}
        tabIndex={0}
      >
        <div className={current === "today" ? "" : "hidden"}>
          <TodayView
            search={search}
            searchControl={
              <PageSearch
                value={search}
                onChange={setSearch}
                placeholder="搜索已加载内容"
                label="搜索工作台（标题 / 标签）"
              />
            }
          />
        </div>
        {current === "review" && <ReviewView />}
        {current === "stats" && <StatsView />}
      </div>
    </div>
  );
}
