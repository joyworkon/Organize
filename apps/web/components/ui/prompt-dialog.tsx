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

type PromptResolver = (value: string | null) => void;

let pendingPrompt: { options: PromptOptions; resolve: PromptResolver } | null = null;
const listeners = new Set<() => void>();

/** 弹出输入对话框，resolve 输入内容（trim 后）；用户取消/关闭时 resolve null */
export function showPrompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    // 已有未处理的弹窗时先取消旧的，避免 Promise 悬挂
    pendingPrompt?.resolve(null);
    pendingPrompt = { options, resolve };
    listeners.forEach((listener) => listener());
  });
}

export function PromptHost() {
  const [, setVersion] = useState(0);
  const [value, setValue] = useState("");

  useEffect(() => {
    const listener = () => {
      setValue(pendingPrompt?.options.defaultValue || "");
      setVersion((n) => n + 1);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const close = (result: string | null) => {
    const current = pendingPrompt;
    pendingPrompt = null;
    setVersion((n) => n + 1);
    current?.resolve(result);
  };

  const options = pendingPrompt?.options;

  return (
    <Dialog open={Boolean(options)} onOpenChange={(open) => { if (!open) close(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{options?.title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            close(value.trim());
          }}
        >
          <Input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={options?.placeholder}
            aria-label={options?.title}
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => close(null)}>
              取消
            </Button>
            <Button type="submit">{options?.confirmText || "确定"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
