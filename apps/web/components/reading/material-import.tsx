"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { MaterialProcessorExtension, MaterialRequest } from "@organize/plugin-sdk";
import { usePluginStore } from "@/lib/plugin/store";
import { collectReadingItem, type MaterialCollectInput } from "@/lib/reading/collect";
import { materialFingerprint } from "@/lib/materials/article";
import { MATERIAL_ACCEPT, MAX_MATERIAL_TEXT, validateMaterialRequest } from "@/lib/materials/schema";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Upload, X } from "@/components/icons";
import { cn } from "@/lib/utils";

type PreparedMaterial = { input: MaterialCollectInput; userId: string };

export function MaterialImport({ onAdded }: { onAdded: () => void }) {
  const activePlugins = usePluginStore((state) => state.activePlugins);
  const contexts = usePluginStore((state) => state.contexts);
  const processors = Array.from(activePlugins.values()).flatMap((plugin) =>
    plugin.extensions.filter((ext): ext is MaterialProcessorExtension => ext.type === "material-processor")
      .map((extension) => ({ pluginId: plugin.id, name: plugin.name, extension }))
  );
  const [processorId, setProcessorId] = useState("");
  const processor = processors.find((p) => `${p.pluginId}:${p.extension.id}` === processorId) ?? processors[0];
  const [mode, setMode] = useState<MaterialRequest["mode"]>("organize");
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [stage, setStage] = useState<"analyzing" | "saving" | null>(null);
  const [prepared, setPrepared] = useState<PreparedMaterial | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  const onAddedRef = useRef(onAdded);
  onAddedRef.current = onAdded;
  const busy = stage !== null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current?.abort(); pending.current = null; };
  }, []);

  const save = async (material: PreparedMaterial) => {
    if (saving.current || !mounted.current) return;
    saving.current = true;
    setStage("saving"); setError("");
    try {
      const saved = await collectReadingItem(material.input, { expectedUserId: material.userId });
      if (!mounted.current) return;
      if (saved.status === "error" || !saved.itemId) throw new Error(saved.message || "保存失败");
      setSavedId(saved.itemId);
      setStatus(saved.status === "duplicate" ? "这批物料已在稍后读中。" : `已将「${saved.title}」保存为未读条目。`);
      onAddedRef.current();
      if (saved.warning) setError(saved.warning);
      else { setPrepared(null); setFiles([]); setText(""); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "保存失败，请重试");
    } finally {
      saving.current = false;
      if (mounted.current) setStage(null);
    }
  };

  const run = async (nextFiles = files) => {
    if (pending.current || saving.current || !processor) return;
    const ctx = contexts.get(processor.pluginId);
    if (!ctx) return;
    setFiles(nextFiles); setPrepared(null); setError(""); setStatus(""); setSavedId(null);
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = { files: nextFiles, text, mode, signal: controller.signal };
      validateMaterialRequest(request);
      pending.current = controller; setStage("analyzing");
      timeout = setTimeout(() => controller.abort("timeout"), 280_000);
      const key = await materialFingerprint(request);
      if (controller.signal.aborted) return;
      const result = await processor.extension.handler(request, ctx);
      if (controller.signal.aborted || !mounted.current) return;
      if (!usePluginStore.getState().activePlugins.has(processor.pluginId)) throw new Error("整理插件已停用，结果未保存");
      const material: PreparedMaterial = { userId: ctx.userId, input: {
        kind: "material", key, result,
        sources: [...nextFiles.map((file) => file.name), ...(text.trim() ? ["粘贴的文字"] : [])],
      } };
      setPrepared(material); clearTimeout(timeout);
      await save(material);
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "整理失败，请重试");
      else if (mounted.current && controller.signal.reason === "timeout") setError("整理超时，请减少物料后重试");
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) { pending.current = null; if (mounted.current) setStage(null); }
    }
  };

  return (
    <section aria-label="稍后读物料整理"
      className={cn("rounded-lg border border-dashed px-4 py-3 transition-colors", dragging ? "border-primary bg-accent" : "border-border bg-muted/20")}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = busy || !processor ? "none" : "copy"; setDragging(true);
      }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault(); event.stopPropagation(); setDragging(false);
        if (busy || !processor) return;
        const dropped = Array.from(event.dataTransfer.files);
        if (dropped.length) void run(dropped);
      }}>
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">导入物料</span>
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">拖入图片、文本或录音，识别排版后存入稍后读</span>
        <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : "选项 / 粘贴文字"}</Button>
        <Button variant="outline" size="sm" disabled={busy || !processor} onClick={() => inputRef.current?.click()}><Upload className="mr-1.5 h-3.5 w-3.5" />选择文件</Button>
        <input ref={inputRef} type="file" multiple accept={MATERIAL_ACCEPT} className="hidden" aria-label="选择待整理的文件" onChange={(event) => {
          const selected = Array.from(event.target.files ?? []); event.target.value = "";
          if (selected.length) void run(selected);
        }} />
      </div>
      {!processor && <p className="mt-2 text-xs text-muted-foreground">请在<Link href="/plugins" className="underline">插件管理</Link>启用“智能物料整理”。</p>}
      {expanded && <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">处理方式
            <select aria-label="物料处理方式" className="rounded-md border bg-background px-2 py-1" value={mode} disabled={busy} onChange={(e) => setMode(e.target.value as MaterialRequest["mode"])}>
              <option value="organize">按内容整理并分类</option><option value="extract">提取并排版（保留原文）</option>
            </select>
          </label>
          {processors.length > 1 && <label className="flex items-center gap-2">整理插件
            <select aria-label="整理插件" className="rounded-md border bg-background px-2 py-1" value={`${processor.pluginId}:${processor.extension.id}`} disabled={busy} onChange={(e) => setProcessorId(e.target.value)}>
              {processors.map((p) => <option key={`${p.pluginId}:${p.extension.id}`} value={`${p.pluginId}:${p.extension.id}`}>{p.name} · {p.extension.label}</option>)}
            </select>
          </label>}
        </div>
        <textarea aria-label="待整理的文字" placeholder="粘贴摘录、会议记录，或在此粘贴截图…" value={text} disabled={busy} maxLength={MAX_MATERIAL_TEXT} rows={3}
          className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) => setText(event.target.value)} onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files);
            if (pasted.length) { event.preventDefault(); void run(pasted); }
          }} />
        <p className="text-xs leading-relaxed text-muted-foreground">支持 PNG / JPEG / WebP / GIF、TXT / Markdown / CSV / JSON、MP3 / WAV / M4A / OGG / WebM。每次最多 6 个文件、合计 20MB，单图最多 8MB。PDF、Office 文档和视频请先转为图片或文本。</p>
        <p className="text-xs leading-relaxed text-muted-foreground">物料发送到<Link href="/settings" className="underline">设置中的 AI 服务</Link>，图片需要视觉模型，录音需要转写模型。整理后生成一篇未读条目，并自动添加分类和主题标签；原文件不自动保存。</p>
        <Button size="sm" disabled={busy || !processor || (!text.trim() && !files.length)} onClick={() => void run()}>整理并存入稍后读</Button>
      </div>}
      {files.length > 0 && <p className="mt-2 break-words text-xs text-muted-foreground">{files.map((file) => file.name).join("、")}</p>}
      {busy && <div role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{stage === "saving" ? "正在保存到稍后读…" : "正在识别并整理…"}
        {stage === "analyzing" && <Button variant="ghost" size="sm" onClick={() => { pending.current?.abort(); pending.current = null; setStage(null); setStatus("已取消，未保存到稍后读。"); }}><X className="mr-1 h-3 w-3" />取消</Button>}
      </div>}
      {error && <div role="alert" className="mt-3 space-y-2"><p className="text-sm text-destructive">{error}</p><div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy || (!prepared && !processor)} onClick={() => { if (prepared) void save(prepared); else void run(); }}>{prepared ? "重试保存（无需重新识别）" : "重试整理"}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setFiles([]); setPrepared(null); setError(""); }}>关闭提示</Button>
      </div></div>}
      {status && <p role="status" className="mt-2 text-xs text-muted-foreground">{status}{savedId && <Link className="ml-2 underline" href={`/library/${savedId}`}>打开阅读</Link>}</p>}
    </section>
  );
}
