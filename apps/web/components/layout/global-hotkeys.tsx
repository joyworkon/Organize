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
  { keys: "g i", desc: "跳转到稍后读" },
  { keys: "g l", desc: "跳转到稍后读" },
  { keys: "g n", desc: "跳转到笔记" },
  { keys: "g d", desc: "跳转到待办" },
  { keys: "g e", desc: "跳转到经验" },
  { keys: "g g", desc: "跳转到图谱" },
  { keys: "g f", desc: "跳转到收藏夹" },
  { keys: "g t", desc: "跳转到标签" },
  { keys: "g r", desc: "跳转到回顾" },
  { keys: "g s", desc: "跳转到统计" },
  { keys: "g p", desc: "跳转到插件" },
  { keys: "?", desc: "显示快捷键帮助" },
  { keys: "Esc", desc: "关闭对话框/清空序列" },
];

const PAGE_SHORTCUTS = [
  {
    page: "笔记列表",
    items: [
      { keys: "n", desc: "新建笔记" },
      { keys: "/", desc: "聚焦搜索框" },
      { keys: "Esc", desc: "退出多选 / 清空搜索" },
    ],
  },
  {
    page: "待办列表",
    items: [
      { keys: "n", desc: "聚焦快速添加" },
      { keys: "v", desc: "切换日期分组" },
      { keys: "m", desc: "切换多选模式" },
      { keys: "x", desc: "完成/取消完成（任务行聚焦时）" },
      { keys: "Esc", desc: "关闭详情 / 退出多选" },
    ],
  },
  {
    page: "笔记详情",
    items: [{ keys: "⌘S / Ctrl+S", desc: "立即保存" }],
  },
  {
    page: "稍后读",
    items: [
      { keys: "/", desc: "聚焦搜索框" },
      { keys: "Esc", desc: "退出多选 / 清空搜索" },
    ],
  },
  {
    page: "经验",
    items: [
      { keys: "n", desc: "记录经验" },
      { keys: "/", desc: "聚焦搜索框" },
      { keys: "Esc", desc: "清空搜索" },
    ],
  },
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
      // g i 是整合前「收集箱」的肌肉记忆，与 g l 同指向稍后读
      { sequence: ["g", "i"], handler: () => go("/library") },
      { sequence: ["g", "l"], handler: () => go("/library") },
      { sequence: ["g", "n"], handler: () => go("/notes") },
      { sequence: ["g", "d"], handler: () => go("/tasks") },
      { sequence: ["g", "e"], handler: () => go("/tasks/lessons") },
      { sequence: ["g", "m"], handler: () => go("/memos") },
      { sequence: ["g", "g"], handler: () => go("/graph") },
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
          按 g 后，按 h/i/l/n/d/e/g/f/t/r/s/p 跳转...
        </div>
      )}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
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
          {PAGE_SHORTCUTS.map((group) => (
            <div key={group.page}>
              <h3 className="mb-2 mt-4 text-xs font-medium text-muted-foreground">{group.page}</h3>
              <div className="space-y-2">
                {group.items.map((s) => (
                  <div key={s.keys} className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">{s.desc}</span>
                    <kbd className="font-mono text-xs bg-muted px-2 py-1 rounded border">{s.keys}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
