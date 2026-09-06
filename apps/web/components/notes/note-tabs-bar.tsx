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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { createNewNote, describeCreateNoteResult } from "@/lib/notes/create-note";
import { toast } from "@/hooks/use-toast";
import { useOpenTabsStore } from "@/lib/notes/open-tabs-store";
import { cn } from "@/lib/utils";

const NOTE_ID_RE = /^\/notes\/([^/]+)/;

/**
 * 桌面端顶部笔记标签页条（Chrome 式）：
 * - 仅在 /notes 与 /notes/[id] 显示，其他功能区不渲染（标签数据仍持久化，回到笔记区即恢复）
 * - 访问 /notes/[id] 自动开标签，标题/图标由笔记页经 organize:note-tab 事件回填
 * - 点标签切换、X 或中键关闭，关闭当前标签后聚焦左侧邻位（无则右侧/回列表）
 * - 右侧「+」新建笔记；标签持久化，刷新后恢复
 */
export function NoteTabsBar() {
  const pathname = usePathname();
  const isNotesRoute = pathname === "/notes" || pathname.startsWith("/notes/");
  const router = useRouter();
  const supabase = createClient();
  const tabs = useOpenTabsStore((state) => state.tabs);
  const openTab = useOpenTabsStore((state) => state.openTab);
  const updateMeta = useOpenTabsStore((state) => state.updateMeta);
  const removeTab = useOpenTabsStore((state) => state.removeTab);
  const forgetNote = useOpenTabsStore((state) => state.forgetNote);
  const moveTab = useOpenTabsStore((state) => state.moveTab);

  // zustand persist 在客户端挂载后才回放 localStorage，先渲染空条避免 SSR 水合不一致
  const [mounted, setMounted] = useState(false);
  const [creating, setCreating] = useState(false);
  // 拖拽排序进行中的标签 id（Chrome 式：悬停到目标标签上即实时换位）
  const [dragId, setDragId] = useState<string | null>(null);

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
      // N02：统一创建服务（离线入队返回 queued，客户端 id 即最终地址）
      const result = await createNewNote(supabase);
      if (result.status === "unauthenticated" || result.status === "failed") {
        toast({ title: describeCreateNoteResult(result), variant: "destructive" });
        return;
      }
      if (result.status === "queued") {
        toast({ title: describeCreateNoteResult(result) });
      }
      window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      router.push(`/notes/${result.noteId}`);
    } finally {
      setCreating(false);
    }
  };

  // 非笔记路由不渲染（hooks 已全部声明完毕，事件监听保持挂载以便回填 store）
  if (!isNotesRoute) return null;

  return (
    <>
    {/* 移动端：不显示整条 Chrome 式 tabs（§3），提供「已打开笔记 N」切换 sheet */}
    {mounted && tabs.length > 0 && (
      <div className="md:hidden">
      <NoteTabsSheet
        tabs={tabs}
        activeId={activeId}
        onSwitch={(id) => router.push(`/notes/${id}`)}
        onClose={(id) => closeTab(id)}
        onNew={() => void handleNewNote()}
        creating={creating}
      />
      </div>
    )}
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
                draggable
                onDragStart={(event) => {
                  setDragId(tab.id);
                  event.dataTransfer.effectAllowed = "move";
                  // Firefox 需要 setData 才会启动拖拽
                  event.dataTransfer.setData("text/plain", tab.id);
                }}
                onDragOver={(event) => {
                  if (!dragId || dragId === tab.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  moveTab(dragId, tab.id);
                }}
                onDrop={(event) => event.preventDefault()}
                onDragEnd={() => setDragId(null)}
                onAuxClick={(event) => {
                  // 中键点标签任意位置即关闭（Chrome 行为），并拦截浏览器「新窗口打开」
                  event.preventDefault();
                  closeTab(tab.id);
                }}
                className={cn(
                  "note-tab group/tab relative flex h-8 max-w-[200px] min-w-[100px] shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 text-xs",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  dragId === tab.id && "opacity-40"
                )}
              >
                <Link
                  href={`/notes/${tab.id}`}
                  draggable={false}
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
    </>
  );
}

/**
 * 移动端「已打开笔记 N」切换 sheet（D04 §3）：
 * 触发器固定在移动顶栏下方左侧；列出全部标签（当前高亮、可关闭），
 * 保留与桌面一致的切换/关闭/新建；Radix Dialog 自带 Esc / 遮罩关闭。
 */
function NoteTabsSheet({
  tabs,
  activeId,
  onSwitch,
  onClose,
  onNew,
  creating,
}: {
  tabs: Array<{ id: string; title: string; icon: string | null }>;
  activeId: string | null;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  creating: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed left-3 top-16 z-40 flex h-8 items-center gap-1.5 rounded-full border bg-card px-3 text-xs text-muted-foreground shadow-sm"
        aria-label={`已打开笔记 ${tabs.length}`}
      >
        <FileText className="h-3.5 w-3.5" />
        已打开笔记 {tabs.length}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" hideCloseButton>
          <DialogHeader>
            <DialogTitle className="text-base">已打开笔记 {tabs.length}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-1 overflow-y-auto">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border p-2 text-sm",
                  tab.id === activeId && "bg-accent text-accent-foreground"
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => {
                    onSwitch(tab.id);
                    setOpen(false);
                  }}
                >
                  {tab.icon ? <span aria-hidden="true">{tab.icon}</span> : <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{tab.title || "无标题笔记"}</span>
                  {tab.id === activeId && <span className="ml-auto shrink-0 text-xs text-muted-foreground">当前</span>}
                </button>
                <button
                  type="button"
                  aria-label={`关闭 ${tab.title || "无标题笔记"}`}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => onClose(tab.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <Button variant="outline" className="w-full" onClick={() => { setOpen(false); onNew(); }} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            新建笔记
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
