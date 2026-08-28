"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createNewNote } from "@/lib/notes/create-note";
import { useOpenTabsStore } from "@/lib/notes/open-tabs-store";
import { cn } from "@/lib/utils";

const NOTE_ID_RE = /^\/notes\/([^/]+)/;

/**
 * 桌面端顶部笔记标签页条（Chrome 式）：
 * - 访问 /notes/[id] 自动开标签，标题/图标由笔记页经 organize:note-tab 事件回填
 * - 点标签切换、X 或中键关闭，关闭当前标签后聚焦左侧邻位（无则右侧/回列表）
 * - 右侧「+」新建笔记；标签持久化，刷新后恢复
 */
export function NoteTabsBar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const tabs = useOpenTabsStore((state) => state.tabs);
  const openTab = useOpenTabsStore((state) => state.openTab);
  const updateMeta = useOpenTabsStore((state) => state.updateMeta);
  const removeTab = useOpenTabsStore((state) => state.removeTab);
  const forgetNote = useOpenTabsStore((state) => state.forgetNote);

  // zustand persist 在客户端挂载后才回放 localStorage，先渲染空条避免 SSR 水合不一致
  const [mounted, setMounted] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const activeId = pathname.match(NOTE_ID_RE)?.[1] ?? null;

  // 路由进入某篇笔记 → 确保它有标签页（标题先占位，笔记页加载后事件回填）
  useEffect(() => {
    if (!activeId) return;
    openTab({ id: activeId, title: "", icon: null });
  }, [activeId, openTab]);

  // 笔记页加载/标题变更 → 回填标签页与最近列表的展示
  useEffect(() => {
    const handleMeta = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; title: string; icon: string | null }>).detail;
      if (detail?.id) updateMeta({ id: detail.id, title: detail.title, icon: detail.icon });
    };
    window.addEventListener("organize:note-tab", handleMeta);
    return () => window.removeEventListener("organize:note-tab", handleMeta);
  }, [updateMeta]);

  // 笔记被删除/移入垃圾箱 → 从标签页与最近列表中移除
  useEffect(() => {
    const handleRemove = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (id) forgetNote(id);
    };
    window.addEventListener("organize:note-tab-remove", handleRemove);
    return () => window.removeEventListener("organize:note-tab-remove", handleRemove);
  }, [forgetNote]);

  const closeTab = (id: string) => {
    // 关的是当前标签才做导航；关后台标签保持原地（Chrome 行为）
    if (id !== activeId) {
      removeTab(id);
      return;
    }
    const neighborId = removeTab(id);
    router.push(neighborId ? `/notes/${neighborId}` : "/notes");
  };

  const handleNewNote = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const note = await createNewNote(supabase);
      if (note) {
        window.dispatchEvent(new CustomEvent("organize:notes-changed"));
        router.push(`/notes/${note.id}`);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="note-tabs-bar sticky top-0 z-50 hidden h-10 items-end gap-1 border-b bg-background px-2 md:flex">
      <div className="flex shrink-0 items-center gap-0.5 pb-1.5">
        <button
          type="button"
          onClick={() => router.back()}
          title="后退"
          aria-label="后退"
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => router.forward()}
          title="前进"
          aria-label="前进"
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div className="note-tabs-scroll flex min-w-0 flex-1 items-end gap-1 overflow-x-auto px-1">
        {mounted &&
          tabs.map((tab) => {
            const active = tab.id === activeId;
            return (
              <div
                key={tab.id}
                onAuxClick={(event) => {
                  // 中键点标签任意位置即关闭（Chrome 行为），并拦截浏览器「新窗口打开」
                  event.preventDefault();
                  closeTab(tab.id);
                }}
                className={cn(
                  "note-tab group/tab relative flex h-8 max-w-[200px] min-w-[100px] shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 text-xs",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <Link
                  href={`/notes/${tab.id}`}
                  className="flex min-w-0 flex-1 items-center gap-1.5"
                  title={tab.title || "无标题笔记"}
                >
                  <span className="shrink-0 text-[13px] leading-none">
                    {tab.icon || <FileText className="h-3.5 w-3.5" />}
                  </span>
                  <span className="truncate">{tab.title || "无标题笔记"}</span>
                </Link>
                <button
                  type="button"
                  title="关闭标签页"
                  aria-label={`关闭 ${tab.title || "无标题笔记"}`}
                  onClick={() => closeTab(tab.id)}
                  className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-background/80 hover:text-foreground",
                    active ? "opacity-90" : "opacity-0 group-hover/tab:opacity-100"
                  )}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
      </div>

      <button
        type="button"
        onClick={() => void handleNewNote()}
        title="新建笔记标签页"
        aria-label="新建笔记标签页"
        disabled={creating}
        className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      </button>
    </div>
  );
}
