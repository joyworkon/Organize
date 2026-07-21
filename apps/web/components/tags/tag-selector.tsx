"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Tag as TagIcon, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { Tag } from "@organize/shared";

interface TagSelectorProps {
  /** 当前已选中的标签 */
  selected: Pick<Tag, "id" | "name">[];
  /** 所有可选标签（由父组件通过 GET /api/tags 加载后传入） */
  options: Tag[];
  /** 选中状态变化时回调（增删都会触发，返回最新全量选中列表） */
  onChange: (next: Pick<Tag, "id" | "name">[]) => void;
  /** 允许输入新标签名直接创建；默认 true */
  allowCreate?: boolean;
  /** 触发器文案 */
  triggerLabel?: string;
  /** 对齐方式 */
  align?: "start" | "center" | "end";
  children?: React.ReactNode;
}

export function TagSelector({
  selected,
  options,
  onChange,
  allowCreate = true,
  triggerLabel = "添加标签",
  align = "start",
  children,
}: TagSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // 关闭时清空搜索
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const selectedIds = useMemo(() => new Set(selected.map((t) => t.id)), [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  // 是否展示"创建新标签"项：允许创建 + 输入非空 + 不在现有标签里
  const showCreate =
    allowCreate &&
    query.trim().length > 0 &&
    query.trim().length <= 32 &&
    !options.some((o) => o.name.toLowerCase() === query.trim().toLowerCase());

  const toggle = (tag: Pick<Tag, "id" | "name">) => {
    if (selectedIds.has(tag.id)) {
      onChange(selected.filter((t) => t.id !== tag.id));
    } else {
      onChange([...selected, tag]);
    }
  };

  const createAndSelect = () => {
    const name = query.trim();
    if (!name) return;
    // 给一个临时 id（以 new: 前缀），父组件在保存时识别并调用 POST /api/tags 创建
    // 更简单的做法：父组件 onSelectNew 回调里创建。这里统一走 onChange，用 new: 前缀
    const tempTag = { id: `new:${name}`, name };
    onChange([...selected, tempTag]);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ?? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent"
          >
            <TagIcon className="h-3 w-3" />
            {triggerLabel}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索或输入新标签..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>
              {showCreate ? "按回车创建新标签" : "无匹配标签"}
            </CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup>
                {filtered.map((tag) => {
                  const isSelected = selectedIds.has(tag.id);
                  return (
                    <CommandItem
                      key={tag.id}
                      value={tag.name}
                      onSelect={() => toggle(tag)}
                      className="gap-2"
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-sm border",
                          isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted"
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                      <span className="truncate">{tag.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {showCreate && (
              <CommandGroup>
                <CommandItem value={`__create__${query}`} onSelect={createAndSelect}>
                  <Plus className="h-4 w-4" />
                  <span>
                    创建标签 <span className="font-medium">&ldquo;{query.trim()}&rdquo;</span>
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
