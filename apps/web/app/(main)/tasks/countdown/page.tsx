"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Loader2, Pencil, Plus, Repeat2, Trash2 } from "@/components/icons";
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
import { PageHeader } from "@/components/layout/page-header";
import { PageSearch } from "@/components/layout/page-search";
import { filterByPageSearch } from "@/lib/search/page-search";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";
import { isOnline } from "@/lib/offline/network";
import { mutateTrash } from "@/lib/trash/client";
import type { CountdownDay } from "@organize/shared";
import {
  countdownDisplay,
  formatCountdownDate,
  nextCountdownDaysAfterLoad,
  sortCountdownDays,
} from "@/lib/tasks/countdown";

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
  /** 上次成功快照的引用读取：loadDays 闭包里取 previous，避免把 days 加进 deps 经 useEffect 造成重载循环 */
  const daysRef = useRef<CountdownDay[]>([]);
  /** 倒数日查询失败（在线时）：没有已加载的列表时显示错误 + 重试，而不是「还没有倒数日」 */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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
      const plan = nextCountdownDaysAfterLoad({ previous: daysRef.current, data: data as CountdownDay[] | null, error: null });
      daysRef.current = plan.days;
      setDays(plan.days);
      setLoadError(plan.loadError);
    } catch (error) {
      // 查询失败不得清掉旧列表（谎报「还没有倒数日」）：纯函数保留上次成功快照并产出错误文案；
      // 离线时的失败是预期行为，由顶栏离线角标表达，不另弹 toast
      const plan = nextCountdownDaysAfterLoad({ previous: daysRef.current, data: null, error });
      daysRef.current = plan.days;
      setDays(plan.days);
      setLoadError(plan.loadError);
      if (plan.loadError && isOnline()) {
        toast({ title: "倒数日加载失败", description: plan.loadError, variant: "destructive" });
      }
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
  // 倒数日只有标题（无标签），页内搜索匹配标题
  const visibleDays = useMemo(
    () => filterByPageSearch(sorted, search, (item) => ({ title: item.title })),
    [sorted, search]
  );
  return (
    <section className="w-full space-y-4 sm:space-y-6">
      <PageHeader
        icon={CalendarDays}
        title="倒数日"
        search={
          <PageSearch
            value={search}
            onChange={setSearch}
            placeholder="搜索倒数日（标题）"
          />
        }
        actions={<Button type="button" onClick={openCreate}><Plus className="mr-2 h-4 w-4" />添加倒数日</Button>}
      />
      {loading ? (
        <div className="grid place-items-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : loadError && days.length === 0 ? (
        <EmptyState icon={CalendarDays} title="倒数日加载失败" description={loadError} action={<Button variant="outline" onClick={() => void loadDays()}>重试</Button>} />
      ) : visibleDays.length === 0 ? (
        <EmptyState icon={CalendarDays} title={search.trim() ? "没有匹配的倒数日" : "还没有倒数日"} description={search.trim() ? "只搜本页的倒数日标题，换个关键词试试" : "添加一个重要日期，随时掌握剩余时间"} action={<Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />添加倒数日</Button>} />
      ) : (
        <>
          {/* toast 会消失：保留旧列表时加载失败要有持久的行内提示 + 就地重试（与 tags 页 countsFailed 同款） */}
          {loadError && (
            <div
              className="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2"
              role="alert"
            >
              <p className="text-xs text-destructive">倒数日加载失败</p>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => void loadDays()}>
                重试
              </Button>
            </div>
          )}
          <div className="mt-4 divide-y border-y">
          {visibleDays.map((item) => {
            const display = countdownDisplay(item);
            return (
              <article key={item.id} className="group flex min-h-14 items-center gap-3 px-2 py-2 transition-colors duration-100 motion-reduce:duration-0 hover:bg-accent/50 sm:px-3">
                <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-medium">{item.title}</h2>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>{formatCountdownDate(item.target_date)}</span>
                    {item.repeat_annually && <span className="inline-flex items-center gap-1"><Repeat2 className="h-3.5 w-3.5" />每年重复</span>}
                    {item.repeat_annually && display.occurrenceDate !== item.target_date && <span>本年度日期：{formatCountdownDate(display.occurrenceDate)}</span>}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                  {display.label === "今天" ? "今天" : `${display.label} ${display.days} 天`}
                </span>
                <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" aria-label={`编辑${item.title}`} onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" aria-label={`删除${item.title}`} onClick={() => void remove(item)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </article>
            );
          })}
          </div>
        </>
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
