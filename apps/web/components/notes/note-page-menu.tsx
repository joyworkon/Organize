"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MoreHorizontal,
  Link2,
  Copy,
  CopyPlus,
  Maximize2,
  Type,
  Check,
  Search,
  FolderInput,
  History,
  FileDown,
  Trash2,
  ListTree,
  Paperclip,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NoteFont } from "@organize/shared";

interface NotePageMenuProps {
  /** N03：只读角色隐藏会写库的设置/动作（全宽/字体/移动/副本/删除等） */
  readOnly?: boolean;
  fullWidth: boolean;
  onToggleFullWidth: () => void;
  font: NoteFont;
  onFontChange: (font: NoteFont) => void;
  smallFont: boolean;
  onToggleSmallFont: () => void;
  /** 页面目录开关（不传则不显示） */
  tocOpen?: boolean;
  onToggleToc?: () => void;
  onCopyLink: () => void;
  onCopyContent: () => void;
  onDuplicate: () => void;
  onMove?: () => void;
  /** 历史版本（不传则不显示） */
  onShowHistory?: () => void;
  /** 附件面板（D04：入口收进更多菜单） */
  onOpenAttachments?: () => void;
  /** 创建时间（收进页面信息区，§5.3） */
  createdAt?: string | null;
  /** 导出 Markdown（不传则不显示） */
  onExport?: () => void;
  /** 删除（移入垃圾箱；不传则不显示） */
  onDelete?: () => void;
  /** 页面信息（字数/块数/编辑时间；不传则不显示） */
  wordCount?: number;
  blockCount?: number;
  lastEditedAt?: Date | null;
}

/** 菜单项类型 */
type MenuItemType = "radio" | "toggle" | "action";

interface MenuItem {
  id: string;
  type: MenuItemType;
  label: string;
  /** 关键词，用于搜索匹配（除 label 外） */
  keywords?: string[];
  icon?: LucideIcon;
  shortcut?: string;
  /** 只有 action 类型在执行后会关闭菜单 */
  danger?: boolean;
  disabled?: boolean;
  /** 执行回调（复用外部传入的回调，不复制逻辑） */
  onSelect: () => void;
  /** radio/toggle: 是否选中 */
  checked?: boolean;
}

interface MenuSection {
  /** 分组标签，空字符串表示无标签（紧贴上方分隔线） */
  label: string;
  labelIcon?: LucideIcon;
  items: MenuItem[];
}

const FONT_OPTIONS: { value: NoteFont; label: string }[] = [
  { value: "default", label: "默认" },
  { value: "serif", label: "衬线体" },
  { value: "mono", label: "等宽体" },
];

/** 判断命令是否匹配查询 */
function commandMatches(item: MenuItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const searchable = [item.label, ...(item.keywords || [])].join(" ").toLowerCase();
  return searchable.includes(normalized);
}

