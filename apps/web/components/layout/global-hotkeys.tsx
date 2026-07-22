"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useHotkeySequence } from "@/lib/hooks/use-hotkey";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Dialog as DialogRoot } from "@/components/ui/dialog";

const SHORTCUTS = [
  { keys: "g i", desc: "跳转到收集箱" },
  { keys: "g l", desc: "跳转到阅读库" },
  { keys: "g n", desc: "跳转到笔记" },
  { keys: "g t", desc: "跳转到标签" },
  { keys: "g s", desc: "跳转到统计" },
  { keys: "g p", desc: "跳转到插件" },
  { keys: "?", desc: "显示快捷键帮助" },
  { keys: "Esc", desc: "关闭对话框/清空序列" },
];

export function GlobalHotkeys() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);

  const go = useCallback(
    (path: string) => {
      // 保留当前 query/hash
      router.push(path);
    },
    [router]
  );

  // g + 字母 跳转
  useHotkeySequence([
    { sequence: ["g", "i"], handler: () => go("/inbox") },
    { sequence: ["g", "l"], handler: () => go("/library") },
    { sequence: ["g", "n"], handler: () => go("/notes") },
    { sequence: ["g", "t"], handler: () => go("/tags") },
    { sequence: ["g", "s"], handler: () => go("/stats") },
    { sequence: ["g", "p"], handler: () => go("/plugins") },
  ]);

  // ? 显示帮助（用单键 hook 也行，这里复用 sequence）
  useHotkeySequence([{ sequence: ["?"], handler: () => setHelpOpen(true) }]);

  return (
    <DialogRoot open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>键盘快捷键</DialogTitle>
          <DialogDescription>在 1.5 秒内按完整个序列触发</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{s.desc}</span>
              <kbd className="font-mono text-xs bg-muted px-2 py-1 rounded border">{s.keys}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
