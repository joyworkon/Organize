export type MobileSection = "home" | "library" | "notes" | "tasks" | "memos";

/** Collection fallbacks and remembered return locations, not a persistent bottom bar. */
export const MOBILE_DESTINATIONS = [
  { key: "home", href: "/", label: "首页" },
  // 阶段 C：稍后读 + 速记融合为「资料库」（/library；速记视图 ?view=memos）
  { key: "library", href: "/library", label: "资料库" },
  { key: "notes", href: "/notes", label: "笔记" },
  { key: "tasks", href: "/tasks?scope=all", label: "待办" },
  { key: "memos", href: "/library?view=memos", label: "速记" },
] as const;

const taskTools = new Set(["/tasks/calendar", "/tasks/countdown", "/tasks/lessons", "/tasks/search"]);

/** Explicit route boundaries keep tools out of the task-detail layout. */
export function mobileRoute(pathname: string, params = new URLSearchParams()) {
  let section: MobileSection | null = null;
  let title = "Cairn";
  let detail = false;
  if (pathname === "/") { section = "home"; title = "工作台"; }
  else if (pathname === "/library" && ["memos", "memo"].includes(params.get("view") || "")) {
    // 保留速记自己的返回位置；/memos 与 view=memo 是兼容入口。
    section = "memos"; title = "速记";
  } else if (pathname === "/library" || pathname.startsWith("/library/")) {
    section = "library"; title = params.get("view") === "collections" ? "集合" : params.get("view") === "files" ? "文件" : "资料库"; detail = pathname !== "/library";
  } else if (pathname === "/notes" || pathname.startsWith("/notes/")) {
    section = "notes"; title = "笔记"; detail = pathname !== "/notes";
  } else if (pathname === "/tasks" || pathname.startsWith("/tasks/")) {
    section = "tasks"; title = ({ "/tasks/calendar": "日历", "/tasks/countdown": "倒数日", "/tasks/lessons": "经验", "/tasks/search": "搜索待办" } as Record<string, string>)[pathname] || "待办";
    detail = (pathname !== "/tasks" && !taskTools.has(pathname)) || Boolean(params.get("task"));
  } else if (pathname === "/memos") { section = "memos"; title = "速记"; }
  else if (pathname === "/graph") { section = "notes"; title = "知识图谱"; }
  else if (pathname === "/canvas") { section = null; title = "构思画布"; }
  else if (pathname.startsWith("/canvas/")) {
    // 画布详情沿用自己的返回/缩放；不增加全局工具栏或更改画布布局。
    section = null; title = "构思画布"; detail = true;
  }
  else if (pathname === "/tags") { section = "library"; title = "标签管理"; }
  else if (pathname === "/lessons" || pathname.startsWith("/lessons/")) { section = "tasks"; title = "经验"; detail = pathname !== "/lessons"; }
  else {
    title = ({ "/favorites": "收藏夹", "/settings": "设置", "/plugins": "插件管理", "/trash": "垃圾箱", "/shared": "与我共享", "/spaces": "协作空间", "/share": "保存到 Cairn", "/review": "回顾", "/stats": "统计", "/inbox": "收集箱" } as Record<string, string>)[pathname] || "Cairn";
  }
  return { section, title, detail };
}

/** Calendar creation belongs to its visible date range; other actions use QuickAdd. */
export function mobileCreateAction(pathname: string, params = new URLSearchParams()): { mode: "menu" | "url" | "note" | "task" | "memo" | "calendar"; label: string } | null {
  if (pathname === "/canvas" || pathname.startsWith("/canvas/")) return null;
  const route = mobileRoute(pathname, params);
  if (route.section === "memos") return { mode: "memo", label: "新建速记" };
  if (route.section === "notes") return { mode: "note", label: "新建笔记" };
  if (pathname === "/tasks/calendar") return { mode: "calendar", label: "添加待办" };
  if (pathname === "/tasks") return { mode: "task", label: "添加待办" };
  if (pathname === "/library" && params.get("view") === "reading") return { mode: "url", label: "保存链接" };
  return { mode: "menu", label: "新建内容" };
}

export type MobileLocations = Partial<Record<MobileSection, string>>;
export const MOBILE_LOCATIONS_KEY = "organize:mobile-locations";

/** Only collection URLs may become return locations; never store open task IDs. */
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
      if (url.origin !== "https://organize.invalid" || mobileRoute(url.pathname, url.searchParams).section !== key) continue;
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
