"use client";

// 速记（flomo 式碎片捕捉）：顶部大输入框 + 按日分组时间流 + #标签 筛选。
// 与 notes（成品笔记）区分：这里是随手记，可一键转为正式笔记。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { parseMemoTags } from "@/lib/memos/tags";
import { createNewNote } from "@/lib/notes/create-note";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Memo } from "@organize/shared";
import { Feather, Loader2, Pencil, FileText, Trash2 } from "lucide-react";

function dateLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(date)) / 86400000);
  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}

// 按 #标签 高亮渲染内容，点标签即筛选
function renderContent(content: string, onTagClick: (tag: string) => void) {
  return content.split(/(#[^\s#]+)/g).map((part, index) => {
    if (!part.startsWith("#")) return <span key={index}>{part}</span>;
    const tag = parseMemoTags(part)[0];
    return (
      <button
        key={index}
        type="button"
        onClick={() => tag && onTagClick(tag)}
        className="text-primary hover:underline"
      >
        {part}
      </button>
    );
  });
}

export default function MemosPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const fetchMemos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/memos", { cache: "no-store" });
      if (res.ok) setMemos((await res.json()) as Memo[]);
    } catch {
      // 静默：失败保留旧列表
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemos();
  }, [fetchMemos]);

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const memo of memos) {
      for (const tag of memo.tags || []) map.set(tag, (map.get(tag) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [memos]);

  const visible = useMemo(
    () => (filterTag ? memos.filter((m) => m.tags?.includes(filterTag)) : memos),
    [memos, filterTag]
  );

  const grouped = useMemo(() => {
    const groups: { label: string; items: Memo[] }[] = [];
    for (const memo of visible) {
      const label = dateLabel(memo.created_at);
      const last = groups[groups.length - 1];
      if (last?.label === label) last.items.push(memo);
      else groups.push({ label, items: [memo] });
    }
    return groups;
  }, [visible]);

  const inputTags = parseMemoTags(input);

  const handleSave = async () => {
    const content = input.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "保存失败");
      }
      const memo = (await res.json()) as Memo;
      setMemos((prev) => [memo, ...prev]);
      setInput("");
    } catch (error) {
      toast({
        title: "保存失败",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEditSave = async (id: string) => {
    const content = editContent.trim();
    if (!content) return;
    const res = await fetch(`/api/memos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      const updated = (await res.json()) as Memo;
      setMemos((prev) => prev.map((m) => (m.id === id ? updated : m)));
      setEditingId(null);
    } else {
      toast({ title: "编辑失败", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("删除这条速记？")) return;
    const res = await fetch(`/api/memos/${id}`, { method: "DELETE" });
    if (res.ok) {
      setMemos((prev) => prev.filter((m) => m.id !== id));
      toast({ title: "已删除" });
    } else {
      toast({ title: "删除失败", variant: "destructive" });
    }
  };

  // 转为笔记：新建笔记后把速记内容写成正文段落，跳转到编辑页继续加工
  const handleConvert = async (memo: Memo) => {
    if (convertingId) return;
    setConvertingId(memo.id);
    try {
      const note = await createNewNote(supabase);
      if (!note) {
        toast({ title: "请先登录", variant: "destructive" });
        return;
      }
      const paragraphs = memo.content
        .split(/\n+/)
        .filter(Boolean)
        .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] }));
      const { error } = await supabase
        .from("notes")
        .update({
          content: { type: "doc", content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph" }] },
        })
        .eq("id", note.id);
      if (error) throw error;
      window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      toast({ title: "已转为笔记，速记保留原处" });
      router.push(`/notes/${note.id}`);
    } catch (error) {
      toast({
        title: "转为笔记失败",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setConvertingId(null);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        icon={Feather}
        title="速记"
        description={`随手捕捉碎片想法，#标签 组织，共 ${memos.length} 条`}
      />

      {/* 输入区：默认聚焦，Enter 保存 / Shift+Enter 换行 */}
      <div className="rounded-lg border bg-card p-3 shadow-sm focus-within:ring-1 focus-within:ring-primary">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSave();
            }
          }}
          placeholder="记录此刻的想法…（#标签 标记主题，Enter 保存，Shift+Enter 换行）"
          rows={3}
          autoFocus
          className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
        />
        <div className="mt-1 flex items-center justify-between">
          <div className="flex flex-wrap items-center gap-1">
            {inputTags.map((tag) => (
              <span key={tag} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                #{tag}
              </span>
            ))}
          </div>
          <Button size="sm" onClick={() => void handleSave()} disabled={!input.trim() || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存"}
          </Button>
        </div>
      </div>

      {/* 标签筛选 */}
      {tagCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterTag(null)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs transition-colors",
              !filterTag
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            全部
          </button>
          {tagCounts.map(([tag, count]) => (
            <button
              key={tag}
              type="button"
              onClick={() => setFilterTag(filterTag === tag ? null : tag)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs transition-colors",
                filterTag === tag
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              #{tag}
              <span className="ml-1 opacity-70">{count}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="速记加载中">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Feather}
          title={filterTag ? `没有带 #${filterTag} 的速记` : "还没有速记"}
          description="想到什么就记下来，别让灵感溜走"
          action={
            filterTag ? (
              <button type="button" className={cn(buttonVariants({ variant: "outline" }))} onClick={() => setFilterTag(null)}>
                查看全部
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.label}>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">{group.label}</div>
              <div className="space-y-2">
                {group.items.map((memo) => (
                  <div key={memo.id} className="group rounded-lg border bg-card p-3 shadow-sm">
                    {editingId === memo.id ? (
                      <div>
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              void handleEditSave(memo.id);
                            }
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          rows={3}
                          autoFocus
                          className="w-full resize-none bg-transparent text-sm outline-none"
                        />
                        <div className="mt-1 flex justify-end gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                            取消
                          </Button>
                          <Button size="sm" onClick={() => void handleEditSave(memo.id)}>
                            保存
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                          {renderContent(memo.content, setFilterTag)}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between">
                          <span className="text-[11px] text-muted-foreground">
                            {new Date(memo.created_at).toLocaleTimeString("zh-CN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => void handleConvert(memo)}
                              disabled={convertingId === memo.id}
                              title="转为笔记"
                            >
                              {convertingId === memo.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <FileText className="h-3 w-3" />
                              )}
                              转为笔记
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => {
                                setEditingId(memo.id);
                                setEditContent(memo.content);
                              }}
                              title="编辑"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => void handleDelete(memo.id)}
                              title="删除"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
