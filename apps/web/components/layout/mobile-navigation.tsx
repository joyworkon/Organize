"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu, Plus, Search } from "lucide-react";
import { MobileBottomBar } from "./mobile-bottom-bar";
import { MOBILE_DESTINATIONS, MOBILE_LOCATIONS_KEY, collectionLocation, mobileKeyboardOpen, mobileRoute, readMobileLocations } from "@/lib/navigation/mobile";
import type { MobileLocations, MobileSection } from "@/lib/navigation/mobile";

const MobileNavigationContext = createContext<MobileLocations>({});

export function MobileNavigation({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const route = mobileRoute(pathname, params);
  const [locations, setLocations] = useState<MobileLocations>({});
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let remembered: MobileLocations = {};
    try { remembered = readMobileLocations(sessionStorage.getItem(MOBILE_LOCATIONS_KEY)); } catch {}
    const location = collectionLocation(pathname, new URLSearchParams(params));
    if (location && route.section) remembered[route.section] = location;
    setLocations(remembered);
    try { sessionStorage.setItem(MOBILE_LOCATIONS_KEY, JSON.stringify(remembered)); } catch {}
  }, [pathname, params, route.section]);

  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    let unfocusedHeight = window.innerHeight;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = document.activeElement;
        const inputFocused = element instanceof HTMLElement && (element.isContentEditable || element.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="range"])'));
        const small = window.matchMedia("(max-width: 767px)").matches;
        if (!inputFocused) unfocusedHeight = window.innerHeight;
        const keyboard = mobileKeyboardOpen(Math.max(unfocusedHeight, window.innerHeight), viewport?.height ?? window.innerHeight, viewport?.offsetTop ?? 0, viewport?.scale ?? 1, inputFocused);
        setEditing(small && keyboard);
        document.documentElement.style.setProperty("--mobile-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
        document.documentElement.style.setProperty("--mobile-viewport-top", `${viewport?.offsetTop ?? 0}px`);
      });
    };
    update();
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      document.documentElement.style.removeProperty("--mobile-viewport-height");
      document.documentElement.style.removeProperty("--mobile-viewport-top");
    };
  }, []);

  const createMode = route.section === "library" ? "url" : route.section === "notes" ? "note" : route.section === "tasks" ? "task" : route.section === "memos" ? "memo" : "menu";
  const createLabel = ({ url: "保存链接", note: "新建笔记", task: "添加待办", memo: "新建速记", menu: "新建内容" })[createMode];

  return (
    <MobileNavigationContext.Provider value={locations}>
      <div className="organize-app-shell" data-mobile-detail={route.detail} data-mobile-editing={editing}>
        <div className="mobile-status-surface" aria-hidden="true" />
        {!route.detail && (
          <header className="mobile-app-header">
            <button type="button" className="mobile-icon-button" aria-label="更多导航与设置" onClick={() => window.dispatchEvent(new CustomEvent("organize:navigation"))}>
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">{route.title}</h1>
            <button type="button" className="mobile-icon-button" aria-label="全局搜索" onClick={() => window.dispatchEvent(new CustomEvent("organize:command-palette"))}>
              <Search className="h-5 w-5" />
            </button>
            <button type="button" className="mobile-icon-button mobile-create-button" aria-label={createLabel} onClick={() => window.dispatchEvent(new CustomEvent("organize:quick-add", { detail: { mode: createMode } }))}>
              <Plus className="h-5 w-5" />
            </button>
          </header>
        )}
        {children}
        {!route.detail && !editing && <MobileBottomBar active={route.section} locations={locations} />}
      </div>
    </MobileNavigationContext.Provider>
  );
}

/** A detail opened from a filtered list returns to that list, including on reload. */
export function CollectionBackLink({ section, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { section: MobileSection }) {
  const locations = useContext(MobileNavigationContext);
  const fallback = MOBILE_DESTINATIONS.find((item) => item.key === section)!.href;
  return <Link {...props} href={locations[section] || fallback} />;
}
