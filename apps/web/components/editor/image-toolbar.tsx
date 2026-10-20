"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Copy, ExternalLink, Maximize2, MoreHorizontal, Upload } from "@/components/icons";
import { toast } from "@/hooks/use-toast";
import { IMAGE_PRESETS, currentPreset, presetWidth } from "./image-geometry";

export function ImageToolbar({ anchor, editable, width, maximum, alt, src, onChange, onReplace, onDelete, onView, onEditorKeyDown }: {
  anchor: RefObject<HTMLDivElement>; editable: boolean; width: number | null; maximum: number; alt: string; src: string;
  onChange: (attrs: { width?: number | null; alt?: string }) => void;
  onReplace: () => void; onDelete: () => void; onView: () => void; onEditorKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [visible, setVisible] = useState(false);
  const [editingAlt, setEditingAlt] = useState(false);
  const [draft, setDraft] = useState(alt);
  useLayoutEffect(() => {
    const element = toolbar.current, image = anchor.current;
    if (!element || !image) return;
    const update = () => {
      const rect = image.getBoundingClientRect(), bar = element.getBoundingClientRect();
      setVisible(rect.bottom > 0 && rect.top < window.innerHeight);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - bar.width - 8)), top: Math.max(8, Math.min(rect.top - bar.height - 8, window.innerHeight - bar.height - 8)) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(image); observer.observe(element);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [anchor]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(src); toast({ title: "图片链接已复制" }); }
    catch { toast({ title: "复制失败，请通过打开原图复制链接", variant: "destructive" }); }
  };
  // Stored content can come from pasted HTML; never turn a javascript URL into a link.
  let href: string | undefined;
  try {
    const url = new URL(src, document.baseURI);
    if (["http:", "https:", "blob:"].includes(url.protocol) || (url.protocol === "data:" && /^data:image\//i.test(src))) href = url.href;
  } catch { /* Invalid stored URLs remain copyable, but cannot navigate. */ }
  return createPortal(<div ref={toolbar} className="organize-image-toolbar" role="group" aria-label="图片工具栏"
    style={{ ...position, visibility: visible ? "visible" : "hidden" }} onKeyDown={onEditorKeyDown}
    onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    {editable && <>
      {IMAGE_PRESETS.map((preset) => <Button key={String(preset)} variant="ghost" size="sm" aria-pressed={currentPreset(width, maximum) === preset}
        onClick={() => onChange({ width: presetWidth(preset, maximum) })}>{preset === null ? "自适应" : `${preset}%`}</Button>)}
      <Popover open={editingAlt} onOpenChange={(open) => { if (open) setDraft(alt); setEditingAlt(open); }}>
        <PopoverTrigger asChild><Button variant="ghost" size="sm">替代文字</Button></PopoverTrigger>
        <PopoverContent className="organize-image-alt-popover" onMouseDown={(event) => event.stopPropagation()}>
          <form onSubmit={(event) => { event.preventDefault(); onChange({ alt: draft }); setEditingAlt(false); }}>
            <label htmlFor="organize-image-alt">替代文字</label>
            <Input id="organize-image-alt" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }} />
            <div className="mt-3 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditingAlt(false)}>取消</Button><Button type="submit">保存</Button></div>
          </form>
        </PopoverContent>
      </Popover>
      <Button variant="ghost" size="icon" aria-label="替换图片" title="替换图片" onClick={onReplace}><Upload className="h-4 w-4" /></Button>
    </>}
    <Button variant="ghost" size="icon" aria-label="查看大图" title="查看大图" onClick={onView}><Maximize2 className="h-4 w-4" /></Button>
    {!editable ? <>
      <Button variant="ghost" size="icon" aria-label="复制图片链接" title="复制图片链接" onClick={() => void copy()}><Copy className="h-4 w-4" /></Button>
      <a className="organize-image-open" href={href} target="_blank" rel="noopener noreferrer" aria-label="打开原图" title="打开原图"><ExternalLink className="h-4 w-4" /></a>
    </> : <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="更多图片操作" title="更多图片操作"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent className="organize-image-menu" onCloseAutoFocus={(event) => event.preventDefault()}>
        <DropdownMenuItem onSelect={() => void copy()}>复制图片链接</DropdownMenuItem>
        <DropdownMenuItem asChild><a href={href} target="_blank" rel="noopener noreferrer">打开原图</a></DropdownMenuItem>
        <DropdownMenuItem asChild><a href={href} download target="_blank" rel="noopener noreferrer">下载原图</a></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>删除图片</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>, document.body);
}
