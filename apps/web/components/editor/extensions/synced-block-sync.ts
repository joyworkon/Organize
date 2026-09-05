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
  /** 服务端确认的 revision；接收方更新本地乐观锁基准 */
  revision?: number;
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

/** 用服务端内容替换 pos 处同步块的子节点；带远端 meta 且不进 Undo 历史。
 *  空内容回退为空段落（block+ 容器不接受零子节点）。 */
export function replaceSyncedBlockContent(
  editor: Editor,
  pos: number,
  content: JSONContent[],
  syncedId: string
): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const safeContent = content.length > 0 ? content : [{ type: "paragraph" }];
  const start = pos + 1;
  const end = pos + node.nodeSize - 1;
  const tr = editor.state.tr
    .setMeta(SYNCED_REMOTE_META, { syncedId })
    .setMeta("addToHistory", false)
    .replaceWith(start, end, safeContent.map((c) => editor.schema.nodeFromJSON(c)));
  editor.view.dispatch(tr);
  return true;
}

export type SyncWriteResult =
  | { ok: true; revision: number; updatedAt: string }
  | {
      ok: false;
      reason: "conflict";
      /** 服务端当前 revision/content；内容与本地一致时客户端按幂等命中处理 */
      currentRevision: number | null;
      currentContent: JSONContent[] | null;
    }
  | { ok: false; reason: "http" | "network" | "shape" | "not-found"; status?: number };

/**
 * PATCH 当前块内容（带乐观锁）。
 * expectedRevision 为 null 时退化为旧客户端行为（覆盖并递增）；
 * 409 时返回服务端当前 revision/content，由调用方决策（默认不覆盖远端）。
 */
