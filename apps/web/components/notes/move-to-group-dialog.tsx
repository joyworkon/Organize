"use client";

import { useState } from "react";
import type { NoteGroup } from "@organize/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Layers, Plus } from "@/components/icons";
import { cn } from "@/lib/utils";

/** 「移到分组…」：列出已有分组 + 未分组，也可以就地新建一个分组并移入 */
export function MoveToGroupDialog({
  open,
  onOpenChange,
  noteTitle,
  groups,
  currentGroupId,
  onSelect,
  onCreateAndSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteTitle: string;
  groups: NoteGroup[];
  currentGroupId: string | null;
  onSelect: (groupId: string | null) => Promise<void> | void;
  onCreateAndSelect: (name: string) => Promise<void> | void;
}) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
      onOpenChange(false);
      setNewName("");
    } finally {
      setBusy(false);
    }
  };
  const options: Array<{ id: string | null; name: string }> = [...groups.map((g) => ({ id: g.id, name: g.name })), { id: null, name: "未分组" }];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>移到分组</DialogTitle>
          <DialogDescription className="truncate">「{noteTitle}」</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto" role="listbox" aria-label="选择分组">
          {options.map((option) => {
            const current = option.id === currentGroupId;
            return (
              <button
                key={option.id ?? "ungrouped"}
                type="button"
                role="option"
                aria-selected={current}
                disabled={busy}
                onClick={() => void run(() => onSelect(option.id))}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                  current && "bg-accent font-medium"
                )}
              >
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1 truncate">{option.name}</span>
                {current && <Check className="h-4 w-4" />}
              </button>
            );
          })}
        </div>
        <form
          className="flex items-center gap-2 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (newName.trim()) void run(() => onCreateAndSelect(newName));
          }}
        >
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新分组名称" aria-label="新分组名称" maxLength={40} />
          <Button type="submit" size="sm" disabled={busy || !newName.trim()} className="shrink-0 gap-1">
            <Plus className="h-3.5 w-3.5" />
            新建并移入
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
