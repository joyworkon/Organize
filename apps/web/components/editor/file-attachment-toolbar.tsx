"use client";

import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Copy, Download, ExternalLink, MoreHorizontal, Upload } from "@/components/icons";
import { toast } from "@/hooks/use-toast";
import { attachmentHref, attachmentName, downloadAttachment } from "@/lib/editor/file-attachment";

export function FileAttachmentToolbar({ anchor, editable, name, src, onRename, onReplace, onDelete, onInteractionChange, onEditorKeyDown }: {
  anchor: RefObject<HTMLDivElement>; editable: boolean; name: string; src: string;
  onRename: (name: string) => void; onReplace: () => void; onDelete: () => void;
  onInteractionChange: (active: boolean, restoreFocus?: boolean) => void;
  onEditorKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [visible, setVisible] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [downloading, setDownloading] = useState(false);
  const refocus = useRef(false);
  // Radix close autofocus runs after the exit animation. An older popover must
  // not release the interaction lock or steal focus from a newly opened menu.
  const overlay = useRef<"rename" | "menu" | null>(null);
  const inputId = useId();
  useLayoutEffect(() => {
    const element = toolbar.current, block = anchor.current;
    if (!element || !block) return;
    const update = () => {
      const rect = block.getBoundingClientRect(), bar = element.getBoundingClientRect();
      setVisible(rect.bottom > 0 && rect.top < window.innerHeight);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - bar.width - 8)), top: Math.max(8, Math.min(rect.top - bar.height - 8, window.innerHeight - bar.height - 8)) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(block); observer.observe(element);
    window.addEventListener("scroll", update, true); window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [anchor]);
  const href = attachmentHref(src, document.baseURI);
  const copy = async () => {
    try { await navigator.clipboard.writeText(src); toast({ title: "附件链接已复制" }); }
    catch { toast({ title: "复制失败，请打开附件后复制链接", variant: "destructive" }); }
  };
  const download = async () => {
    if (!href || downloading) return;
    setDownloading(true);
    try { await downloadAttachment(href, name); }
    catch { toast({ title: "下载失败，请使用「打开附件」后保存文件", variant: "destructive" }); }
    finally { setDownloading(false); }
  };
  return createPortal(<div ref={toolbar} className="organize-image-toolbar organize-file-toolbar" role="group" aria-label="附件工具栏"
    style={{ ...position, visibility: visible ? "visible" : "hidden" }} onKeyDown={onEditorKeyDown}
    onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    {editable && <>
      <Popover open={renaming} onOpenChange={(open) => { if (open) { setDraft(name); refocus.current = false; overlay.current = "rename"; } setRenaming(open); if (open) onInteractionChange(true); }}>
        <PopoverTrigger asChild><Button variant="ghost" size="sm" aria-label="重命名附件">重命名</Button></PopoverTrigger>
        <PopoverContent className="organize-image-alt-popover" onMouseDown={(event) => event.stopPropagation()}
          onEscapeKeyDown={() => { refocus.current = true; }}
          onCloseAutoFocus={(event) => { event.preventDefault(); if (overlay.current === "rename") { overlay.current = null; onInteractionChange(false, refocus.current); } }}>
          <form onSubmit={(event) => { event.preventDefault(); onRename(attachmentName(draft)); refocus.current = true; setRenaming(false); }}>
            <label htmlFor={inputId}>附件名称</label>
            <Input id={inputId} value={draft} onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} />
            <div className="mt-3 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => { refocus.current = true; setRenaming(false); }}>取消</Button><Button type="submit">保存</Button></div>
          </form>
        </PopoverContent>
      </Popover>
      <Button variant="ghost" size="icon" aria-label="替换附件" title="替换附件" onClick={onReplace}><Upload className="h-4 w-4" /></Button>
    </>}
    <Button variant="ghost" size="icon" aria-label="打开附件" title="打开附件" disabled={!href} onClick={() => { if (href) window.open(href, "_blank", "noopener,noreferrer"); }}><ExternalLink className="h-4 w-4" /></Button>
    <Button variant="ghost" size="icon" aria-label="下载附件" title="下载附件" disabled={!href || downloading} onClick={() => void download()}><Download className="h-4 w-4" /></Button>
    <Button variant="ghost" size="icon" aria-label="复制附件链接" title="复制附件链接" onClick={() => void copy()}><Copy className="h-4 w-4" /></Button>
    {editable && <DropdownMenu onOpenChange={(open) => { if (open) { refocus.current = false; overlay.current = "menu"; onInteractionChange(true); } }}>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="更多附件操作" title="更多附件操作"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent className="organize-image-menu" onEscapeKeyDown={() => { refocus.current = true; }}
        onCloseAutoFocus={(event) => { event.preventDefault(); if (overlay.current === "menu") { overlay.current = null; onInteractionChange(false, refocus.current); } }}>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>删除附件</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>, document.body);
}
