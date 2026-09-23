"use client";

/**
 * 资料来源可达性（阶段 E；阶段 5 修正状态机）。
 *
 * 语义（任务书 §十）：来源删除/无权限/失效时显示来源状态，
 * 已有合法快照继续可见——可达性只影响角标与「更新快照/打开来源」
 * 的可用性，绝不影响快照内容本身。
 *
 * 状态机（阶段 5 修正：此前把查询失败一律判成「来源不可用」）：
 *   - "loading"：探测请求在途（渲染按可用处理，避免闪烁）；
 *   - "ok"：RLS 可达（存在且未软删）；
 *   - "missing"：查询成功但行不在结果里——软删/硬删/无权限，真实「来源不可用」；
 *   - "error"：查询本身失败（网络断、服务异常）——状态未知，不是来源被删；
 *     UI 显示「来源状态未知」，操作按钮保持可用（可重试探测）。
 * 任何状态都不隐藏已保存的画布快照。
 */

import { useEffect, useMemo, useState } from "react";
import type { CanvasDoc, CanvasSourceRef } from "@/lib/canvas/model";
import { collectSourceRefs, sourceRefKey } from "@/lib/canvas/source-ref";
import { createClient } from "@/lib/supabase/client";

export type SourceStatus = "loading" | "ok" | "missing" | "error";

/**
 * key = "kind:id"；探测中/未探测按 "loading"（渲染按可用处理，避免闪烁与误报）。
 */
export type SourceStatusMap = Map<string, SourceStatus>;

export function useSourceStatus(doc: CanvasDoc): SourceStatusMap {
  const refs = useMemo(() => collectSourceRefs(doc), [doc]);
  const [statuses, setStatuses] = useState<SourceStatusMap>(new Map());
  /** 网络错误的探测批次号：递增触发重试 */
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    const readingIds = refs.filter((r) => r.kind === "reading").map((r) => r.id);
    const memoIds = refs.filter((r) => r.kind === "memo").map((r) => r.id);
    if (readingIds.length === 0 && memoIds.length === 0) {
      setStatuses(new Map());
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      const next: SourceStatusMap = new Map();
      // RLS：无权限/已删除的行查不到 → missing；查询失败 → error（状态未知）
      if (readingIds.length > 0) {
        const { data, error } = await supabase
          .from("reading_items")
          .select("id")
          .in("id", readingIds)
          // 显式排除软删行：reading_items 的 RLS 自带该条件（双层保险），
          // memos 的 RLS 没有（055）——不显式过滤会把软删来源误判为可达
          .is("deleted_at", null);
        const found = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
        for (const id of readingIds) {
          next.set(
            sourceRefKey("reading", id),
            error ? "error" : found.has(id) ? "ok" : "missing",
          );
        }
      }
      if (memoIds.length > 0) {
        const { data, error } = await supabase
          .from("memos")
          .select("id")
          .in("id", memoIds)
          .is("deleted_at", null);
        const found = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
        for (const id of memoIds) {
          next.set(
            sourceRefKey("memo", id),
            error ? "error" : found.has(id) ? "ok" : "missing",
          );
        }
      }
      if (!cancelled) setStatuses(next);
    })();
    return () => {
      cancelled = true;
    };
    // refs 由 useMemo 按文档稳定；retryTick 供 error 态自动重探
  }, [refs, retryTick]);

  /** 网络错误时用户可重试探测（依赖 refs 稳定引用，仅 error 才提供重试入口） */
  const hasError = useMemo(
    () => [...statuses.values()].some((status) => status === "error"),
    [statuses],
  );
  useEffect(() => {
    if (!hasError) return;
    const timer = setTimeout(() => setRetryTick((tick) => tick + 1), 15_000);
    return () => clearTimeout(timer);
  }, [hasError, statuses]);

  return statuses;
}

/**
 * 渲染辅助：取单个引用的状态。
 * 未探测/在途返回 "loading"（渲染按可用处理——绝不因探测在途隐藏快照或误报不可用）。
 */
export function statusOf(map: SourceStatusMap, ref: CanvasSourceRef): SourceStatus {
  return map.get(sourceRefKey(ref.kind, ref.id)) ?? "loading";
}
