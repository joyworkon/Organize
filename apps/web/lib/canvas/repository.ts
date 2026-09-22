/**
 * 构思画布服务端仓库封装（docs/idea-canvas-plan.md §6.3/§6.4）。
 *
 * 全部走 /api/canvases（mock 下由 lib/mock/api-shim.ts 拦截，响应形状与真实
 * 路由逐字段对齐）。PATCH 基于 expectedRevision 的原子 CAS；409 时返回
 * 服务端当前 revision 供冲突恢复。
 */

import type { CanvasDoc } from "./model";
import { ensureCanvasDocV2 } from "./model";

export interface CanvasListItem {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface CanvasRow extends CanvasListItem {
  content: CanvasDoc;
  revision: number;
}

export type PatchOutcome =
  | { ok: true; revision: number; updated_at: string }
  | { ok: false; reason: "conflict"; currentRevision: number }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "unauthorized" }
  | { ok: false; reason: "invalid"; errors: string[] }
  | { ok: false; reason: "network" };

async function requestJson<T>(url: string, init?: RequestInit): Promise<
  { ok: true; status: number; data: T } | { ok: false; status: number; data: unknown }
> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) return { ok: false, status: res.status, data };
    return { ok: true, status: res.status, data: data as T };
  } catch {
    // 网络错误统一按 0 状态处理
    return { ok: false, status: 0, data: null };
  }
}

export async function listCanvases(): Promise<CanvasListItem[] | null> {
  const res = await requestJson<{ canvases: CanvasListItem[] }>("/api/canvases");
  return res.ok ? res.data.canvases : null;
}

export async function getCanvas(id: string): Promise<
  { ok: true; row: CanvasRow } | { ok: false; reason: "not-found" | "unauthorized" | "network" }
> {
  const res = await requestJson<CanvasRow>(`/api/canvases/${id}`);
  // B1：读取侧统一走 ensureCanvasDocV2（v1 备份/旧数据自动迁移为 v2）
  if (res.ok) {
    res.data.content = ensureCanvasDocV2(res.data.content);
    return { ok: true, row: res.data };
  }
  if (res.status === 404) return { ok: false, reason: "not-found" };
  if (res.status === 401) return { ok: false, reason: "unauthorized" };
  return { ok: false, reason: "network" };
}

export interface CreateCanvasInput {
  id: string; // 客户端生成 UUID（幂等）
  title?: string;
  content: CanvasDoc;
}

export async function createCanvas(
  input: CreateCanvasInput,
): Promise<
  { ok: true; row: CanvasRow; created: boolean } | { ok: false; reason: "conflict" | "unauthorized" | "invalid" | "network" }
> {
  const res = await requestJson<CanvasRow | { id: string }>("/api/canvases", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (res.ok) {
    const created = res.status === 201;
    // 幂等命中既有行时补拉完整内容
    if (!created) {
      const full = await getCanvas(input.id);
      if (full.ok) return { ok: true, row: full.row, created: false };
      return { ok: false, reason: "network" };
    }
    return { ok: true, row: res.data as CanvasRow, created };
  }
  if (res.status === 401) return { ok: false, reason: "unauthorized" };
  if (res.status === 409) return { ok: false, reason: "conflict" };
  if (res.status === 400) return { ok: false, reason: "invalid" };
  return { ok: false, reason: "network" };
}

export async function patchCanvas(
  id: string,
  payload: { title?: string; content?: CanvasDoc; expectedRevision: number },
): Promise<PatchOutcome> {
  const res = await requestJson<{ revision: number; updated_at: string } | { error: string; current?: { revision: number }; errors?: string[] }>(
    `/api/canvases/${id}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
  if (res.ok) {
    const data = res.data as { revision: number; updated_at: string };
    return { ok: true, revision: data.revision, updated_at: data.updated_at };
  }
  const body = res.data as { current?: { revision: number }; errors?: string[] } | null;
  if (res.status === 409) {
    return { ok: false, reason: "conflict", currentRevision: body?.current?.revision ?? -1 };
  }
  if (res.status === 404) return { ok: false, reason: "not-found" };
  if (res.status === 401) return { ok: false, reason: "unauthorized" };
  if (res.status === 400) return { ok: false, reason: "invalid", errors: body?.errors ?? [] };
  return { ok: false, reason: "network" };
}

/** 软删除（进垃圾箱）。恢复走 /api/trash 的 mutate RPC。 */
export async function deleteCanvas(id: string): Promise<{ ok: boolean; reason?: string }> {
  const res = await requestJson<{ success: boolean }>(`/api/canvases/${id}`, { method: "DELETE" });
  if (res.ok) return { ok: true };
  if (res.status === 401) return { ok: false, reason: "unauthorized" };
  if (res.status === 404) return { ok: false, reason: "not-found" };
  return { ok: false, reason: "network" };
}

/** 复制文档：新建一条带同样内容的记录。 */
export async function duplicateCanvas(
  row: CanvasRow,
  newId: string,
): Promise<{ ok: true; row: CanvasRow } | { ok: false; reason: string }> {
  const res = await createCanvas({ id: newId, title: `${row.title || "未命名画布"} 副本`, content: row.content });
  if (res.ok) return { ok: true, row: res.row };
  return { ok: false, reason: res.reason };
}
