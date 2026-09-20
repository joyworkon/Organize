"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasStore } from "./canvas-store";

/**
 * 订阅 store 的通用 hook：selector 返回值按引用比较，变化才重渲染。
 * selector 需保持稳定（组件内用 useCallback 或传模块级函数）。
 */
export function useCanvasSelector<T>(store: CanvasStore, selector: (state: ReturnType<CanvasStore["getState"]>) => T): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const [value, setValue] = useState(() => selector(store.getState()));
  useEffect(() => {
    let last = selector(store.getState());
    setValue(last);
    return store.subscribe((state) => {
      const next = selectorRef.current(state);
      if (!Object.is(next, last)) {
        last = next;
        setValue(next);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  return value;
}
