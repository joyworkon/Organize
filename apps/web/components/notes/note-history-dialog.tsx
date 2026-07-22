"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { History, RotateCcw, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Version {
  id: string;
  title: string | null;
  message: string | null;
  created_at: string;
}

interface NoteHistoryDialogProps {
  noteId: string;
  triggerSize?: "icon" | "sm";
  iconOnly?: boolean;
  /** 受控状态（可选） */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function NoteHistoryDialog({
  noteId,
  triggerSize = "icon",
  iconOnly = true,
  open: openProp,
  onOpenChange,
}: NoteHistoryDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/notes/${noteId}/versions`, { cache: "no-store" });
      if (res.ok) setVersions(await res.json());
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    if (open) fetchVersions();
  }, [open, fetchVersions]);

  const handleRestore = async (vid: string) => {
    if (!confirm("恢复这个版本？当前内容会先自动保存为一个新版本（所以恢复也可撤销）。")) return;
    setRestoringId(vid);
    try {
      const res = await fetch(`/api/notes/${noteId}/versions/${vid}`, { method: "POST" });
      if (res.ok) {
        setOpen(false);
        // 跳到笔记页让用户看效果
        window.location.href = `/notes/${noteId}`;
      }
    } finally {
      setRestoringId(null);
    }
  };

  const handleDelete = async (vid: string) => {
    if (!confirm("删除这个历史版本？此操作不可撤销。")) return;
    const res = await fetch(`/api/notes/${noteId}/versions/${vid}`, { method: "DELETE" });
    if (res.ok) {
      setVersions((prev) => prev.filter((v) => v.id !== vid));
    }
  };

  return (
    <>
      {openProp === undefined && (
        <Button
          variant="ghost"
          size={triggerSize}
          className="gap-1.5"
          title="历史版本"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <History className={iconOnly ? "h-4 w-4" : "h-3.5 w-3.5"} />
          {!iconOnly && "历史"}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>历史版本</DialogTitle>
            <DialogDescription>
              每次修改后自动保存，最多 50 个。恢复后当前内容会自动存为新版本。
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : versions.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              还没有历史版本，编辑笔记后会自动产生
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto -mx-2">
              {versions.map((v, i) => (
                <div
                  key={v.id}
                  className={cn(
                    "px-3 py-2 mx-2 rounded-md flex items-center gap-3 group hover:bg-accent transition-colors",
                    i === 0 && "bg-muted/50"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {v.title || "无标题"}
                      {i === 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">（最近）</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleString("zh-CN")}
                      {v.message && ` · ${v.message}`}
                    </p>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="恢复此版本"
                      disabled={restoringId === v.id}
                      onClick={() => handleRestore(v.id)}
                    >
                      {restoringId === v.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:text-destructive"
                      title="删除此版本"
                      onClick={() => handleDelete(v.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
