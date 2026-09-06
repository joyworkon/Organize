"use client";

// 速记（flomo 式碎片捕捉）：顶部大输入框 + 按日分组时间流 + #标签 筛选。
// 与 notes（成品笔记）区分：这里是随手记，可一键转为正式笔记。
//
// F01：所有提交快捷键经 isImeComposing 守卫（中文选字 Enter 不误提交）；
//      触屏设备 Enter 换行，保存走明确按钮。F02：输入即存本机草稿（按用户+入口），
//      保存成功只清空被确认的那个版本（提交期间续写不丢）；离线创建走
//      memo-queue（客户端稳定 id，服务端幂等合同）联网后自动回放。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { parseMemoTags } from "@/lib/memos/tags";
import { clearMemoDraft, loadMemoDraft, saveMemoDraft } from "@/lib/memos/draft";
import {
  enqueueMemoCreate,
  makeMemoCreateOp,
  replayMemoCreates,
} from "@/lib/offline/memo-queue";
import { isImeComposing } from "@/lib/input/submit-guard";
import { isNetworkSaveError } from "@/lib/offline/note-sync";
import { isOnline, onNetworkChange } from "@/lib/offline/network";
import { emitDataChanged, subscribeDataChanged } from "@/lib/desktop/notch";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Memo } from "@organize/shared";
import { Feather, Loader2, Pencil, FileText, Trash2 } from "lucide-react";

