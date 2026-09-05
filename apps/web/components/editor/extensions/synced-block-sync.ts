"use client";

import type { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

/**
 * 同步块的传输与事务判定，独立于 React 组件以便行为测试：
 * - HTTP 状态先行，再验证响应形状；401/403/404/500/坏 JSON 都不进入成功分支
 * - 远端内容替换使用明确事务 meta（organizeSyncedRemote）+ 不进历史，
 *   本地监听器识别该 meta 后不再回写，杜绝同文档广播回声
 * - 广播消息带 origin（会话 id）+ 单调 seq；来源识别取代“1 秒窗口”
 */

export const SYNCED_REMOTE_META = "organizeSyncedRemote";

export interface SyncMessage {
  syncedId: string;
  content: JSONContent[];
  updatedAt: string;
  /** 发送方会话 id；接收方据此忽略自己的消息 */
  origin: string;
  /** 发送方本地单调序号，用于丢弃乱序/重放 */
  seq: number;
}

export function createSyncSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function isRemoteSyncTransaction(tr: Pick<Transaction, "getMeta" | "docChanged">): boolean {
  return Boolean(tr.getMeta(SYNCED_REMOTE_META));
}

function nodeToContent(node: { toJSON: () => JSONContent }): JSONContent[] {
  const json = node.toJSON();
  return Array.isArray(json.content) ? json.content : [];
}

/**
 * 判定一笔事务是否需要把同步块写回服务端。
 * pos 是事务后（新文档）坐标——transaction 监听器触发时 getPos() 已是新 doc 位置；
 * 旧文档侧用 tr.mapping.invert() 映射回去。
 * - 无 docChanged（光标/选区）→ false
 * - 远端同步 meta（含注水/广播回写）→ false，不回声
 * - 前后不是同一个同步块（被删除/被替换）→ false，无内容可写
 * - 仅属性变化（如 hydrated 标记）→ false；内容 JSON 真正变化才为 true
 */
export function syncedBlockNeedsSync(
  tr: Transaction,
  newPos: number
): { changed: boolean } {
  if (!tr.docChanged) return { changed: false };
  if (isRemoteSyncTransaction(tr)) return { changed: false };
  const after = tr.doc.nodeAt(newPos);
  if (!after || after.type.name !== "syncedBlock") return { changed: false };
  const before = tr.before.nodeAt(tr.mapping.invert().map(newPos));
  if (!before || before.type.name !== "syncedBlock") return { changed: false };
  if (String(before.attrs?.syncedId || "") !== String(after.attrs?.syncedId || "")) {
    return { changed: false };
  }
  const beforeJson = nodeToContent(before);
  const afterJson = nodeToContent(after);
  return { changed: JSON.stringify(beforeJson) !== JSON.stringify(afterJson) };
}

/** 用服务端内容替换 pos 处同步块的子节点；带远端 meta 且不进 Undo 历史。 */
export function replaceSyncedBlockContent(
  editor: Editor,
  pos: number,
  content: JSONContent[],
  syncedId: string
): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const start = pos + 1;
  const end = pos + node.nodeSize - 1;
  const tr = editor.state.tr
    .setMeta(SYNCED_REMOTE_META, { syncedId })
    .setMeta("addToHistory", false)
    .replaceWith(start, end, content.map((c) => editor.schema.nodeFromJSON(c)));
  editor.view.dispatch(tr);
  return true;
}

export type SyncWriteResult =
  | { ok: true; updatedAt: string }
  | { ok: false; reason: "http" | "network" | "shape"; status?: number };

/** PATCH 当前块内容；只有服务器确认成功（2xx 且形状正确）才算 ok。 */
export async function patchSyncedBlock(
  syncedId: string,
  content: JSONContent[]
): Promise<SyncWriteResult> {
  try {
    const res = await fetch(`/api/synced-blocks/${encodeURIComponent(syncedId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) return { ok: false, reason: "http", status: res.status };
    const data: unknown = await res.json().catch(() => null);
    if (!data || typeof data !== "object") return { ok: false, reason: "shape" };
    const updatedAt = (data as { updated_at?: unknown }).updated_at;
    return {
      ok: true,
      updatedAt: typeof updatedAt === "string" ? updatedAt : new Date().toISOString(),
    };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export type SyncFetchResult =
  | { ok: true; content: JSONContent[]; updatedAt: string | null }
  | { ok: false; reason: "http" | "network" | "shape" | "not-found"; status?: number };

/** 拉取服务端最新内容；401/403/500、坏 JSON、缺行、内容非数组都不算成功。 */
export async function fetchSyncedBlock(syncedId: string): Promise<SyncFetchResult> {
  try {
    const res = await fetch(`/api/synced-blocks?ids=${encodeURIComponent(syncedId)}`);
    if (!res.ok) return { ok: false, reason: "http", status: res.status };
    const data: unknown = await res.json().catch(() => null);
    if (!Array.isArray(data)) return { ok: false, reason: "shape" };
    const row = data.find(
      (r): r is { id: string; content: unknown; updated_at?: string } =>
        !!r && typeof r === "object" && (r as { id?: unknown }).id === syncedId
    );
    if (!row) return { ok: false, reason: "not-found" };
    if (!Array.isArray(row.content)) return { ok: false, reason: "shape" };
    return {
      ok: true,
      content: row.content as JSONContent[],
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/**
 * 判定是否接受一条广播消息：忽略自己 origin 的消息（同页 CustomEvent 回声）；
 * 同一 origin 的乱序/重放（seq 不大于已见最大值）也忽略。
 * 新返回 boolean 时同时更新 lastSeqByOrigin。
 */
export function shouldAcceptSyncMessage(
  message: SyncMessage | null | undefined,
  ownOrigin: string,
  lastSeqByOrigin: Map<string, number>
): boolean {
  if (!message || typeof message.origin !== "string" || !message.syncedId) return false;
  if (message.origin === ownOrigin) return false;
  const last = lastSeqByOrigin.get(message.origin);
  if (typeof message.seq !== "number" || Number.isNaN(message.seq)) return false;
  if (last !== undefined && message.seq <= last) return false;
  lastSeqByOrigin.set(message.origin, message.seq);
  return true;
}
