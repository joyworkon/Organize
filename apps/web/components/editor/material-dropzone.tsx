"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { MaterialProcessorExtension, MaterialRequest } from "@organize/plugin-sdk";
import { usePluginStore } from "@/lib/plugin/store";
import { materialResultToNodes } from "@/lib/materials/document";
import { MATERIAL_ACCEPT, MAX_MATERIAL_TEXT, validateMaterialRequest } from "@/lib/materials/schema";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Upload, X } from "@/components/icons";
import { cn } from "@/lib/utils";

export function MaterialDropzone({ editor, insertFiles }: {
  editor: Editor;
  insertFiles: (files: File[], pos?: number) => Promise<void>;
}) {
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    setBusy(false);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [editor]);

  const run = async (nextFiles = files) => {
    if (pending.current || editor.isDestroyed || !editor.isEditable || !processor) return;
    const ctx = contexts.get(processor.pluginId);
    if (!ctx) return;
    setFiles(nextFiles);
    setError("");
    setStatus("");
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = { files: nextFiles, text, mode, signal: controller.signal };
      validateMaterialRequest(request);
      pending.current = controller;
      setBusy(true);
      timeout = setTimeout(() => controller.abort("timeout"), 280_000);
      const result = await processor.extension.handler(request, ctx);
      if (controller.signal.aborted || editor.isDestroyed) return;
      if (!editor.isEditable) throw new Error("笔记已变为只读，整理结果未插入");
      if (!usePluginStore.getState().activePlugins.has(processor.pluginId)) throw new Error("整理插件已停用，结果未插入");
      const sources = [...nextFiles.map((file) => file.name), ...(text.trim() ? ["粘贴的文字"] : [])];
      const nodes = materialResultToNodes(result, sources);
      // 使用完成时的文末位置，避免等待期间用户编辑造成旧光标位置漂移或覆盖选区。
      const inserted = editor.chain().command(({ tr }) => { closeHistory(tr); return true; })
        .insertContentAt(editor.state.doc.content.size, nodes).run();
      if (!inserted) throw new Error("结果插入失败，请重试");
      setStatus(`已将「${result.title}」追加到笔记，可在正文编辑或撤销。`);
      setFiles([]);
      setText("");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "整理失败，请重试");
      else if (controller.signal.reason === "timeout") setError("整理超时，请减少物料后重试");
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  };

  const cancel = () => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setStatus("已停止等待，结果不会插入笔记。");
  };

  return (
    <section
      aria-label="智能物料整理"
      className={cn("mb-5 rounded-lg border border-dashed px-4 py-3 transition-colors", dragging ? "border-primary bg-accent" : "border-border bg-muted/20")}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = busy || !processor ? "none" : "copy";
        setDragging(true);
      }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        if (busy || !processor) return;
        const dropped = Array.from(event.dataTransfer.files);
        if (dropped.length) void run(dropped);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">智能整理</span>
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">拖入图片提取文字，或放入物料自动整理</span>
        <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : "选项 / 粘贴文字"}</Button>
        <Button variant="outline" size="sm" disabled={busy || !processor} onClick={() => inputRef.current?.click()}>
          <Upload className="mr-1.5 h-3.5 w-3.5" />选择文件
        </Button>
        <input ref={inputRef} type="file" multiple accept={MATERIAL_ACCEPT} className="hidden" aria-label="选择待整理的文件" onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (selected.length) void run(selected);
        }} />
      </div>
      {!processor && <p className="mt-2 text-xs text-muted-foreground">请在<Link href="/plugins" className="underline">插件管理</Link>启用“智能物料整理”。</p>}
      {expanded && <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">处理方式
            <select aria-label="物料处理方式" className="rounded-md border bg-background px-2 py-1" value={mode} disabled={busy} onChange={(e) => setMode(e.target.value as MaterialRequest["mode"])}>
              <option value="organize">按内容整理</option><option value="extract">提取并排版（保留原文）</option>
            </select>
          </label>
          {processors.length > 1 && <label className="flex items-center gap-2">整理插件
            <select aria-label="整理插件" className="rounded-md border bg-background px-2 py-1" value={`${processor.pluginId}:${processor.extension.id}`} disabled={busy} onChange={(e) => setProcessorId(e.target.value)}>
              {processors.map((p) => <option key={`${p.pluginId}:${p.extension.id}`} value={`${p.pluginId}:${p.extension.id}`}>{p.name} · {p.extension.label}</option>)}
            </select>
          </label>}
        </div>
        <textarea aria-label="待整理的文字" placeholder="也可以粘贴会议记录、摘录或零散想法…" value={text} disabled={busy} maxLength={MAX_MATERIAL_TEXT} rows={3}
          className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files);
            if (pasted.length) { event.preventDefault(); void run(pasted); }
          }} />
        <p className="text-xs leading-relaxed text-muted-foreground">支持 PNG / JPEG / WebP / GIF、TXT / Markdown / CSV / JSON、MP3 / WAV / M4A / OGG / WebM。每次最多 6 个文件、合计 20MB；单图最多 8MB。PDF、Office 文档和视频请先转为图片或文本。</p>
        <p className="text-xs leading-relaxed text-muted-foreground">物料发送到<Link href="/settings" className="underline">设置中的 AI 服务</Link>，图片需要支持视觉的文本模型，录音需要转写模型。整理内容追加到正文，原文件不自动保存。</p>
        <Button size="sm" disabled={busy || !processor || (!text.trim() && !files.length)} onClick={() => void run()}>整理并插入笔记</Button>
      </div>}
      {files.length > 0 && <p className="mt-2 break-words text-xs text-muted-foreground">{files.map((file) => file.name).join("、")}</p>}
      {busy && <div role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在识别并整理，完成后追加到正文…<Button variant="ghost" size="sm" onClick={cancel}><X className="mr-1 h-3 w-3" />取消</Button></div>}
      {error && <div role="alert" className="mt-3 space-y-2"><p className="text-sm text-destructive">{error}</p><div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy || !processor} onClick={() => void run()}>重试整理</Button>
        {!!files.length && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void insertFiles(files, editor.state.doc.content.size); }}>作为普通附件插入</Button>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setFiles([]); setError(""); }}>{files.length ? "清除文件" : "关闭提示"}</Button>
      </div></div>}
      {status && <p role="status" className="mt-2 text-xs text-muted-foreground">{status}</p>}
    </section>
  );
}
