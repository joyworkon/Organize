export type MobileSection = "home" | "library" | "notes" | "tasks" | "memos";

export const MOBILE_DESTINATIONS = [
  { key: "home", href: "/", label: "首页" },
  { key: "library", href: "/library", label: "阅读" },
  { key: "notes", href: "/notes", label: "笔记" },
  { key: "tasks", href: "/tasks?scope=all", label: "待办" },
  { key: "memos", href: "/memos", label: "速记" },
] as const;

const taskTools = new Set(["/tasks/calendar", "/tasks/countdown", "/tasks/lessons", "/tasks/search"]);

/** Explicit route boundaries keep tools out of the task-detail layout. */
export function mobileRoute(pathname: string, params = new URLSearchParams()) {
  let section: MobileSection | null = null;
  let title = "Organize";
  let detail = false;
  if (pathname === "/") section = "home";
  else if (pathname === "/library" || pathname.startsWith("/library/")) {
    section = "library"; title = "稍后读"; detail = pathname !== "/library";
  } else if (pathname === "/notes" || pathname.startsWith("/notes/")) {
    section = "notes"; title = "笔记"; detail = pathname !== "/notes";
  } else if (pathname === "/tasks" || pathname.startsWith("/tasks/")) {
    section = "tasks"; title = "待办";
    detail = (pathname !== "/tasks" && !taskTools.has(pathname)) || Boolean(params.get("task"));
  } else if (pathname === "/memos") { section = "memos"; title = "速记"; }
  else if (pathname === "/graph") { section = "notes"; title = "知识图谱"; }
  else if (pathname === "/tags") { section = "library"; title = "标签管理"; }
  else if (pathname === "/lessons" || pathname.startsWith("/lessons/")) { section = "tasks"; title = "经验"; }
  else {
    title = ({ "/favorites": "收藏夹", "/settings": "设置", "/plugins": "插件管理", "/trash": "垃圾箱", "/shared": "与我共享", "/spaces": "协作空间", "/share": "保存到 Organize", "/review": "回顾", "/stats": "统计", "/inbox": "收集箱" } as Record<string, string>)[pathname] || "Organize";
  }
  return { section, title, detail };
}

export type MobileLocations = Partial<Record<MobileSection, string>>;
export const MOBILE_LOCATIONS_KEY = "organize:mobile-locations";

/** Only collection URLs may become tab destinations; never store open task IDs. */
export function collectionLocation(pathname: string, params: URLSearchParams): string | null {
  if (!["/", "/library", "/notes", "/tasks", "/memos", ...taskTools].includes(pathname)) return null;
  const next = new URLSearchParams(params);
  next.delete("task");
  if (pathname === "/tasks" && !next.get("scope")) next.set("scope", "all");
  const query = next.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

export function readMobileLocations(raw: string | null): MobileLocations {
  try {
    const input: unknown = JSON.parse(raw || "{}");
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const result: MobileLocations = {};
    for (const { key } of MOBILE_DESTINATIONS) {
      const value = (input as Record<string, unknown>)[key];
      if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) continue;
      const url = new URL(value, "https://organize.invalid");
      if (url.origin !== "https://organize.invalid" || mobileRoute(url.pathname).section !== key) continue;
      const location = collectionLocation(url.pathname, url.searchParams);
      if (location) result[key] = location;
    }
    return result;
  } catch { return {}; }
}

/** Pinch zoom and browser chrome are not a software keyboard. */
export function mobileKeyboardOpen(layoutHeight: number, viewportHeight: number, offsetTop: number, scale: number, editing: boolean) {
  return editing && Math.abs(scale - 1) < 0.05 && layoutHeight - viewportHeight - offsetTop > 120;
}