export async function patchSyncedBlock(
  syncedId: string,
  content: JSONContent[],
  expectedRevision: number | null
): Promise<SyncWriteResult> {
  try {
    const res = await fetch(`/api/synced-blocks/${encodeURIComponent(syncedId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, expected_revision: expectedRevision }),
    });
    if (res.status === 409) {
      const data: unknown = await res.json().catch(() => null);
      const current =
        !!data && typeof data === "object"
          ? (data as { current?: { revision?: unknown; content?: unknown } }).current
          : undefined;
      const currentRevision =
        typeof current?.revision === "number" ? current.revision : null;
      const currentContent = Array.isArray(current?.content)
        ? (current?.content as JSONContent[])
        : null;
      return { ok: false, reason: "conflict", currentRevision, currentContent };
    }
    if (!res.ok) return { ok: false, reason: "http", status: res.status };
    const data: unknown = await res.json().catch(() => null);
    if (!data || typeof data !== "object") return { ok: false, reason: "shape" };
    const revision = (data as { revision?: unknown }).revision;
    const updatedAt = (data as { updated_at?: unknown }).updated_at;
    return {
      ok: true,
      revision: typeof revision === "number" ? revision : 1,
      updatedAt: typeof updatedAt === "string" ? updatedAt : new Date().toISOString(),
    };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export type SyncFetchResult =
  | { ok: true; content: JSONContent[]; revision: number; updatedAt: string | null }
  | { ok: false; reason: "http" | "network" | "shape" | "not-found"; status?: number };

/** 拉取服务端最新内容；401/403/500、坏 JSON、缺行、内容非数组都不算成功。 */
export async function fetchSyncedBlock(syncedId: string): Promise<SyncFetchResult> {
  try {
    const res = await fetch(`/api/synced-blocks?ids=${encodeURIComponent(syncedId)}`);
    if (!res.ok) return { ok: false, reason: "http", status: res.status };
    const data: unknown = await res.json().catch(() => null);
    if (!Array.isArray(data)) return { ok: false, reason: "shape" };
    const row = data.find(
      (r): r is { id: string; content: unknown; revision?: unknown; updated_at?: unknown } =>
        !!r && typeof r === "object" && (r as { id?: unknown }).id === syncedId
    );
    if (!row) return { ok: false, reason: "not-found" };
    if (!Array.isArray(row.content)) return { ok: false, reason: "shape" };
    return {
      ok: true,
      content: row.content as JSONContent[],
      revision: typeof row.revision === "number" ? row.revision : 1,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    };
  } catch {
    return { ok: false, reason: "network" };
  }
}

/** 409 决策：服务端内容与本地待写一致 → 幂等命中（重试场景）；否则为真实冲突。 */
export function classifyConflict(
  currentContent: JSONContent[] | null,
  pendingContent: JSONContent[]
): "idempotent-hit" | "conflict" {
  if (currentContent && JSON.stringify(currentContent) === JSON.stringify(pendingContent)) {
    return "idempotent-hit";
  }
  return "conflict";
}

// ---------- pending 快照持久化（离线改 → 关页 → 重开恢复） ----------

const PENDING_PREFIX = "organize:synced-pending:";

export interface StoredSyncedPending {
  version: 1;
  syncedId: string;
  userId: string;
  revision: number | null;
  content: JSONContent[];
  savedAt: string;
}

function pendingStorageKey(userId: string, syncedId: string): string {
  return `${PENDING_PREFIX}${userId}:${syncedId}`;
}

/**
 * 读取持久化的待同步快照；键含 userId，换账号天然隔离；
 * 数据损坏一律视为不存在，不把别人的 pending 写进自己的块。
 */
export function readSyncedPending(
  storage: Pick<Storage, "getItem">,
  userId: string,
  syncedId: string
): StoredSyncedPending | null {
  try {
    const raw = storage.getItem(pendingStorageKey(userId, syncedId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredSyncedPending>;
    if (
      value.version !== 1
      || value.syncedId !== syncedId
      || typeof value.userId !== "string"
      || value.userId !== userId
      || !Array.isArray(value.content)
    ) {
      return null;
    }
    return {
      version: 1,
      syncedId,
      userId,
      revision: typeof value.revision === "number" ? value.revision : null,
      content: value.content,
      savedAt: typeof value.savedAt === "string" ? value.savedAt : "",
    };
  } catch {
    return null;
  }
}

/** 持久化待同步快照；写入失败不抛出（保持内存 pending 即可，页面摘要仍显示待同步）。 */
export function writeSyncedPending(
  storage: Pick<Storage, "setItem">,
  pending: StoredSyncedPending
): boolean {
  try {
    storage.setItem(pendingStorageKey(pending.userId, pending.syncedId), JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export function clearSyncedPending(
  storage: Pick<Storage, "removeItem">,
  userId: string,
  syncedId: string
): void {
  try {
    storage.removeItem(pendingStorageKey(userId, syncedId));
  } catch {
    // 清理失败最多留下一条孤儿 pending，下次 flush 成功会再清
  }
}

// ---------- 页面保存摘要事件 ----------

/**
 * 块 pending 状态变化广播给页面（笔记页顶栏聚合显示“N 个同步块待同步”），
 * 页面不得在存在未同步块时宣称全部已同步。
 */
export function emitSyncedBlockStatus(syncedId: string, pending: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("organize:synced-block-status", {
      detail: { syncedId, pending },
    })
  );
}

// ---------- 当前用户 id（pending 持久化的账号隔离） ----------

let cachedUserIdPromise: Promise<string | null> | null = null;

/** 获取当前登录用户 id；未登录/不可用返回 null（此时不做 pending 持久化）。
 *  只缓存成功结果：auth 未就绪时的 null 不永久缓存，登出换号可重新解析。 */
export function getSyncedUserId(): Promise<string | null> {
  if (!cachedUserIdPromise) {
    const promise = (async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const {
          data: { user },
        } = await createClient().auth.getUser();
        return user?.id ?? null;
      } catch {
        return null;
      }
    })();
    promise.then(
      (id) => {
        if (!id) cachedUserIdPromise = null;
      },
      () => {
        cachedUserIdPromise = null;
      }
    );
    cachedUserIdPromise = promise;
  }
  return cachedUserIdPromise;
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
