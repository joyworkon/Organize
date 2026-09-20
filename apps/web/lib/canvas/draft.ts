/**
 * 画布草稿与本机图片存储（docs/idea-canvas-plan.md §6.4）。
 *
 * IndexedDB（库 organize-canvas）：
 * - drafts：按 `${userId}:${docId}` 隔离的草稿（文档 + 基础修订号 + 本地序号）
 * - blobs：按 `${userId}:${key}` 隔离的图片 Blob（mock 图片与真实待重试上传）
 *
 * 登出/切账号不混用草稿（key 含 userId）。IndexedDB 不可用时退化为内存
 * Map（仅会话内有效，用于测试与 SSR 保护）。
 */

import type { CanvasDoc } from "./model";

const DB_NAME = "organize-canvas";
const DB_VERSION = 1;
const DRAFT_STORE = "drafts";
const BLOB_STORE = "blobs";

export interface CanvasDraft {
  docId: string;
  userId: string;
  title: string;
  doc: CanvasDoc;
  /** 保存成功时的服务端修订号；草稿领先它的部分即未同步更改。 */
  savedRevision: number;
  /** 本地更改序号（每次结构/文本变更 +1），用于判断草稿是否领先远端。 */
  localSeq: number;
  updatedAt: number;
}

function draftKey(userId: string, docId: string): string {
  return `${userId}:${docId}`;
}

let memoryDrafts: Map<string, CanvasDraft> | null = null;
let memoryBlobs: Map<string, Blob> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE);
        if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 请求失败"));
  });
}

export async function saveDraft(draft: CanvasDraft): Promise<void> {
  console.log("[canvas-dbg] saveDraft enter", draft.docId, draft.localSeq);
  const db = await openDb();
  if (!db) {
    memoryDrafts ??= new Map();
    memoryDrafts.set(draftKey(draft.userId, draft.docId), draft);
    return;
  }
  try {
    const tx = db.transaction(DRAFT_STORE, "readwrite");
    await reqAsPromise(tx.objectStore(DRAFT_STORE).put(draft, draftKey(draft.userId, draft.docId)));
  } catch (error) {
    console.log("[canvas-dbg] saveDraft FAILED", String(error));
    console.warn("[canvas] 草稿写入 IndexedDB 失败，回退内存", error);
    memoryDrafts ??= new Map();
    memoryDrafts.set(draftKey(draft.userId, draft.docId), draft);
  }
}

export async function loadDraft(userId: string, docId: string): Promise<CanvasDraft | null> {
  const db = await openDb();
  if (!db) return memoryDrafts?.get(draftKey(userId, docId)) ?? null;
  try {
    const tx = db.transaction(DRAFT_STORE, "readonly");
    const draft = await reqAsPromise(tx.objectStore(DRAFT_STORE).get(draftKey(userId, docId)));
    return (draft as CanvasDraft | undefined) ?? null;
  } catch {
    return memoryDrafts?.get(draftKey(userId, docId)) ?? null;
  }
}

export async function deleteDraft(userId: string, docId: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    memoryDrafts?.delete(draftKey(userId, docId));
    return;
  }
  try {
    const tx = db.transaction(DRAFT_STORE, "readwrite");
    await reqAsPromise(tx.objectStore(DRAFT_STORE).delete(draftKey(userId, docId)));
  } catch {
    memoryDrafts?.delete(draftKey(userId, docId));
  }
}

// ---------------------------------------------------------------------------
// 本机图片 Blob（mock 图片 / 真实待重试上传）
// ---------------------------------------------------------------------------

export async function putBlob(userId: string, key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) {
    memoryBlobs ??= new Map();
    memoryBlobs.set(draftKey(userId, key), blob);
    return;
  }
  try {
    const tx = db.transaction(BLOB_STORE, "readwrite");
    await reqAsPromise(tx.objectStore(BLOB_STORE).put(blob, draftKey(userId, key)));
  } catch {
    memoryBlobs ??= new Map();
    memoryBlobs.set(draftKey(userId, key), blob);
  }
}

export async function getBlob(userId: string, key: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return memoryBlobs?.get(draftKey(userId, key)) ?? null;
  try {
    const tx = db.transaction(BLOB_STORE, "readonly");
    const blob = await reqAsPromise(tx.objectStore(BLOB_STORE).get(draftKey(userId, key)));
    return (blob as Blob | undefined) ?? null;
  } catch {
    return memoryBlobs?.get(draftKey(userId, key)) ?? null;
  }
}

export async function deleteBlob(userId: string, key: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    memoryBlobs?.delete(draftKey(userId, key));
    return;
  }
  try {
    const tx = db.transaction(BLOB_STORE, "readwrite");
    await reqAsPromise(tx.objectStore(BLOB_STORE).delete(draftKey(userId, key)));
  } catch {
    memoryBlobs?.delete(draftKey(userId, key));
  }
}
