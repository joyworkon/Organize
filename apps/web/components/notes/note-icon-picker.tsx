"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const GROUPS = {
  常用: [
    ["💡", "灵感 light idea"], ["📘", "蓝书 book"], ["📚", "书籍 books reading"],
    ["📝", "笔记 note memo"], ["✍️", "写作 writing"], ["🎯", "目标 target goal"],
    ["🚀", "火箭 rocket launch"], ["📌", "图钉 pin"],
  ],
  表情: [
    ["😀", "开心笑脸 smile happy"], ["😊", "微笑 smile"], ["🥰", "喜欢 love"],
    ["😎", "酷 sunglasses cool"], ["🤔", "思考 thinking"], ["🧠", "大脑 brain"],
  ],
  物品: [
    ["🧭", "指南针 compass"], ["🗂️", "文件夹 folder"], ["📊", "图表 chart"],
    ["🎨", "艺术画板 art palette"], ["💻", "电脑 computer laptop"], ["🏠", "家 home house"],
  ],
  符号: [
    ["⭐", "星星 star"], ["🔥", "火焰 fire"], ["✅", "完成 check done"],
    ["❤️", "红心 heart love"], ["❓", "问题 question"], ["⚡", "闪电 lightning"],
  ],
  自然: [
    ["🌱", "幼苗 seedling plant"], ["🌲", "树 tree forest"], ["🌸", "樱花 blossom flower"],
    ["🌊", "海浪 ocean wave"], ["☀️", "太阳 sun"], ["🌙", "月亮 moon"],
  ],
};
const ALL = Object.values(GROUPS).flat();
const RECENT_KEY = "organize:note-recent-icons";

function loadRecent(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(stored)
      ? [...new Set(stored.filter((value): value is string => typeof value === "string" && ALL.some(([emoji]) => emoji === value)))].slice(0, 16)
      : [];
  } catch { return []; }
}

export function NoteIconPicker({ icon, onSelect, children }: {
  icon: string | null;
  onSelect: (icon: string | null) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("常用");
  const [recent, setRecent] = useState<string[]>([]);
  const source = category === "最近使用"
    ? recent.flatMap((value) => ALL.filter(([emoji]) => emoji === value))
    : GROUPS[category as keyof typeof GROUPS];
  const entries = query.trim()
    ? ALL.filter(([emoji, keywords]) => `${emoji} ${keywords}`.toLowerCase().includes(query.trim().toLowerCase()))
    : source;
  const select = (value: string | null) => {
    if (value) {
      const next = [value, ...loadRecent().filter((emoji) => emoji !== value)].slice(0, 16);
      setRecent(next);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* UI preference only */ }
    }
    onSelect(value);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) { setRecent(loadRecent()); setQuery(""); }
    }}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="note-icon-picker w-80 max-w-[calc(100vw-32px)] p-3" aria-label="页面图标">
        <Input aria-label="搜索图标" placeholder="搜索图标（中文 / English）" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="my-2 flex flex-wrap gap-1" role="group" aria-label="图标分类">
          {["最近使用", ...Object.keys(GROUPS)].map((group) => (
            <Button key={group} type="button" variant="ghost" size="sm" aria-pressed={category === group}
              className={category === group ? "bg-accent" : ""} onClick={() => { setCategory(group); setQuery(""); }}>{group}</Button>
          ))}
        </div>
        <div className="note-icon-grid grid grid-cols-6 gap-1" role="group" aria-label="图标列表" onKeyDown={(event) => {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          if (index < 0) return;
          const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 6, ArrowUp: -6 }[event.key];
          if (delta !== undefined) {
            event.preventDefault();
            buttons[Math.max(0, Math.min(buttons.length - 1, index + delta))]?.focus();
          }
        }}>
          {entries.map(([emoji, keywords]) => (
            <Button key={emoji} type="button" variant="ghost" size="icon" className="w-full text-xl" aria-label={`${emoji} ${keywords}`} aria-pressed={icon === emoji} onClick={() => select(emoji)}>{emoji}</Button>
          ))}
        </div>
        {entries.length === 0 && <p role="status" className="py-3 text-sm text-muted-foreground">{query ? "没有匹配的图标" : "还没有最近使用的图标"}</p>}
        <div className="mt-2 flex justify-between border-t pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => select(ALL[Math.floor(Math.random() * ALL.length)][0])}>随机图标</Button>
          {icon && <Button type="button" variant="ghost" size="sm" onClick={() => select(null)}>移除图标</Button>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
