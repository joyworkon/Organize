"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeLinkUrl } from "@/lib/editor/link-url";

/** The parent keeps/maps the original selection while the URL field owns focus. */
export function LinkEditorForm({ href, onApply, onRemove, onCancel }: {
  href: string;
  onApply: (href: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(href);
  const [error, setError] = useState("");
  return <form className="organize-link-form" aria-label="编辑链接" onSubmit={(event) => {
    event.preventDefault();
    const normalized = normalizeLinkUrl(draft);
    if (!normalized) { setError("请输入有效链接，例如 https://example.com"); return; }
    onApply(normalized);
  }}>
    <label htmlFor={id}>链接地址</label>
    <Input id={id} autoFocus value={draft} placeholder="https://example.com" aria-invalid={!!error}
      aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => { setDraft(event.target.value); setError(""); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
        if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
      }} />
    {error && <p id={`${id}-error`} role="alert" className="text-destructive">{error}</p>}
    <div className="organize-link-actions">
      {href && <Button type="button" variant="ghost" size="sm" onClick={onRemove}>移除链接</Button>}
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>取消</Button>
      <Button type="submit" size="sm">应用</Button>
    </div>
  </form>;
}
