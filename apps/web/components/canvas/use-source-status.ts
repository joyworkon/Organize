"use client";

/**
 * 资料来源可达性（阶段 E）：文档加载后按 sourceRef 的 kind+id 分批探测
 * 来源是否仍然存在且当前用户有权访问。
 *
 * 语义（任务书 §十）：来源删除/无权限/失效时显示来源状态，
 * 已有合法快照继续可见——可达性只影响角标与「更新快照/打开来源」
 * 的可用性，绝不影响快照内容本身。
 *
 * 探测走 RLS：reading_items / memos 按 id IN 查询，查不到的 id 即
 * 不可达（他人数据被 RLS 隐藏、软删除行被视图/策略排除）。
 * mock 下同一 supabase client 走内存 mockDb，语义一致。
 */

import { useEffect, useMemo, useState } from "react";
import type { CanvasDoc, CanvasSourceRef } from "@/lib/canvas/model";
import { collectSourceRefs, sourceRefKey } from "@/lib/canvas/source-ref";
import { createClient } from "@/lib/supabase/client";

export type SourceStatus = "ok" | "missing";

/** key = "kind:id"；不在 Map 内 = 尚未探测完成（按 ok 渲染，避免闪烁）。 */
export type SourceStatusMap = Map<string, SourceStatus>;

export function useSourceStatus(doc: CanvasDoc): SourceStatusMap {
  const refs = useMemo(() => collectSourceRefs(doc), [doc]);
  const [statuses, setStatuses] = useState<SourceStatusMap>(new Map());

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
      // RLS：无权限/已删除的行查不到 → missing；查得到 → ok
      if (readingIds.length > 0) {
        const { data } = await supabase.from("reading_items").select("id").in("id", readingIds);
        const found = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
        for (const id of readingIds) {
          next.set(sourceRefKey("reading", id), found.has(id) ? "ok" : "missing");
        }
      }
      if (memoIds.length > 0) {
        const { data } = await supabase.from("memos").select("id").in("id", memoIds);
        const found = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
        for (const id of memoIds) {
          next.set(sourceRefKey("memo", id), found.has(id) ? "ok" : "missing");
        }
      }
      if (!cancelled) setStatuses(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [refs]);

  return statuses;
}

/** 渲染辅助：取单个引用的状态（未探测完成按 ok）。 */
export function statusOf(map: SourceStatusMap, ref: CanvasSourceRef): SourceStatus {
  return map.get(sourceRefKey(ref.kind, ref.id)) ?? "ok";
}
