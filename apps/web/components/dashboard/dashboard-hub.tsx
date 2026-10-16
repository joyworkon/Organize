"use client";

import { BarChart3, CalendarDays, Sun } from "@/components/icons";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
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

type DashboardAccount =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; userId: string | null };

/** Bind every workbench view (including hidden Today/capture) to the same account. */
export function DashboardHub() {
  const supabase = useMemo(() => createClient(), []);
  const [account, setAccount] = useState<DashboardAccount>({ status: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    let authEventSeen = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      authEventSeen = true;
      setAccount({ status: "ready", userId: session?.user.id ?? null });
    });
    // Subscribe first. An older initial read must not overwrite a newer auth event.
    void Promise.resolve().then(() => supabase.auth.getSession()).then(({ data, error }) => {
      if (!active || authEventSeen) return;
      if (error) {
        setAccount({ status: "error" });
        return;
      }
      setAccount({ status: "ready", userId: data.session?.user.id ?? null });
    }).catch(() => {
      if (active && !authEventSeen) setAccount({ status: "error" });
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase, retry]);

  if (account.status === "loading") {
    return <div className="dashboard-loading" role="status">正在确认账户…</div>;
  }
  if (account.status === "error") {
    return (
      <div className="dashboard-loading" role="alert">
        <p>暂时无法确认账户，请重试。</p>
        <Button variant="outline" onClick={() => {
          setAccount({ status: "loading" });
          setRetry((current) => current + 1);
        }}>重试</Button>
      </div>
    );
  }
  if (!account.userId) {
    return (
      <div className="dashboard-loading">
        <p>登录后查看你的工作台。</p>
        <Link href="/login" className="text-sm underline underline-offset-4">前往登录</Link>
      </div>
    );
  }
  // Same-account token refreshes preserve search and drafts; another owner remounts them.
  return <AccountDashboardHub key={account.userId} />;
}

function AccountDashboardHub() {
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
    <div className="dashboard-hub space-y-4">
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
