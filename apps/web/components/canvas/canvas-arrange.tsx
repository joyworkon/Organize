"use client";

import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceBetween,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowUp,
  BringToFront,
  SendToBack,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { reorderFreeZIndexes, type FreeLayerAction } from "@/lib/canvas/free-layers";
import type { CanvasDoc } from "@/lib/canvas/model";
import { hasLockedFreeItems } from "@/lib/canvas/free-lock";
import {
  applyArrangeAction,
  type FreeArrangeActionId,
  type FreeArrangeBox,
} from "./free-item-actions";
import type { CanvasStore } from "./canvas-store";

export interface FreeArrangeControl {
  id: FreeArrangeActionId;
  group: "align" | "distribute" | "layer";
  label: string;
  title: string;
  Icon: LucideIcon;
  layer?: FreeLayerAction;
}

export const FREE_ARRANGE_CONTROLS: readonly FreeArrangeControl[] = [
  { id: "align-left", group: "align", label: "左对齐", title: "按选区左缘对齐", Icon: AlignHorizontalJustifyStart },
  { id: "align-center-x", group: "align", label: "水平居中", title: "按选区水平中线对齐", Icon: AlignHorizontalJustifyCenter },
  { id: "align-right", group: "align", label: "右对齐", title: "按选区右缘对齐", Icon: AlignHorizontalJustifyEnd },
  { id: "align-top", group: "align", label: "顶对齐", title: "按选区上缘对齐", Icon: AlignVerticalJustifyStart },
  { id: "align-center-y", group: "align", label: "垂直居中", title: "按选区垂直中线对齐", Icon: AlignVerticalJustifyCenter },
  { id: "align-bottom", group: "align", label: "底对齐", title: "按选区下缘对齐", Icon: AlignVerticalJustifyEnd },
  { id: "distribute-x", group: "distribute", label: "水平分布", title: "水平间距相等，左右两端不动", Icon: AlignHorizontalSpaceBetween },
  { id: "distribute-y", group: "distribute", label: "垂直分布", title: "垂直间距相等，上下两端不动", Icon: AlignVerticalSpaceBetween },
  { id: "layer-front", group: "layer", label: "置于顶层", title: "放到所有自由元素上面", Icon: BringToFront, layer: "front" },
  { id: "layer-forward", group: "layer", label: "上移一层", title: "与上面紧邻的未选中元素交换", Icon: ArrowUp, layer: "forward" },
  { id: "layer-backward", group: "layer", label: "下移一层", title: "与下面紧邻的未选中元素交换", Icon: ArrowDown, layer: "backward" },
  { id: "layer-back", group: "layer", label: "置于底层", title: "放到所有自由元素下面", Icon: SendToBack, layer: "back" },
];

const GROUPS = [
  { id: "align" as const, label: "对齐", min: 2, need: "至少选择 2 个自由元素" },
  { id: "distribute" as const, label: "分布", min: 3, need: "至少选择 3 个自由元素" },
  { id: "layer" as const, label: "图层", min: 1, need: "" },
];

export function ArrangeIcon({ id, className }: { id: FreeArrangeActionId; className?: string }) {
  const Icon = FREE_ARRANGE_CONTROLS.find((control) => control.id === id)?.Icon;
  if (!Icon) return null;
  return <Icon className={className} aria-hidden="true" />;
}

function layerBlocked(doc: CanvasDoc, itemIds: readonly string[], action: FreeLayerAction): boolean {
  const patches = reorderFreeZIndexes(
    doc.freeItems.map((item) => ({ id: item.id, zIndex: item.zIndex })),
    itemIds,
    action,
  );
  return patches.length === 0;
}

function blockedTitle(control: FreeArrangeControl, countBlocked: boolean, layerStill: boolean, need: string): string {
  if (countBlocked) return need;
  if (!layerStill) return control.title;
  return control.layer === "back" || control.layer === "backward" ? "已经在最下层" : "已经在最上层";
}

export function FreeArrangeToolbar({
  store,
  doc,
  itemIds,
  boxes,
  showAlign,
}: {
  store: CanvasStore;
  doc: CanvasDoc;
  itemIds: readonly string[];
  boxes: readonly FreeArrangeBox[];
  /** 单选只显示图层；多选同时显示对齐和分布。 */
  showAlign: boolean;
}) {
  const count = itemIds.length;
  const locked = hasLockedFreeItems(doc, itemIds);
  const groups = GROUPS.filter((group) => showAlign || group.id === "layer");
  return (
    <>
      {groups.map((group) => {
        const controls = FREE_ARRANGE_CONTROLS.filter((control) => control.group === group.id);
        return (
          <div key={group.id}>
            <h3 className="canvas-prop-subtitle">{group.label}</h3>
            <div role="group" aria-label={group.label} className="canvas-prop-icon-row">
              {controls.map((control) => {
                const countBlocked = count < group.min;
                const layerStill = control.layer ? layerBlocked(doc, itemIds, control.layer) : false;
                const lockBlocked = locked && group.id !== "layer";
                const disabled = lockBlocked || countBlocked || layerStill;
                const title = lockBlocked ? "先解锁再对齐或分布" : blockedTitle(control, countBlocked, layerStill, group.need);
                const Icon = control.Icon;
                return (
                  <span key={control.id} title={title} className="inline-flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 min-h-8 min-w-8 p-0"
                      aria-label={control.label}
                      title={title}
                      disabled={disabled}
                      onClick={() => applyArrangeAction(store, control.id, boxes, itemIds)}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
