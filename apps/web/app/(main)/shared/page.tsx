"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Users, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSharedNotes, type SharedNoteItem } from "@/hooks/use-shared-notes";
import { collabRoleLabel } from "@/lib/collab/roles";

/**
 * 「与我共享」列表页（P5-02 卡 4）。
 *
 * 数据来自 useSharedNotes：非属主笔记经 064 RLS 直读（不需要专门的列表 RPC），
 * 我的角色逐条取 resource_role()。编辑器为 viewer 时只读、editor 可写
 * （notes/[id] 页内按角色切换保存 RPC）。
 */
export default function SharedNotesPage() {
  const router = useRouter();
  const { notes, loading, error, refresh } = useSharedNotes();
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((note) => (note.title || "").toLowerCase().includes(q));
  }, [notes, keyword]);

  const openNote = (note: SharedNoteItem) => {
    router.push(`/notes/${note.id}`);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
      <PageHeader
        title="与我共享"
        description="其他账号通过协作空间共享给你的笔记；viewer 只读，editor 可直接编辑保存。"
        icon={Users}
      />

      {notes.length > 0 && (
        <div className="mt-4 flex items-center gap-2">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索共享笔记…"
              className="pl-8"
            />
          </div>
        </div>
      )}

      <div className="mt-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="space-y-2 text-center py-10">
            <p className="text-sm text-destructive">{error}</p>
            <button className="text-sm text-primary hover:underline" onClick={() => void refresh()}>
              重试
            </button>
          </div>
        ) : notes.length === 0 ? (
          <EmptyState
            icon={Users}
            title="还没有人与你共享笔记"
            description="当其他账号把笔记授权给你所在的协作空间后，会出现在这里。"
          />
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">没有匹配「{keyword}」的共享笔记</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {filtered.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  onClick={() => openNote(note)}
                  className={cn(
                    "w-full rounded-lg border px-4 py-3 text-left transition-colors",
                    "hover:border-primary/40 hover:bg-accent/40"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {note.icon && <span className="text-base leading-none">{note.icon}</span>}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {note.title || "无标题"}
                    </span>
                    <Badge variant={note.myRole === "viewer" ? "secondary" : "outline"} className="shrink-0">
                      {collabRoleLabel(note.myRole)}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    来自 {note.ownerName || "协作者"}
                    {" · "}
                    更新于 {new Date(note.updatedAt).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
