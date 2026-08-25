"use client";

import { useEffect, useState } from "react";

/**
 * 防抖值：value 变化后延迟 delay ms 才更新返回值。
 * 用于搜索框等高频输入场景，避免每次击键都触发服务端查询。
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
