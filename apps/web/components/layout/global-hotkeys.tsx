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

// g 序列唯一注册表：运行时跳转、帮助弹窗条目与 gotoMode 提示串均由此派生，
// 新增/调整键位只改这里（C01 键位一致性校验见 global-hotkeys.test.ts）
export interface GotoRoute {
  sequence: [string, string];
  path: string;
  label: string;
}

export const GOTO_ROUTES: GotoRoute[] = [
  { sequence: ["g", "h"], path: "/", label: "首页" },
  // g i 是整合前「收集箱」的肌肉记忆，与 g l 同指向稍后读
  { sequence: ["g", "i"], path: "/library", label: "稍后读" },
  { sequence: ["g", "l"], path: "/library", label: "稍后读" },
  { sequence: ["g", "n"], path: "/notes", label: "笔记" },
  { sequence: ["g", "c"], path: "/canvas", label: "构思画布" },
  { sequence: ["g", "d"], path: "/tasks", label: "待办" },
  { sequence: ["g", "e"], path: "/tasks/lessons", label: "经验" },
  { sequence: ["g", "m"], path: "/memos", label: "速记" },
  { sequence: ["g", "g"], path: "/graph", label: "图谱" },
  { sequence: ["g", "f"], path: "/favorites", label: "收藏夹" },
  { sequence: ["g", "t"], path: "/tags", label: "标签" },
  { sequence: ["g", "r"], path: "/?view=review", label: "回顾" },
  { sequence: ["g", "s"], path: "/?view=stats", label: "统计" },
  { sequence: ["g", "p"], path: "/plugins", label: "插件" },
];

export const GOTO_HINT = `按 g 后，按 ${GOTO_ROUTES.map((r) => r.sequence[1]).join("/")} 跳转...`;

// 全局清单：g 条目从 GOTO_ROUTES 派生，⌘K/⌘N/?/Esc 为各自组件注册的手工条目
export const SHORTCUTS = [
  { keys: "⌘K", desc: "打开命令面板" },
  { keys: "⌘N", desc: "快捷添加" },
  ...GOTO_ROUTES.map(({ sequence, label }) => ({ keys: sequence.join(" "), desc: `跳转到${label}` })),
  { keys: "?", desc: "显示快捷键帮助" },
  { keys: "Esc", desc: "关闭对话框/清空序列" },
];

export const PAGE_SHORTCUTS = [
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
    GOTO_ROUTES.map(({ sequence, path }) => ({ sequence, handler: () => go(path) })),
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
          {GOTO_HINT}
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
