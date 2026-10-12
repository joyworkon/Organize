"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NoteGroup } from "@organize/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles } from "@/components/icons";
import { toast } from "@/hooks/use-toast";
import { useAiAvailability } from "@/hooks/use-ai-availability";
import { proposeGroupsLocally, type AutoGroupNote, type GroupProposal } from "@/lib/notes/auto-group";
import { createNoteGroup, moveNotesToGroup, normalizeGroupName, notifyNoteGroupsChanged } from "@/lib/notes/groups";
import { cn } from "@/lib/utils";

interface EditableProposal extends GroupProposal {
  accepted: boolean;
}

const NONE = "__none__";

/**
 * 自动分组预览：生成建议 → 用户逐组改名 / 采用或放弃 / 把笔记挪到别的建议组或移出 → 应用。
 * 应用时同名（忽略大小写）的已有分组直接复用，不重复建组。
 */
export function AutoGroupDialog({
  open,
  onOpenChange,
  notes,
  groups,
  membership,
  supabase,
  userId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: AutoGroupNote[];
  groups: NoteGroup[];
  membership: Map<string, string>;
  supabase: SupabaseClient;
  userId: string | null;
}) {
  const aiAvailable = useAiAvailability();
  const [onlyUngrouped, setOnlyUngrouped] = useState(true);
  const [phase, setPhase] = useState<"loading" | "preview" | "applying">("loading");
  const [source, setSource] = useState<"ai" | "local">("local");
  const [notice, setNotice] = useState<string | null>(null);
  const [proposals, setProposals] = useState<EditableProposal[]>([]);

  const scoped = useMemo(
    () => (onlyUngrouped ? notes.filter((n) => !membership.has(n.id)) : notes),
    [notes, membership, onlyUngrouped]
  );
  const titleOf = useMemo(() => new Map(notes.map((n) => [n.id, n.title?.trim() || "无标题笔记"])), [notes]);

  const generate = useCallback(async () => {
    setPhase("loading");
    setNotice(null);
    let result: GroupProposal[] | null = null;
    let from: "ai" | "local" = "local";
    if (aiAvailable !== false && scoped.length >= 2) {
      try {
        const res = await fetch("/api/notes/auto-group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: scoped.map((n) => ({ id: n.id, title: n.title, text: n.text.slice(0, 160) })) }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && Array.isArray(data?.groups)) {
          result = data.groups as GroupProposal[];
          from = "ai";
        } else if (data?.code !== "AI_UNAVAILABLE") {
          setNotice(`AI 分组没有成功（${data?.error || res.status}），已改用本地关键词分组。`);
        }
      } catch {
        setNotice("AI 分组请求失败，已改用本地关键词分组。");
      }
    }
    if (!result) result = proposeGroupsLocally(scoped);
    setSource(from);
    setProposals(result.map((p) => ({ ...p, accepted: true })));
    setPhase("preview");
  }, [aiAvailable, scoped]);

  useEffect(() => {
    if (open) void generate();
    // 只在打开、切换范围时生成：之后 AI 可用状态等变化不能覆盖用户已做的修改
    // （AI 状态未知时 generate 照样先试 AI 接口，未配置会返回 409 再走本地）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onlyUngrouped]);

  const moveNote = (noteId: string, toKey: string) => {
    setProposals((current) =>
      current.map((p) => {
        const without = p.noteIds.filter((id) => id !== noteId);
        return p.key === toKey ? { ...p, noteIds: [...without, noteId] } : { ...p, noteIds: without };
      })
    );
  };

  const acceptedCount = proposals.filter((p) => p.accepted && p.noteIds.length > 0 && normalizeGroupName(p.name)).length;

  const apply = async () => {
    if (!userId) return;
    setPhase("applying");
    try {
      const byName = new Map(groups.map((g) => [g.name.toLocaleLowerCase(), g.id]));
      let order = groups.length;
      let movedNotes = 0;
      for (const p of proposals) {
        const name = normalizeGroupName(p.name);
        if (!p.accepted || !name || p.noteIds.length === 0) continue;
        let groupId = byName.get(name.toLocaleLowerCase());
        if (!groupId) {
          const created = await createNoteGroup(supabase, userId, name, order++);
          groupId = created.id;
          byName.set(name.toLocaleLowerCase(), groupId);
        }
        await moveNotesToGroup(supabase, userId, p.noteIds, groupId);
        movedNotes += p.noteIds.length;
      }
      notifyNoteGroupsChanged();
      toast({ title: `已应用 ${acceptedCount} 个分组，整理了 ${movedNotes} 篇笔记` });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "应用分组失败", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      setPhase("preview");
    }
  };

  const unassigned = scoped.filter((n) => !proposals.some((p) => p.noteIds.includes(n.id)));

  return (
    <Dialog open={open} onOpenChange={(o) => phase !== "applying" && onOpenChange(o)}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            按内容自动分组
          </DialogTitle>
          <DialogDescription>
            {source === "ai" ? "由 AI 按主题生成的建议" : "按标签和标题关键词生成的建议（未配置 AI 时使用）"}
            ，确认前不会改动任何笔记。可以改名、取消某组，或把笔记挪到别的组。
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyUngrouped}
            onChange={(e) => setOnlyUngrouped(e.target.checked)}
            disabled={phase !== "preview"}
          />
          只整理还没有分组的笔记（{notes.filter((n) => !membership.has(n.id)).length} 篇）
        </label>
        {notice && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{notice}</p>}

        <div className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1" data-testid="auto-group-preview">
          {phase === "loading" ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在分析笔记内容…
            </div>
          ) : proposals.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              没有找到足够明显的共同主题。可以先给笔记打标签，或手动新建分组。
            </p>
          ) : (
            proposals.map((p, index) => (
              <section
                key={p.key}
                className={cn("rounded-lg border p-3 transition-opacity", !p.accepted && "opacity-50")}
                aria-label={`建议分组 ${index + 1}`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={p.accepted}
                    aria-label={`采用分组「${p.name}」`}
                    onChange={(e) =>
                      setProposals((cur) => cur.map((x) => (x.key === p.key ? { ...x, accepted: e.target.checked } : x)))
                    }
                  />
                  <Input
                    value={p.name}
                    aria-label="分组名称"
                    maxLength={40}
                    className="h-8 flex-1 font-medium"
                    onChange={(e) => setProposals((cur) => cur.map((x) => (x.key === p.key ? { ...x, name: e.target.value } : x)))}
                  />
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{p.reason}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{p.noteIds.length} 篇</span>
                </div>
                <ul className="mt-2 space-y-1">
                  {p.noteIds.map((id) => (
                    <li key={id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{titleOf.get(id)}</span>
                      <select
                        value={p.key}
                        aria-label={`调整「${titleOf.get(id)}」所在分组`}
                        onChange={(e) => moveNote(id, e.target.value)}
                        className="h-7 max-w-[10rem] shrink-0 rounded-md border bg-background px-1.5 text-xs"
                      >
                        {proposals.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.name || "（未命名）"}
                          </option>
                        ))}
                        <option value={NONE}>不分组</option>
                      </select>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
          {phase !== "loading" && proposals.length > 0 && unassigned.length > 0 && (
            <p className="px-1 text-xs text-muted-foreground">另有 {unassigned.length} 篇没有明显主题，保持未分组。</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => void generate()} disabled={phase !== "preview"}>
            重新生成
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={phase === "applying"}>
            取消
          </Button>
          <Button onClick={() => void apply()} disabled={phase !== "preview" || acceptedCount === 0}>
            {phase === "applying" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            应用 {acceptedCount} 个分组
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
