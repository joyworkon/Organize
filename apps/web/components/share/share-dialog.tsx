"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Share2, Copy, Check, Trash2, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShareResourceType } from "@organize/shared";

interface ShareDialogProps {
  resourceType: ShareResourceType;
  resourceId: string;
  /** 触发按钮样式变体，默认 outline */
  triggerVariant?: "outline" | "ghost";
  triggerSize?: "sm" | "icon" | "default";
  triggerLabel?: string;
  /** 只显示图标不显示文字 */
  iconOnly?: boolean;
  /** 受控打开状态（可选）。不传则内部自管理 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface ShareInfo {
  token: string;
  url: string;
  is_public: boolean;
}

export function ShareDialog({
  resourceType,
  resourceId,
  triggerVariant = "ghost",
  triggerSize = "icon",
  triggerLabel,
  iconOnly = true,
  open: openProp,
  onOpenChange,
}: ShareDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 打开时拉取当前分享状态
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch(`/api/share?resource_type=${resourceType}&resource_id=${resourceId}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("加载失败");
        const data = await res.json();
        if (data) {
          setShare({ token: data.token, url: data.url, is_public: data.is_public });
        } else {
          setShare(null);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, resourceType, resourceId]);

  const createShare = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建失败");
      }
      const data = await res.json();
      setShare({ token: data.token, url: data.url, is_public: data.is_public });
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const revokeShare = async () => {
    if (!share) return;
    if (!confirm("确定撤销这个分享链接？撤销后链接将立即失效。")) return;
    try {
      const res = await fetch("/api/share", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId }),
      });
      if (!res.ok) throw new Error("撤销失败");
      setShare(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "撤销失败");
    }
  };

  const copyLink = async () => {
    if (!share) return;
    const fullUrl = `${window.location.origin}${share.url}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 兜底：选中输入框
    }
  };

  const fullUrl = share ? `${typeof window !== "undefined" ? window.location.origin : ""}${share.url}` : "";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* 受控模式下不渲染触发器（由父组件控制开关） */}
      {openProp === undefined && (
        <Button
          variant={triggerVariant}
          size={iconOnly ? "sm" : triggerSize}
          className={cn(iconOnly && "h-7 w-7 p-0 gap-0", !iconOnly && "gap-1.5")}
          title="分享"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <Share2 className="h-3.5 w-3.5" />
          {!iconOnly && (triggerLabel || "分享")}
        </Button>
      )}
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>分享</DialogTitle>
          <DialogDescription>
            生成一个公开链接，任何人都可以查看（无需登录）
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : share ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input readOnly value={fullUrl} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={copyLink} title="复制链接">
                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <a
                href={fullUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                在新窗口打开
              </a>
              <Button variant="outline" size="sm" onClick={revokeShare} className="gap-1.5 text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
                撤销分享
              </Button>
            </div>

            {!share.is_public && (
              <p className="text-xs text-muted-foreground">该分享已关闭公开访问</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              这个内容还没有公开分享链接。创建后会生成一个随机链接，你可以随时撤销。
            </p>
            <Button onClick={createShare} disabled={creating} className="gap-1.5">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
              创建分享链接
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
