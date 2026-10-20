"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getMarkRange, type Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import type { Fragment } from "@tiptap/pm/model";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { applicationLinkPath, normalizeLinkUrl } from "@/lib/editor/link-url";
import { internalLinkKeyFromHref, type InternalLinkStateRow } from "@/lib/note-links";
import { EditorPopover } from "./editor-popover";
import { LinkEditorForm } from "./link-editor-popover";
import type { EditorMenuPoint } from "./types";

interface LinkTarget {
  from: number;
  to: number;
  href: string;
  content: Fragment;
  point: EditorMenuPoint;
}

function linkAt(editor: Editor, pos: number): Omit<LinkTarget, "point"> | null {
  const range = getMarkRange(editor.state.doc.resolve(pos), editor.schema.marks.link);
  if (!range) return null;
  const href = editor.state.doc.resolve(range.from).nodeAfter?.marks.find((mark) => mark.type.name === "link")?.attrs.href;
  return typeof href === "string" ? { ...range, href, content: editor.state.doc.slice(range.from, range.to).content } : null;
}

/** One controller outside BubbleMenu: input focus cannot unmount the link editor. */
export function LinkHoverCard({ editor, editRequest, internalLinkStates, onNavigate }: {
  editor: Editor;
  editRequest: number;
  internalLinkStates: Record<string, InternalLinkStateRow>;
  onNavigate: (path: string) => void;
}) {
  const [target, setTarget] = useState<LinkTarget | null>(null);
  const [editing, setEditing] = useState(false);
  const [, refresh] = useState(0);
  const current = useRef<LinkTarget | null>(null);
  const editingRef = useRef(false);
  const statesRef = useRef(internalLinkStates);
  statesRef.current = internalLinkStates;
  const panel = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const clearTimers = useCallback(() => { clearTimeout(hoverTimer.current); clearTimeout(leaveTimer.current); }, []);
  const close = useCallback(() => {
    clearTimers(); current.current = null; editingRef.current = false; setTarget(null); setEditing(false);
  }, [clearTimers]);
  const show = useCallback((next: LinkTarget, edit = false) => {
    clearTimers(); current.current = next; editingRef.current = edit; setTarget(next); setEditing(edit);
  }, [clearTimers]);
  const linkState = (href: string) => {
    if (!applicationLinkPath(href, window.location.href)) return undefined;
    const key = internalLinkKeyFromHref(href);
    return key ? statesRef.current[key] : undefined;
  };
  const open = (href: string) => {
    const safe = normalizeLinkUrl(href);
    if (!safe || (linkState(href) && linkState(href)?.state !== "active")) return;
    const path = applicationLinkPath(safe, window.location.href);
    if (path) onNavigate(path);
    else window.open(safe, "_blank", "noopener,noreferrer");
  };
  // Stable callbacks for the native event subscription, with current permissions/metadata.
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const dom = editor.view.dom;
    const targetForAnchor = (element: EventTarget | null): LinkTarget | null => {
      const anchor = element instanceof Element ? element.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || !dom.contains(anchor)) return null;
      const range = linkAt(editor, editor.view.posAtDOM(anchor, 0));
      if (!range || range.href !== anchor.getAttribute("href")) return null;
      const rect = anchor.getBoundingClientRect();
      return { ...range, point: { left: rect.left, top: rect.bottom + 6, anchorTop: rect.top } };
    };
    const fromSelection = () => {
      if (editingRef.current) return;
      if (!editor.state.selection.empty || !editor.isFocused) { close(); return; }
      const range = linkAt(editor, editor.state.selection.from);
      if (!range) { close(); return; }
      const rect = editor.view.coordsAtPos(range.from);
      show({ ...range, point: { left: rect.left, top: rect.bottom + 6, anchorTop: rect.top } });
    };
    const over = (event: MouseEvent) => {
      if (editingRef.current) return;
      const next = targetForAnchor(event.target);
      if (!next) return;
      clearTimers();
      hoverTimer.current = setTimeout(() => {
        // Do not show a stale range after a remote edit during the hover delay.
        const fresh = targetForAnchor(event.target);
        if (fresh) show(fresh);
      }, 300);
    };
    const out = (event: MouseEvent) => {
      if (editingRef.current || panel.current?.contains(event.relatedTarget as Node)) return;
      clearTimers(); leaveTimer.current = setTimeout(close, 180);
    };
    const click = (event: MouseEvent) => {
      const next = targetForAnchor(event.target);
      if (!next) return;
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) { event.stopPropagation(); close(); openRef.current(next.href); }
      else show(next); // Native selection placement continues; readonly/touch gets the same card.
    };
    const permissionChange = () => {
      refresh((value) => value + 1);
      if (!editor.isEditable && editingRef.current) close();
    };
    const transaction = ({ transaction: tr }: { transaction: Transaction }) => {
      refresh((value) => value + 1); // setEditable also emits a transaction.
      if (!editor.isEditable && editingRef.current) { close(); return; }
      const previous = current.current;
      if (!previous || !tr.docChanged) return;
      const from = tr.mapping.map(previous.from, 1), to = tr.mapping.map(previous.to, -1);
      const range = previous.href ? linkAt(editor, from) : null;
      if (from >= to || !tr.doc.slice(from, to).content.eq(previous.content)
        || (previous.href && (!range || range.from !== from || range.to !== to || range.href !== previous.href))) {
        close(); return;
      }
      const next = { ...previous, from, to }; current.current = next; setTarget(next);
    };
    const focusOutside = (event: FocusEvent) => {
      if (!dom.contains(event.target as Node) && !panel.current?.contains(event.target as Node)
        && !(event.target instanceof Element && event.target.closest(".organize-link-popover"))) close();
    };
    dom.addEventListener("mouseover", over); dom.addEventListener("mouseout", out); dom.addEventListener("click", click, true);
    document.addEventListener("focusin", focusOutside);
    editor.on("selectionUpdate", fromSelection); editor.on("focus", fromSelection); editor.on("transaction", transaction); editor.on("update", permissionChange);
    return () => {
      clearTimers(); dom.removeEventListener("mouseover", over); dom.removeEventListener("mouseout", out); dom.removeEventListener("click", click, true);
      document.removeEventListener("focusin", focusOutside);
      editor.off("selectionUpdate", fromSelection); editor.off("focus", fromSelection); editor.off("transaction", transaction); editor.off("update", permissionChange);
    };
  }, [editor, show, close, clearTimers]);

  const lastRequest = useRef(editRequest);
  useEffect(() => {
    if (editRequest === lastRequest.current) return;
    lastRequest.current = editRequest;
    if (!editor.isEditable) return;
    const selection = editor.state.selection;
    const range = linkAt(editor, selection.from);
    if (selection.empty && !range) return;
    const rect = editor.view.coordsAtPos(selection.from);
    // For an existing link, always edit its entire mark, including bold/italic fragments.
    show({ ...(range ?? { from: selection.from, to: selection.to, href: "", content: editor.state.doc.slice(selection.from, selection.to).content }),
      point: { left: rect.left, top: rect.bottom + 6, anchorTop: rect.top } }, true);
  }, [editRequest, editor, show]);

  if (!target) return null;
  const row = linkState(target.href);
  const unavailable = !!row && row.state !== "active";
  const safe = normalizeLinkUrl(target.href);
  const cancelEdit = () => { close(); if (!editor.isDestroyed) editor.view.focus(); };
  const apply = (href: string | null) => {
    const latest = current.current;
    if (!latest || !editor.isEditable || editor.isDestroyed) { close(); return; }
    // Close before dispatch, so our transaction listener doesn't see our own mutation as a remote change.
    close();
    const chain = editor.chain().setTextSelection({ from: latest.from, to: latest.to });
    if (href) chain.setLink({ href }); else chain.unsetLink();
    chain.run(); editor.view.focus();
  };
  return <EditorPopover point={target.point} onClose={close} className="organize-link-popover">
    <div ref={panel} onMouseEnter={clearTimers} onMouseLeave={() => {
      if (!editingRef.current) { clearTimers(); leaveTimer.current = setTimeout(close, 180); }
    }} onMouseDown={(event) => { if (!editing) event.preventDefault(); }}>
      {editing && editor.isEditable ? <LinkEditorForm href={target.href} onApply={apply} onRemove={() => apply(null)} onCancel={cancelEdit} /> :
        <div role="group" aria-label="链接卡片" className="organize-link-hover-card">
          {row && <p className={unavailable ? "text-destructive" : "font-medium"}>{unavailable ? "链接目标不可用" : row.title || "未命名"}</p>}
          <p className="organize-link-address" title={target.href}>{target.href}</p>
          <div className="organize-link-actions">
            <Button type="button" variant="ghost" size="sm" disabled={!safe || unavailable} onClick={() => { open(target.href); close(); }}>打开</Button>
            <Button type="button" variant="ghost" size="sm" onClick={async () => {
              try { await navigator.clipboard.writeText(target.href); toast({ title: "链接已复制" }); }
              catch { toast({ title: "复制失败，请手动复制链接地址", variant: "destructive" }); }
            }}>复制链接</Button>
            {editor.isEditable && <>
              <Button type="button" variant="ghost" size="sm" onClick={() => show(target, true)}>编辑</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => apply(null)}>取消链接</Button>
            </>}
          </div>
        </div>}
    </div>
  </EditorPopover>;
}
