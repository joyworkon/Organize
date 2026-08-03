"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, Pencil, Plus, Repeat2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { mutateTrash } from "@/lib/trash/client";
import type { CountdownDay } from "@organize/shared";
import { countdownDisplay, formatCountdownDate, sortCountdownDays } from "@/lib/tasks/countdown";

interface CountdownForm {
  title: string;
  target_date: string;
  repeat_annually: boolean;
}

function localDateInputValue(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const blankForm = (): CountdownForm => ({
  title: "",
  target_date: localDateInputValue(),
  repeat_annually: false,
});

function CountdownPageInner() {
  const supabase = useMemo(() => createClient(), []);
  const [days, setDays] = useState<CountdownDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CountdownDay | null>(null);
  const [form, setForm] = useState<CountdownForm>(blankForm);

  const loadDays = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("countdown_days")
        .select("*")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("target_date", { ascending: true });
      if (error) throw error;
      setDays((data || []) as CountdownDay[]);
    } catch (error) {
      toast({ title: "倒数日加载失败", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadDays();
    const reload = () => void loadDays();
    window.addEventListener("organize:countdown-changed", reload);
    return () => window.removeEventListener("organize:countdown-changed", reload);
  }, [loadDays]);

  const openCreate = () => {
    setEditing(null);
    setForm(blankForm());
    setDialogOpen(true);
  };
  const openEdit = (item: CountdownDay) => {
    setEditing(item);
    setForm({ title: item.title, target_date: item.target_date, repeat_annually: item.repeat_annually });
    setDialogOpen(true);
  };

  const save = async () => {
    const title = form.title.trim();
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(form.target_date)) {
      toast({ title: "请填写标题和有效日期", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("未登录");
      const payload = { title, target_date: form.target_date, repeat_annually: form.repeat_annually };
      const result = editing
        ? await supabase.from("countdown_days").update(payload).eq("id", editing.id)
        : await supabase.from("countdown_days").insert({ ...payload, user_id: user.id });
      if (result.error) throw result.error;
      setDialogOpen(false);
      await loadDays();
      toast({ title: editing ? "倒数日已更新" : "倒数日已添加" });
    } catch (error) {
      toast({ title: "保存失败", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: CountdownDay) => {
    if (!window.confirm(`将「${item.title}」移入垃圾箱？`)) return;
    try {
      if (process.env.NEXT_PUBLIC_MOCK_BACKEND === "true") {
        const result = await supabase.from("countdown_days").update({ deleted_at: new Date().toISOString() }).eq("id", item.id);
        if (result.error) throw result.error;
      } else {
        await mutateTrash("countdown", [item.id], "soft_delete");
      }
      await loadDays();
      toast({ title: "倒数日已移入垃圾箱" });
    } catch (error) {
      toast({ title: "删除失败", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const sorted = useMemo(() => sortCountdownDays(days), [days]);
  return (
    <section className="mx-auto min-h-[calc(100vh-11rem)] w-full max-w-4xl rounded-lg border bg-background p-5 md:min-h-[calc(100vh-6rem)] md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">倒数日</h1>
          <p className="mt-1 text-sm text-muted-foreground">记录重要日期，支持一次性和每年重复</p>
        </div>
        <Button type="button" onClick={openCreate}><Plus className="mr-2 h-4 w-4" />添加倒数日</Button>
      </header>
      {loading ? (
        <div className="grid place-items-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : sorted.length === 0 ? (
        <EmptyState icon={CalendarDays} title="还没有倒数日" description="添加一个重要日期，随时掌握剩余时间" action={<Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />添加倒数日</Button>} />
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {sorted.map((item) => {
            const display = countdownDisplay(item);
            return (
              <article key={item.id} className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarDays className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate font-medium">{item.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{formatCountdownDate(item.target_date)}{item.repeat_annually && <span className="ml-2 inline-flex items-center gap-1"><Repeat2 className="h-3.5 w-3.5" />每年</span>}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" aria-label={`编辑${item.title}`} onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label={`删除${item.title}`} onClick={() => void remove(item)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <p className="mt-5 text-xl font-semibold text-primary">
                  {display.label === "今天" ? "今天" : `${display.label} ${display.days} 天`}
                </p>
                {item.repeat_annually && display.occurrenceDate !== item.target_date && <p className="mt-1 text-xs text-muted-foreground">本年度日期：{formatCountdownDate(display.occurrenceDate)}</p>}
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑倒数日" : "添加倒数日"}</DialogTitle>
            <DialogDescription>日期按本地日期保存，不会因为时区转换而偏移。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block space-y-2 text-sm font-medium">标题<Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="例如：产品发布会" /></label>
            <label className="block space-y-2 text-sm font-medium">目标日期<Input type="date" value={form.target_date} onChange={(event) => setForm((current) => ({ ...current, target_date: event.target.value }))} /></label>
            <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={form.repeat_annually} onCheckedChange={(checked) => setForm((current) => ({ ...current, repeat_annually: checked === true }))} />每年重复</label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default function CountdownPage() {
  return (
    <Suspense fallback={<div className="grid h-40 place-items-center text-muted-foreground">加载中…</div>}>
      <CountdownPageInner />
    </Suspense>
  );
}
