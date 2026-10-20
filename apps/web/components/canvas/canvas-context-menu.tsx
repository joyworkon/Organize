"use client";

import { Fragment, useEffect } from "react";
import {
  CheckSquare,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Maximize2,
  Trash2,
} from "@/components/icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuIcon,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  useContextMenu,
} from "@/components/ui/context-menu";
import { ArrangeIcon, FREE_ARRANGE_CONTROLS } from "./canvas-arrange";
import { isFreeArrangeAction, type FreeArrangeActionId } from "./free-item-actions";
import type { CanvasSelection } from "./canvas-store";

export type CanvasContextTarget =
  | { kind: "native" }
  | { kind: "free"; itemId: string }
  | { kind: "block"; blockId: string }
  | { kind: "region"; boardId: string; regionId: string }
  | { kind: "board"; boardId: string }
  | { kind: "canvas" };

export type CanvasContextMenuAction =
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "delete"
  | "select-all"
  | "zoom-fit"
  | FreeArrangeActionId;

export interface CanvasContextMenuEntry {
  id: string;
  label: string;
  shortcut: string;
  disabled: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  /** 分组标题，不是可点的菜单项。 */
  heading?: boolean;
  title?: string;
}

function isMenuCommand(id: string): id is CanvasContextMenuAction {
  return id === "copy"
    || id === "cut"
    || id === "paste"
    || id === "duplicate"
    || id === "delete"
    || id === "select-all"
    || id === "zoom-fit"
    || isFreeArrangeAction(id);
}

export interface CanvasContextMenuPoint {
  x: number;
  y: number;
  world: { x: number; y: number };
  scope: "canvas" | "element";
}

export interface CanvasContextMenuRequest extends CanvasContextMenuPoint {
  nonce: number;
}

function elementFromEventTarget(node: EventTarget | null): Element | null {
  if (node instanceof Element) return node;
  if (node instanceof Text) return node.parentElement;
  return null;
}

function ownContentEditable(el: Element): "true" | "false" | "inherit" {
  const host = el as HTMLElement;
  const prop = typeof host.contentEditable === "string" ? host.contentEditable.toLowerCase() : "";
  if (prop === "true" || prop === "plaintext-only") return "true";
  if (prop === "false") return "false";
  const raw = el.getAttribute("contenteditable");
  if (raw == null) return "inherit";
  const value = raw.toLowerCase();
  if (value === "" || value === "true" || value === "plaintext-only") return "true";
  if (value === "false") return "false";
  return "inherit";
}

/** 文本块、输入框、contentEditable 保持浏览器原生菜单和剪贴板。 */
export function isNativeEditTarget(node: EventTarget | null): boolean {
  const el = elementFromEventTarget(node);
  if (!el) return false;
  if (el.closest("input, textarea, select")) return true;
  const host = el as HTMLElement;
  // 浏览器的 isContentEditable 已包含继承。jsdom 没有这个值，改看属性和 contenteditable。
  if (typeof host.isContentEditable === "boolean") return host.isContentEditable;
  let current: Element | null = el;
  while (current) {
    const state = ownContentEditable(current);
    if (state === "true") return true;
    if (state === "false") return false;
    current = current.parentElement;
  }
  return false;
}

/** 自由元素优先于内部块，避免右键自由文本被当成版面模块。 */
export function resolveCanvasContextTarget(node: EventTarget | null): CanvasContextTarget {
  if (isNativeEditTarget(node)) return { kind: "native" };
  const el = elementFromEventTarget(node);
  if (!el) return { kind: "canvas" };
  const free = el.closest<HTMLElement>("[data-free-item-id]");
  if (free?.dataset.freeItemId) return { kind: "free", itemId: free.dataset.freeItemId };
  const block = el.closest<HTMLElement>("[data-block-id]");
  if (block?.dataset.blockId) return { kind: "block", blockId: block.dataset.blockId };
  const region = el.closest<HTMLElement>("[data-region-id]");
  if (region?.dataset.regionId) {
    const board = region.closest<HTMLElement>("[data-board-id]");
    if (board?.dataset.boardId) {
      return { kind: "region", boardId: board.dataset.boardId, regionId: region.dataset.regionId };
    }
  }
  const board = el.closest<HTMLElement>("[data-board-id]");
  if (board?.dataset.boardId) return { kind: "board", boardId: board.dataset.boardId };
  return { kind: "canvas" };
}

/** 右键目标已在当前多选里时保持多选，否则改成这个目标。 */
export function selectionForContextTarget(
  current: CanvasSelection,
  target: Exclude<CanvasContextTarget, { kind: "native" } | { kind: "canvas" }>,
): CanvasSelection {
  if (target.kind === "block") {
    if (current?.kind === "block" && current.blockId === target.blockId) return current;
    if (current?.kind === "blocks" && current.blockIds.includes(target.blockId)) return current;
    return { kind: "block", blockId: target.blockId };
  }
  if (target.kind === "free") {
    if (current?.kind === "free" && current.itemId === target.itemId) return current;
    if (current?.kind === "frees" && current.itemIds.includes(target.itemId)) return current;
    return { kind: "free", itemId: target.itemId };
  }
  if (target.kind === "region") {
    if (current?.kind === "region" && current.boardId === target.boardId && current.regionId === target.regionId) {
      return current;
    }
    return { kind: "region", boardId: target.boardId, regionId: target.regionId };
  }
  if (current?.kind === "board" && current.boardId === target.boardId) return current;
  return { kind: "board", boardId: target.boardId };
}

