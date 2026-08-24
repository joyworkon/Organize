"use client";

import { useEffect, useMemo, useState } from "react";
import { FilePlus2, LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import type {
  TaskCategory,
  TaskList,
  TaskPriority,
  TaskRecurrenceRule,
  TaskTemplate,
} from "@organize/shared";
import {
  TASK_CATEGORY_CONFIG,
  TASK_PRIORITY_CONFIG,
} from "@organize/shared";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  buildTaskFromTemplate,
  normalizeTaskTemplate,
  type TaskTemplateSnapshot,
} from "@/lib/tasks/templates";

interface TaskTemplatesDialogProps {
  lists: TaskList[];
  defaultListId: string | null;
  defaultDueDate: string | null;
  onCreated: (taskId: string) => Promise<void>;
}

interface TemplateForm extends TaskTemplateSnapshot {
  name: string;
  estimatedText: string;
}

const fieldClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";

function emptyForm(defaultListId: string | null): TemplateForm {
  return {
    ...normalizeTaskTemplate({ list_id: defaultListId }),
    name: "",
    title: "",
    estimatedText: "",
  };
}

export function TaskTemplatesDialog({
  lists,
  defaultListId,
  defaultDueDate,
  onCreated,
}: TaskTemplatesDialogProps) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>(() => emptyForm(defaultListId));

  const loadTemplates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("task_templates")
      .select("*")
      .order("updated_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast({ title: "读取模板失败", variant: "destructive" });
      return;
    }
    setTemplates((data || []) as TaskTemplate[]);
  };

  useEffect(() => {
    if (open) void loadTemplates();
    else {
      setEditingId(null);
      setDeleteId(null);
    }
    // 每次打开时刷新，避免详情页刚保存的模板缺失。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const beginEdit = (template: TaskTemplate) => {
    const snapshot = normalizeTaskTemplate(template.template, template.name);
    setForm({
      ...snapshot,
      name: template.name,
      estimatedText: snapshot.estimated_minutes?.toString() || "",
    });
    setEditingId(template.id);
    setDeleteId(null);
  };

  const beginNew = () => {
    setForm(emptyForm(defaultListId));
    setEditingId("new");
    setDeleteId(null);
  };

  const saveTemplate = async () => {
    const name = form.name.trim();
    const title = form.title.trim();
    if (!name || !title) {
      toast({ title: "请填写模板名称和任务标题", variant: "destructive" });
      return;
    }
    const snapshot = normalizeTaskTemplate({
      ...form,
      title,
      estimated_minutes: form.estimatedText,
    });
    setSaving(true);
    let result;
    if (editingId === "new") {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        setSaving(false);
        return;
      }
      result = await supabase.from("task_templates").insert({
        user_id: userData.user.id,
        name,
        template: snapshot,
      });
    } else {
      result = await supabase
        .from("task_templates")
        .update({ name, template: snapshot })
        .eq("id", editingId);
    }
    setSaving(false);
    if (result.error) {
      toast({ title: "模板保存失败", variant: "destructive" });
      return;
    }
    setEditingId(null);
    await loadTemplates();
    toast({ title: "模板已保存" });
  };

  const deleteTemplate = async (id: string) => {
    const { error } = await supabase.from("task_templates").delete().eq("id", id);
    if (error) {
      toast({ title: "删除模板失败", variant: "destructive" });
      return;
    }
    setDeleteId(null);
    setTemplates((items) => items.filter((item) => item.id !== id));
    toast({ title: "模板已删除" });
  };

  const applyTemplate = async (template: TaskTemplate) => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const snapshot = normalizeTaskTemplate(template.template, template.name);
    const templateListId = lists.some((list) => list.id === snapshot.list_id)
      ? snapshot.list_id
      : null;
    const listId = defaultListId || templateListId;
    const { data, error } = await supabase
      .from("tasks")
      .insert(
        buildTaskFromTemplate(snapshot, userData.user.id, {
          listId,
          dueDate: defaultDueDate,
        })
      )
      .select("id")
      .single();
    if (error || !data) {
      toast({ title: "套用模板失败", variant: "destructive" });
      return;
    }
    setOpen(false);
    await onCreated(data.id);
    toast({ title: "已从模板创建任务" });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="ml-auto inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted">
          <LayoutTemplate className="h-4 w-4" />
          模板
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>任务模板</DialogTitle>
          <DialogDescription>管理模板，或直接套用创建新任务。</DialogDescription>
        </DialogHeader>

        {editingId ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>模板名称</span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={fieldClass} />
            </label>
            <label className="space-y-1 text-sm">
              <span>任务标题</span>
              <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={fieldClass} />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span>描述</span>
              <textarea value={form.description || ""} onChange={(event) => setForm({ ...form, description: event.target.value || null })} className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </label>
            <label className="space-y-1 text-sm">
              <span>优先级</span>
              <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as TaskPriority })} className={fieldClass}>
                {Object.entries(TASK_PRIORITY_CONFIG).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>分类</span>
              <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as TaskCategory })} className={fieldClass}>
                {Object.entries(TASK_CATEGORY_CONFIG).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>清单</span>
              <select value={form.list_id || ""} onChange={(event) => setForm({ ...form, list_id: event.target.value || null })} className={fieldClass}>
                <option value="">未分类</option>
                {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>预计分钟</span>
              <input type="number" min="1" value={form.estimatedText} onChange={(event) => setForm({ ...form, estimatedText: event.target.value })} className={fieldClass} />
            </label>
            <label className="space-y-1 text-sm">
              <span>重复</span>
              <select
                value={form.recurrence_rule?.frequency || ""}
                onChange={(event) => setForm({
                  ...form,
                  recurrence_rule: event.target.value
                    ? { frequency: event.target.value as TaskRecurrenceRule["frequency"], interval: 1 }
                    : null,
                })}
                className={fieldClass}
              >
                <option value="">不重复</option>
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
                <option value="yearly">每年</option>
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={form.all_day} onChange={(event) => setForm({ ...form, all_day: event.target.checked })} />
              全天任务
            </label>
            <DialogFooter className="sm:col-span-2">
              <button type="button" onClick={() => setEditingId(null)} className="h-9 rounded-md border px-4 text-sm">取消</button>
              <button type="button" disabled={saving} onClick={() => void saveTemplate()} className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50">保存</button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="flex justify-end">
              <button type="button" onClick={beginNew} className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-sm hover:bg-muted">
                <Plus className="h-4 w-4" />新建模板
              </button>
            </div>
            <div className="max-h-[55vh] space-y-2 overflow-y-auto">
              {loading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
              ) : templates.length === 0 ? (
                <div className="grid place-items-center gap-2 rounded-lg border border-dashed py-10 text-muted-foreground">
                  <FilePlus2 className="h-7 w-7" />
                  <p className="text-sm">还没有任务模板</p>
                </div>
              ) : templates.map((template) => {
                const snapshot = normalizeTaskTemplate(template.template, template.name);
                return (
                  <div key={template.id} className="rounded-lg border p-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{template.name}</p>
                        <p className="truncate text-sm text-muted-foreground">{snapshot.title}</p>
                      </div>
                      <button type="button" onClick={() => beginEdit(template)} aria-label="编辑模板" className="rounded p-2 hover:bg-muted"><Pencil className="h-4 w-4" /></button>
                      <button type="button" onClick={() => setDeleteId(template.id)} aria-label="删除模板" className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                      <button type="button" onClick={() => void applyTemplate(template)} className="h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground">套用</button>
                    </div>
                    {deleteId === template.id && (
                      <div className="mt-3 flex items-center justify-end gap-2 border-t pt-3 text-sm">
                        <span className="mr-auto text-muted-foreground">确定删除这个模板？</span>
                        <button type="button" onClick={() => setDeleteId(null)} className="rounded-md border px-3 py-1.5">取消</button>
                        <button type="button" onClick={() => void deleteTemplate(template.id)} className="rounded-md bg-destructive px-3 py-1.5 text-destructive-foreground">删除</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