export function NotePageMenu({
  readOnly = false,
  fullWidth,
  onToggleFullWidth,
  font,
  onFontChange,
  smallFont,
  onToggleSmallFont,
  tocOpen,
  onToggleToc,
  onCopyLink,
  onCopyContent,
  onDuplicate,
  onMove,
  onShowHistory,
  onOpenAttachments,
  createdAt,
  onExport,
  onDelete,
  wordCount,
  blockCount,
  lastEditedAt,
}: NotePageMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const executingRef = useRef(false);

  /** 构建菜单项数据（每次渲染从 props 派生，确保回调和 checked 状态是最新的） */
  const MUTATING_ITEM_IDS = new Set(["full-width", "small-font", "move", "duplicate", "delete"]);
  const sections: MenuSection[] = useMemo(() => [
    {
      label: "页面显示",
      labelIcon: Maximize2,
      items: [
        {
          id: "full-width",
          type: "toggle" as const,
          label: "全宽",
          keywords: ["full", "width", "quan kuan", "宽屏"],
          icon: Maximize2,
          checked: fullWidth,
          onSelect: onToggleFullWidth,
        },
        ...(onToggleToc ? [{
          id: "toc",
          type: "toggle" as const,
          label: "页面目录",
          keywords: ["toc", "目录", "mu lu", "outline", "biao ti"],
          icon: ListTree,
          checked: tocOpen === true,
          onSelect: onToggleToc,
        }] : []),
      ],
    },
    {
      label: "字体",
      labelIcon: Type,
      items: FONT_OPTIONS.map((opt) => ({
        id: `font-${opt.value}`,
        type: "radio" as const,
        label: opt.label,
        keywords: ["font", "字体", "zi ti"],
        checked: font === opt.value,
        onSelect: () => onFontChange(opt.value),
      })),
    },
    {
      label: "",
      items: [
        {
          id: "small-font",
          type: "toggle" as const,
          label: "小字号",
          keywords: ["small", "font", "小号", "xiao zi hao"],
          checked: smallFont,
          onSelect: onToggleSmallFont,
        },
      ],
    },
    {
      label: "",
      items: [
        ...(onMove ? [{
          id: "move",
          type: "action" as const,
          label: "移动到",
          keywords: ["move", "移动", "yi dong", "父页面", "parent"],
          icon: FolderInput,
          onSelect: onMove,
        }] : []),
        {
          id: "copy-link",
          type: "action" as const,
          label: "拷贝链接",
          keywords: ["copy", "link", "链接", "kao bei lian jie", "url"],
          icon: Link2,
          onSelect: onCopyLink,
        },
        {
          id: "copy-content",
          type: "action" as const,
          label: "拷贝页面内容",
          keywords: ["copy", "content", "拷贝", "复制", "kao bei ye mian nei rong", "正文"],
          icon: Copy,
          onSelect: onCopyContent,
        },
        {
          id: "duplicate",
          type: "action" as const,
          label: "创建副本",
          keywords: ["duplicate", "copy", "副本", "复制", "chuang jian fu ben", "clone"],
          icon: CopyPlus,
          onSelect: onDuplicate,
        },
        ...(onOpenAttachments ? [{
          id: "attachments",
          type: "action" as const,
          label: "附件",
          keywords: ["attachment", "files", "附件", "文件", "fu jian"],
          icon: Paperclip,
          onSelect: onOpenAttachments,
        }] : []),
        ...(onShowHistory ? [{
          id: "history",
          type: "action" as const,
          label: "历史版本",
          keywords: ["history", "版本", "历史", "ban ben", "li shi", "version"],
          icon: History,
          onSelect: onShowHistory,
        }] : []),
        ...(onExport ? [{
          id: "export",
          type: "action" as const,
          label: "导出 Markdown",
          keywords: ["export", "导出", "markdown", "dao chu", "md"],
          icon: FileDown,
          onSelect: onExport,
        }] : []),
        ...(onDelete ? [{
          id: "delete",
          type: "action" as const,
          label: "删除",
          keywords: ["delete", "删除", "垃圾箱", "shan chu", "trash"],
          icon: Trash2,
          danger: true,
          onSelect: onDelete,
        }] : []),
      ],
    },
  ], [font, smallFont, fullWidth, tocOpen, onFontChange, onToggleSmallFont, onToggleFullWidth, onToggleToc, onCopyLink, onCopyContent, onDuplicate, onMove, onShowHistory, onOpenAttachments, onExport, onDelete]);

  // N03：只读角色隐藏会变更持久内容的条目（页面显示设置/字体/移动/副本/删除）；
  // 拷贝、目录、附件与历史查看等只读动作保留
  const roleFilteredSections = useMemo(
    () => readOnly
      ? sections
          .map((section) => ({
            ...section,
            items: section.items.filter((item) => !MUTATING_ITEM_IDS.has(item.id)),
          }))
          .filter((section) => section.items.length > 0)
      : sections,
    [sections, readOnly]
  );

  /** 打平的可选项列表（用于键盘导航和过滤） */
  const flatItems = useMemo(() => {
    const items: { section: number; index: number; item: MenuItem }[] = [];
    roleFilteredSections.forEach((section, si) => {
      section.items.forEach((item, ii) => {
        items.push({ section: si, index: ii, item });
      });
    });
    return items;
  }, [roleFilteredSections]);

  /** 过滤后的列表 */
  const filteredItems = useMemo(
    () => flatItems.filter(({ item }) => commandMatches(item, query)),
    [flatItems, query]
  );

  /** 过滤后仍有可见项的 sections（保持原分组顺序） */
  const visibleSections = useMemo(() => {
    const result: { section: MenuSection; visibleItems: MenuItem[] }[] = [];
    roleFilteredSections.forEach((section) => {
      const visibleItems = section.items.filter((item) => commandMatches(item, query));
      if (visibleItems.length > 0 || !query) {
        result.push({ section, visibleItems: query ? visibleItems : section.items });
      }
    });
    return result.filter(({ visibleItems }) => visibleItems.length > 0);
  }, [roleFilteredSections, query]);

  /** 菜单打开时重置状态 */
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      executingRef.current = false;
    }
  }, [open]);

  /** 在 Radix 打开菜单自动聚焦时，将焦点重定向到搜索输入框 */
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleOpenAutoFocus = useCallback((e: Event) => {
    e.preventDefault();
    inputRef.current?.focus();
  }, []);

  /** 查询变更时重置 activeIndex */
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  /** 确保 activeIndex 不越界 */
  useEffect(() => {
    if (filteredItems.length === 0) {
      setActiveIndex(0);
    } else if (activeIndex >= filteredItems.length) {
      setActiveIndex(filteredItems.length - 1);
    }
  }, [filteredItems.length, activeIndex]);

  /** 执行当前选中项 */
  const executeActive = useCallback(() => {
    // 防止 Enter 重复触发
    if (executingRef.current) return;
    const entry = filteredItems[activeIndex];
    if (!entry || entry.item.disabled) return;
    executingRef.current = true;
    entry.item.onSelect();
    // action 类型关闭菜单，toggle/radio 保持菜单打开
    if (entry.item.type === "action") {
      setOpen(false);
    } else {
      // toggle/radio 不关闭菜单，重置执行锁
      executingRef.current = false;
    }
  }, [activeIndex, filteredItems]);

  /** 处理键盘事件 */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIndex((prev) => {
        if (filteredItems.length === 0) return 0;
        return Math.min(prev + 1, filteredItems.length - 1);
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      executeActive();
    } else if (e.key === "Escape") {
      // 让 Escape 传播给 Radix 以关闭菜单
      return;
    } else {
      // 其他按键（字符输入等）阻止冒泡到 Radix，避免 typeahead 干扰
      e.stopPropagation();
    }
  }, [filteredItems.length, executeActive]);

  /** 鼠标悬停时更新 activeIndex */
  const handleItemMouseEnter = useCallback((globalIndex: number) => {
    setActiveIndex(globalIndex);
  }, []);

  /** 点击项目 */
  const handleItemClick = useCallback((entry: { item: MenuItem }) => {
    if (entry.item.disabled) return;
    executingRef.current = true;
    entry.item.onSelect();
    if (entry.item.type === "action") {
      setOpen(false);
    } else {
      executingRef.current = false;
    }
  }, []);

  /** 重新打开时重置 executingRef */
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      executingRef.current = false;
    }
    setOpen(nextOpen);
  }, []);

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} variant="ghost" size="icon" className="h-8 w-8" title="更多">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 p-0"
        onCloseAutoFocus={(e) => {
          // 防止关闭后焦点回到 trigger 造成再次打开（保留原 workaround），
          // 但仍要满足「Esc 关闭浮层并返回触发器」：显式聚焦触发器。
          e.preventDefault();
          triggerRef.current?.focus();
        }}
        {...{ onOpenAutoFocus: handleOpenAutoFocus } as any}
      >
        {/* 搜索输入框 */}
        <div
          className="flex items-center gap-2 border-b px-3 py-2"
          cmdk-input-wrapper=""
        >
          <Search className="h-4 w-4 shrink-0 opacity-50" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索命令..."
            className="flex h-6 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="搜索菜单命令"
          />
        </div>

        {/* 命令列表 */}
        <div className="max-h-[320px] overflow-y-auto overflow-x-hidden py-1">
          {filteredItems.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              没有匹配的命令
            </div>
          )}

          {visibleSections.map(({ section, visibleItems }, sectionIdx) => {
            // 计算此 section 之前是否有可见 section（用于分隔线）
            const hasPrevSection = sectionIdx > 0;
            return (
              <div key={sectionIdx}>
                {hasPrevSection && (
                  <div className="-mx-1 my-1 h-px bg-muted" />
                )}
                {section.label && (
                  <div
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1.5 text-sm font-semibold text-muted-foreground",
                      section.labelIcon && ""
                    )}
                  >
                    {section.labelIcon && <section.labelIcon className="h-3.5 w-3.5" />}
                    {section.label}
                  </div>
                )}
                {visibleItems.map((item) => {
                  // 找到此项在 filteredItems 中的全局索引
                  const globalIndex = filteredItems.findIndex(
                    (fi) => fi.item.id === item.id
                  );
                  const isActive = globalIndex === activeIndex;
                  const Icon = item.icon;
                  const isCheckboxType = item.type === "radio" || item.type === "toggle";

                  return (
                    <div
                      key={item.id}
                      role="option"
                      aria-selected={isActive}
                      aria-disabled={item.disabled}
                      data-disabled={item.disabled ? "" : undefined}
                      className={cn(
                        "relative flex cursor-default select-none items-center rounded-sm text-sm outline-none transition-colors",
                        isCheckboxType ? "py-1.5 pl-8 pr-2" : "px-2 py-1.5",
                        isActive && "bg-accent text-accent-foreground",
                        item.disabled && "pointer-events-none opacity-50",
                        item.danger && "text-destructive focus:bg-destructive focus:text-destructive-foreground",
                        isActive && item.danger && "bg-destructive text-destructive-foreground"
                      )}
                      onMouseOver={() => handleItemMouseEnter(globalIndex)}
                      onClick={() => handleItemClick({ item })}
                    >
                      {/* Check 图标（radio/toggle 选中态） */}
                      {isCheckboxType && (
                        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                          {item.checked && <Check className="h-4 w-4" />}
                        </span>
                      )}

                      {/* 图标（非 checkbox 类型的图标在文字左侧） */}
                      {!isCheckboxType && Icon && (
                        <Icon className="mr-2 h-4 w-4" />
                      )}

                      {/* 标签（带图标时与图标同行） */}
                      {isCheckboxType && Icon ? (
                        <span className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5" />
                          {item.label}
                        </span>
                      ) : (
                        <span>{item.label}</span>
                      )}

                      {/* 快捷键 */}
                      {item.shortcut && (
                        <span className="ml-auto text-xs tracking-widest opacity-60">
                          {item.shortcut}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* 页面信息（字数/块数/编辑时间），对齐截图底部统计区 */}
        {(typeof wordCount === "number" || typeof blockCount === "number" || lastEditedAt) && (
          <div className="border-t px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            {typeof wordCount === "number" && <div>字数统计: {wordCount}</div>}
            {typeof blockCount === "number" && <div>块数统计: {blockCount}</div>}
            {createdAt && <div>创建于 {new Date(createdAt).toLocaleDateString("zh-CN")}</div>}
            {lastEditedAt && (
              <div className="mt-1.5">最后编辑于 {lastEditedAt.toLocaleString("zh-CN")}</div>
            )}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