const MEMO_MAX_LENGTH = 5000;

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
  const [loadError, setLoadError] = useState(false);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  // F02：草稿按 用户+入口 隔离；userId 到位后恢复一次
  const [userId, setUserId] = useState<string | null>(null);
  const [coarsePointer, setCoarsePointer] = useState(false);
  const inputRef = useRef("");
  const draftRestoredRef = useRef(false);

  inputRef.current = input;

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
    });
    // F01：触屏设备 Enter 用于换行（保存按钮始终可见）；桌面 Enter 保存
    setCoarsePointer(window.matchMedia("(pointer: coarse)").matches);
  }, [supabase]);

  // F02：恢复本机草稿（只恢复一次；用户已开始输入时不覆盖）
  useEffect(() => {
    if (!userId || draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    const draft = loadMemoDraft(localStorage, userId, "main");
    if (draft && !inputRef.current) setInput(draft);
  }, [userId]);

  const updateInput = useCallback(
    (value: string) => {
      setInput(value);
      if (userId) saveMemoDraft(localStorage, userId, "main", value);
    },
    [userId]
  );

  /** 仅当当前输入仍是被确认保存的版本时才清空（保存期间续写的内容保留） */
  const clearInputIfSame = useCallback(
    (submitted: string) => {
      if (inputRef.current !== submitted) return;
      setInput("");
      if (userId) clearMemoDraft(localStorage, userId, "main");
    },
    [userId]
  );

  // R11：速记 → 关联笔记状态（memo_notes join notes 含软删，用于状态展示）
  const [conversions, setConversions] = useState<
    Map<string, { noteId: string; noteTitle: string | null; noteDeleted: boolean }>
  >(new Map());

  const loadConversions = useCallback(async () => {
    try {
      // 两次普通查询（不依赖关联嵌入 select；mock 与真实后端行为一致）
      const { data: links } = await supabase
        .from("memo_notes")
        .select("memo_id, note_id");
      const noteIds = ((links || []) as Array<{ note_id: string }>).map((l) => l.note_id);
      const notesById = new Map<string, { title: string | null; deleted_at: string | null }>();
      if (noteIds.length > 0) {
        const { data: linkedNotes } = await supabase
          .from("notes")
          .select("id, title, deleted_at")
          .in("id", noteIds);
        for (const n of (linkedNotes || []) as Array<{ id: string; title: string | null; deleted_at: string | null }>) {
          notesById.set(n.id, { title: n.title, deleted_at: n.deleted_at });
        }
      }
      const next = new Map<string, { noteId: string; noteTitle: string | null; noteDeleted: boolean }>();
      for (const link of (links || []) as Array<{ memo_id: string; note_id: string }>) {
        const note = notesById.get(link.note_id);
        next.set(link.memo_id, {
          noteId: link.note_id,
          noteTitle: note?.title ?? null,
          noteDeleted: note?.deleted_at != null,
        });
      }
      setConversions(next);
    } catch (e) {
      console.error("[loadConversions]", e);
    }
  }, [supabase]);

  const fetchMemos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/memos", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setMemos((await res.json()) as Memo[]);
      setLoadError(false);
    } catch {
      // F03：失败保留旧列表并显式报错，不把失败渲染成「还没有速记」
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMemosRef = useRef<(() => void) | null>(null);
  fetchMemosRef.current = fetchMemos;

  // F02：联网时回放离线创建队列（挂载 + 恢复在线时）
  const replayOfflineCreates = useCallback(async () => {
    if (!userId || !isOnline()) return;
    const result = await replayMemoCreates(
      {
        createMemo: async (memo) => {
          const res = await fetch("/api/memos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(memo),
          });
          // 5xx 保留重试；4xx 业务拒绝丢弃
          return { ok: res.ok, retryable: res.status >= 500 };
        },
      },
      userId,
      localStorage
    );
    if (result.applied > 0) void fetchMemosRef.current?.();
  }, [userId]);

  useEffect(() => {
    const off = onNetworkChange((online) => {
      if (online) void replayOfflineCreates();
    });
    void replayOfflineCreates();
    return off;
  }, [replayOfflineCreates]);

  // K03：刘海面板新增/编辑速记后，主窗口列表即时跟随（忽略自己发的广播）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void subscribeDataChanged((payload) => {
      if (payload.origin !== "notch-panel") return;
      if (payload.topic === "memos") void fetchMemosRef.current?.();
    }).then((off) => { unlisten = off; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    fetchMemos();
    void loadConversions();
  }, [fetchMemos, loadConversions]);

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

  /** F01/F02：统一提交入口——稳定 id、提交互斥、离线入队、版本化清空 */
  const handleSave = async () => {
    const rawInput = inputRef.current;
    const content = rawInput.trim();
    if (!content || saving) return;
    if (content.length > MEMO_MAX_LENGTH) {
      toast({
        title: "内容超出长度限制",
        description: `速记最多 ${MEMO_MAX_LENGTH} 字，当前 ${content.length} 字`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    // 客户端生成稳定 id：重复提交/离线回放均由服务端主键幂等去重
    const memoId = crypto.randomUUID();
    const optimistic: Memo = {
      id: memoId,
      user_id: userId ?? "",
      content,
      tags: parseMemoTags(content),
      deleted_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as Memo;
    const offlineCreate = () => {
      const { persisted: ok } = enqueueMemoCreate(
        localStorage,
        userId ?? "",
        { op_id: crypto.randomUUID(), memo: { id: memoId, content }, created_at: Date.now() }
      );
      setMemos((prev) => [optimistic, ...prev]);
      clearInputIfSame(rawInput);
      toast(
        ok
          ? { title: "当前离线，已本地保存，联网后自动同步" }
          : { title: "本地存储不可用，离线创建可能丢失", variant: "destructive" }
      );
    };
    try {
      if (!isOnline()) {
        offlineCreate();
        return;
      }
      const res = await fetch("/api/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, id: memoId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const error = new Error(data?.error || "保存失败");
        // 网络类失败与断网同样入队回放；业务错误（如超长）保留输入现场
        if (isNetworkSaveError(error) || res.status >= 500) {
          offlineCreate();
          return;
        }
        throw error;
      }
      const memo = (await res.json()) as Memo;
      setMemos((prev) => [memo, ...prev.filter((m) => m.id !== memoId)]);
      clearInputIfSame(rawInput);
      void emitDataChanged({ topic: "memos", origin: "main" });
    } catch (error) {
      if (isNetworkSaveError(error)) {
        offlineCreate();
        return;
      }
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
    if (!content || editSaving) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/memos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const updated = (await res.json()) as Memo;
        setMemos((prev) => prev.map((m) => (m.id === id ? updated : m)));
        setEditingId(null);
        void emitDataChanged({ topic: "memos", origin: "main" });
      } else {
        const data = await res.json().catch(() => null);
        toast({
          title: "编辑失败",
          description: data?.error || "请稍后重试，输入已保留",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "编辑失败", description: "网络异常，输入已保留", variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("删除这条速记？")) return;
    try {
      const res = await fetch(`/api/memos/${id}`, { method: "DELETE" });
      if (res.ok) {
        setMemos((prev) => prev.filter((m) => m.id !== id));
        void emitDataChanged({ topic: "memos", origin: "main" });
        toast({ title: "已删除" });
      } else {
        toast({ title: "删除失败", variant: "destructive" });
      }
    } catch {
      toast({ title: "删除失败", description: "网络异常，请稍后重试", variant: "destructive" });
    }
  };

  // R11 转为笔记：服务端单事务（笔记+关联+标签映射），幂等——已转换过=打开既有笔记
  const handleConvert = async (memo: Memo) => {
    if (convertingId) return;
    setConvertingId(memo.id);
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc("convert_memo_to_note", {
        p_memo_id: memo.id,
      });
      if (rpcError) throw rpcError;
      const result = rpcData as { status?: string; note_id?: string } | null;
      if (result?.status === "not_found") {
        toast({ title: "速记不存在或已删除", variant: "destructive" });
        return;
      }
      if (!result?.note_id) {
        toast({ title: "转为笔记失败", variant: "destructive" });
        return;
      }
      window.dispatchEvent(new CustomEvent("organize:notes-changed"));
      toast({
        title: result.status === "exists" ? "已打开关联笔记" : "已转为笔记，速记保留原处",
      });
      void loadConversions();
      router.push(`/notes/${result.note_id}`);
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

      {/* 输入区：桌面 Enter / Cmd+Ctrl+Enter 保存，Shift+Enter 与触屏 Enter 换行 */}
      <div className="rounded-lg border bg-card p-3 shadow-sm focus-within:ring-1 focus-within:ring-primary">
        <textarea
          value={input}
          onChange={(e) => updateInput(e.target.value)}
          onKeyDown={(e) => {
            // F01：输入法组合态（中文选字）的 Enter 不作提交
            if (isImeComposing(e)) return;
            if (e.key === "Enter") {
              const submit = !e.shiftKey && (e.metaKey || e.ctrlKey || !coarsePointer);
              if (!submit) return; // Shift+Enter / 触屏 Enter：换行
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
          <div className="flex items-center gap-2">
            {/* F03：服务端 5,000 字限制的前端计数提示 */}
            {input.length > MEMO_MAX_LENGTH * 0.9 && (
              <span
                className={cn(
                  "text-[11px]",
                  input.length > MEMO_MAX_LENGTH ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {input.length}/{MEMO_MAX_LENGTH}
              </span>
            )}
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={!input.trim() || saving || input.length > MEMO_MAX_LENGTH}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存"}
            </Button>
          </div>
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

      {loadError && memos.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
          <span className="text-xs text-destructive">刷新失败，当前显示的是上次内容</span>
          <Button size="sm" variant="ghost" onClick={() => void fetchMemos()}>重试</Button>
        </div>
      )}
      {loading && memos.length === 0 ? (
        <div className="space-y-2" aria-busy="true" aria-label="速记加载中">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      ) : loadError && memos.length === 0 ? (
        <EmptyState
          icon={Feather}
          title="速记加载失败"
          description="网络或服务暂时不可用，之前的列表不会因此清空"
          action={
            <button type="button" className={cn(buttonVariants({ variant: "outline" }))} onClick={() => void fetchMemos()}>
              重试
            </button>
          }
        />
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
                            // F01：组合态 Enter 不提交
                            if (isImeComposing(e)) return;
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
                          <Button
                            size="sm"
                            onClick={() => void handleEditSave(memo.id)}
                            disabled={editSaving}
                          >
                            {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "保存"}
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
                          <div className="organize-touch-visible flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            {(() => {
                              const conversion = conversions.get(memo.id);
                              // R11：已关联笔记软删除 → 显示状态（恢复走垃圾箱；不默默当没转换过）
                              if (conversion?.noteDeleted) {
                                return (
                                  <span
                                    className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed px-2 text-xs text-muted-foreground"
                                    title="关联笔记已移入垃圾箱，可在垃圾箱恢复"
                                  >
                                    <FileText className="h-3 w-3" />
                                    关联笔记已删除
                                  </span>
                                );
                              }
                              if (conversion) {
                                return (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 gap-1 px-2 text-xs"
                                    onClick={() => router.push(`/notes/${conversion.noteId}`)}
                                    title="打开关联笔记"
                                  >
                                    <FileText className="h-3 w-3" />
                                    打开笔记
                                  </Button>
                                );
                              }
                              return (
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
                              );
                            })()}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => {
                                setEditingId(memo.id);
                                setEditContent(memo.content);
                              }}
                              title="编辑"
                              aria-label="编辑这条速记"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => void handleDelete(memo.id)}
                              title="删除"
                              aria-label="删除这条速记"
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
