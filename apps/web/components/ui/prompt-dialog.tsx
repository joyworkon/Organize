"use client";

/**
 * 全局 Promise 风格的输入对话框，替代 window.prompt。
 *
 * window.prompt 是原生弹窗：无样式、移动端体验差、且会阻塞 JS。
 * 用法：
 *   const name = await showPrompt({ title: "清单名称：" });
 *   if (name === null) return; // 用户取消
 *
 * 需要在布局里挂载一次 <PromptHost />（已在 (main)/layout.tsx）。
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface PromptOptions {
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
}

export interface ConfirmOptions {
  title: string;
  /** 补充说明（危险操作的后果描述） */
  description?: string;
  confirmText?: string;
  /** 危险操作：确认按钮红色 */
  destructive?: boolean;
}

type PromptResolver = (value: string | null) => void;
type ConfirmResolver = (confirmed: boolean) => void;

interface PendingDialog {
  prompt?: { options: PromptOptions; resolve: PromptResolver };
  confirm?: { options: ConfirmOptions; resolve: ConfirmResolver };
}

let pendingDialog: PendingDialog | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

/** 弹出输入对话框，resolve 输入内容（trim 后）；用户取消/关闭时 resolve null */
export function showPrompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    // 已有未处理的弹窗时先取消旧的，避免 Promise 悬挂
    pendingDialog?.prompt?.resolve(null);
    pendingDialog?.confirm?.resolve(false);
    pendingDialog = { prompt: { options, resolve } };
    notify();
  });
}

/**
 * 全局确认对话框，替代 window.confirm。
 * resolve true=确认；取消/关闭 resolve false。用法：
 *   const ok = await showConfirm({ title: "删除？", destructive: true });
 *   if (!ok) return;
 */
export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    pendingDialog?.prompt?.resolve(null);
    pendingDialog?.confirm?.resolve(false);
    pendingDialog = { confirm: { options, resolve } };
    notify();
  });
}

export function PromptHost() {
  const [, setVersion] = useState(0);
  const [value, setValue] = useState("");

  useEffect(() => {
    const listener = () => {
      setValue(pendingDialog?.prompt?.options.defaultValue || "");
      setVersion((n) => n + 1);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const closePrompt = (result: string | null) => {
    const current = pendingDialog?.prompt;
    pendingDialog = null;
    setVersion((n) => n + 1);
    current?.resolve(result);
  };

  const closeConfirm = (confirmed: boolean) => {
    const current = pendingDialog?.confirm;
    pendingDialog = null;
    setVersion((n) => n + 1);
    current?.resolve(confirmed);
  };

  const prompt = pendingDialog?.prompt;
  const confirm = pendingDialog?.confirm;

  return (
    <>
      <Dialog open={Boolean(prompt)} onOpenChange={(open) => { if (!open) closePrompt(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{prompt?.options.title}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              closePrompt(value.trim());
            }}
          >
            <Input
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={prompt?.options.placeholder}
              aria-label={prompt?.options.title}
            />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => closePrompt(null)}>
                取消
              </Button>
              <Button type="submit">{prompt?.options.confirmText || "确定"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open) closeConfirm(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm?.options.title}</DialogTitle>
            {confirm?.options.description && (
              <DialogDescription className="text-left leading-relaxed">
                {confirm.options.description}
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => closeConfirm(false)}>
              取消
            </Button>
            <Button
              variant={confirm?.options.destructive ? "destructive" : "default"}
              onClick={() => closeConfirm(true)}
            >
              {confirm?.options.confirmText || "确定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
