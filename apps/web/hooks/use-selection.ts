"use client";

import { useState, useCallback } from "react";

export interface SelectableItem {
  id: string;
}

/**
 * 只保留可见项的选择集裁剪。
 * 返回 null 表示集合无需变化（调用方可复用原引用避免重渲染）。
 */
export function pruneSelection(
  prev: ReadonlySet<string>,
  visibleIds: ReadonlySet<string> | string[]
): Set<string> | null {
  const visible = visibleIds instanceof Set ? visibleIds : new Set(visibleIds);
  let changed = false;
  const next = new Set<string>();
  prev.forEach((id) => {
    if (visible.has(id)) next.add(id);
    else changed = true;
  });
  return changed ? next : null;
}

export function useSelection<T extends SelectableItem>() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const isSelectMode = selectedIds.size > 0;

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const select = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const deselect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  /** 只保留可见项：筛选条件/scope 变化后裁掉不可见的幽灵选择，防止批量操作误伤看不见的数据 */
  const retainOnly = useCallback(
    (visibleIds: ReadonlySet<string> | string[]) => {
      setSelectedIds((prev) => pruneSelection(prev, visibleIds) ?? prev);
    },
    []
  );

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  return {
    selectedIds,
    isSelectMode,
    toggle,
    select,
    deselect,
    selectAll,
    clear,
    retainOnly,
    isSelected,
  };
}
