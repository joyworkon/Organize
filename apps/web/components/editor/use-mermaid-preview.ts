"use client";

import { useEffect, useRef, useState } from "react";
import { renderMermaidPreview } from "./mermaid-render";

export interface MermaidPreviewState {
  svg: string;
  error: string | null;
  /** 有一次渲染在排队或进行中；配合 svg 为空时显示「正在渲染」 */
  pending: boolean;
}

export interface MermaidPreviewOptions {
  /** 编辑浮层用 >0 做实时预览节流；块内默认 0 立即渲染 */
  debounceMs?: number;
  /** false 时不渲染并清空（浮层关闭后不保留上一块的图） */
  enabled?: boolean;
  /** 渲染失败时保留上一张成功的 svg（浮层用）；块内默认清空走源码回退 */
  keepLastSvg?: boolean;
}

const IDLE: MermaidPreviewState = { svg: "", error: null, pending: false };

export function useMermaidPreview(code: string, { debounceMs = 0, enabled = true, keepLastSvg = false }: MermaidPreviewOptions = {}): MermaidPreviewState {
  const [state, setState] = useState<MermaidPreviewState>(IDLE);
  // 只采纳最后一次发起的渲染结果，防止慢的旧结果覆盖新的
  const sequence = useRef(0);

  useEffect(() => {
    const run = ++sequence.current;
    if (!enabled || typeof window === "undefined") {
      setState(IDLE);
      return;
    }
    const text = code.trim();
    if (!text) {
      setState(IDLE);
      return;
    }
    setState((prev) => (prev.pending ? prev : { ...prev, pending: true }));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const render = () => {
      timer = null;
      void renderMermaidPreview(text).then((result) => {
        if (run !== sequence.current) return;
        setState((prev) =>
          result.error === null
            ? { svg: result.svg, error: null, pending: false }
            : { svg: keepLastSvg ? prev.svg : "", error: result.error, pending: false },
        );
      });
    };
    if (debounceMs > 0) timer = setTimeout(render, debounceMs);
    else render();
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [code, debounceMs, enabled, keepLastSvg]);

  return state;
}
