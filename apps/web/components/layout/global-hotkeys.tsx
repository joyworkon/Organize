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

const SHORTCUTS = [
  { keys: "⌘K", desc: "打开命令面板" },
  { keys: "⌘N", desc: "快捷添加" },
  { keys: "g h", desc: "跳转到首页" },
  { keys: "g i", desc: "跳转到收集箱" },
  { keys: "g l", desc: "跳转到阅读库" },
  { keys: "g n", desc: "跳转到笔记" },
  { keys: "g d", desc: "跳转到待办" },
  { keys: "g e", desc: "跳转到经验" },
  { keys: "g f", desc: "跳转到收藏夹" },
  { keys: "g t", desc: "跳转到标签" },
  { keys: "g r", desc: "跳转到回顾" },
  { keys: "g s", desc: "跳转到统计" },
  { keys: "g p", desc: "跳转到插件" },
  { keys: "?", desc: "显示快捷键帮助" },
  { keys: "Esc", desc: "关闭对话框/清空序列" },
];

export function GlobalHotkeys() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const [gotoMode, setGotoMode] = useState(false);

  const go = useCallback(
    (path: string) => {
      router.push(path);
      setGotoMode(false);
    },
    [router]
  );

  useHotkeySequence(
    [
      { sequence: ["g", "h"], handler: () => go("/") },
      { sequence: ["g", "i"], handler: () => go("/inbox") },
      { sequence: ["g", "l"], handler: () => go("/library") },
      { sequence: ["g", "n"], handler: () => go("/notes") },
      { sequence: ["g", "d"], handler: () => go("/tasks") },
      { sequence: ["g", "e"], handler: () => go("/lessons") },
      { sequence: ["g", "f"], handler: () => go("/favorites") },
      { sequence: ["g", "t"], handler: () => go("/tags") },
      { sequence: ["g", "r"], handler: () => go("/?view=review") },
      { sequence: ["g", "s"], handler: () => go("/?view=stats") },
      { sequence: ["g", "p"], handler: () => go("/plugins") },
    ],
    {
      onBufferChange: (buffer) => {
        setGotoMode(buffer.length === 1 && buffer[0] === "g");
      },
    }
  );

  useHotkeySequence([{ sequence: ["?"], handler: () => setHelpOpen(true) }]);

  return (
    <>
      {gotoMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-popover text-popover-foreground border rounded-md px-3 py-1.5 text-sm">
          按 g 后，按 h/i/l/n/d/e/f/t/r/s/p 跳转...
        </div>
      )}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
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
      </Dialog>
    </>
  );
}