function canCopySelection(selection: CanvasSelection): boolean {
  return selection?.kind === "block"
    || selection?.kind === "blocks"
    || selection?.kind === "free"
    || selection?.kind === "frees"
    || selection?.kind === "region";
}

export function canvasContextMenuModel(input: {
  scope: "canvas" | "element";
  selection: CanvasSelection;
  readOnly: boolean;
  hasClipboard: boolean;
  labels: { mod: string; shift: string };
}): CanvasContextMenuEntry[] {
  const { scope, selection, readOnly, hasClipboard, labels } = input;
  if (scope === "canvas") {
    return [
      { id: "paste", label: "粘贴到此处", shortcut: `${labels.mod}V`, disabled: readOnly || !hasClipboard },
      { id: "select-all", label: "全选", shortcut: `${labels.mod}A`, disabled: false },
      { id: "zoom-fit", label: "缩放到适合", shortcut: `${labels.shift}1`, disabled: false },
    ];
  }
  const canCopy = canCopySelection(selection);
  const freeCount = selection?.kind === "free"
    ? 1
    : selection?.kind === "frees"
      ? new Set(selection.itemIds).size
      : 0;
  return [
    { id: "copy", label: "复制", shortcut: `${labels.mod}C`, disabled: !canCopy },
    { id: "cut", label: "剪切", shortcut: `${labels.mod}X`, disabled: readOnly || !canCopy },
    { id: "paste", label: "粘贴", shortcut: `${labels.mod}V`, disabled: readOnly || !hasClipboard },
    { id: "duplicate", label: "创建副本", shortcut: `${labels.mod}D`, disabled: readOnly || !canCopy },
    ...freeArrangeMenuEntries(freeCount, readOnly),
    {
      id: "delete",
      label: "删除",
      shortcut: "⌫",
      disabled: readOnly || !selection,
      destructive: true,
      separatorBefore: true,
    },
  ];
}

function freeArrangeMenuEntries(count: number, readOnly: boolean): CanvasContextMenuEntry[] {
  if (count < 1) return [];
  const groups = [
    { id: "heading-align", group: "align" as const, label: "对齐", min: 2, need: "至少选择 2 个自由元素" },
    { id: "heading-distribute", group: "distribute" as const, label: "分布", min: 3, need: "至少选择 3 个自由元素" },
    { id: "heading-layer", group: "layer" as const, label: "图层", min: 1, need: "" },
  ];
  const rows: CanvasContextMenuEntry[] = [];
  for (const group of groups) {
    rows.push({
      id: group.id,
      label: group.label,
      shortcut: "",
      disabled: true,
      separatorBefore: true,
      heading: true,
    });
    for (const control of FREE_ARRANGE_CONTROLS) {
      if (control.group !== group.group) continue;
      const blocked = readOnly || count < group.min;
      rows.push({
        id: control.id,
        label: control.label,
        shortcut: "",
        disabled: blocked,
        title: blocked ? (readOnly ? "只读时不能调整自由元素" : group.need) : control.title,
      });
    }
  }
  return rows;
}

function MenuIcon({ id }: { id: string }) {
  const className = "h-4 w-4";
  if (isFreeArrangeAction(id)) return <ArrangeIcon id={id} className={className} />;
  if (id === "copy") return <Copy className={className} />;
  if (id === "cut") return <span aria-hidden="true" className="text-sm leading-none">✂</span>;
  if (id === "paste") return <ClipboardPaste className={className} />;
  if (id === "duplicate") return <CopyPlus className={className} />;
  if (id === "delete") return <Trash2 className={className} />;
  if (id === "select-all") return <CheckSquare className={className} />;
  return <Maximize2 className={className} />;
}

function MenuOpener({ request }: { request: CanvasContextMenuRequest }) {
  const { openMenu } = useContextMenu();
  useEffect(() => {
    openMenu({ x: request.x, y: request.y });
  }, [openMenu, request]);
  return null;
}

export function CanvasClipboardMenu({
  request,
  entries,
  onSelect,
}: {
  request: CanvasContextMenuRequest;
  entries: CanvasContextMenuEntry[];
  onSelect: (action: CanvasContextMenuAction) => void;
}) {
  return (
    <ContextMenu>
      <MenuOpener request={request} />
      <ContextMenuContent role="menu" data-testid="canvas-context-menu" className="min-w-56">
        {entries.map((entry) => (
          <Fragment key={entry.id}>
            {entry.separatorBefore ? <ContextMenuSeparator /> : null}
            {entry.heading ? (
              <div role="presentation" className="px-2 pb-0.5 pt-1.5 text-xs font-medium text-muted-foreground">
                {entry.label}
              </div>
            ) : (
              <ContextMenuItem
                disabled={entry.disabled}
                title={entry.title}
                className={entry.destructive
                  ? "text-destructive focus:text-destructive focus:bg-destructive/10"
                  : entry.disabled && entry.title
                    ? "data-[disabled]:pointer-events-auto"
                    : undefined}
                onSelect={() => {
                  if (isMenuCommand(entry.id)) onSelect(entry.id);
                }}
              >
                <ContextMenuIcon className={entry.destructive ? "text-destructive" : undefined}>
                  <MenuIcon id={entry.id} />
                </ContextMenuIcon>
                {entry.label}
                {entry.shortcut ? <ContextMenuShortcut>{entry.shortcut}</ContextMenuShortcut> : null}
              </ContextMenuItem>
            )}
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}
