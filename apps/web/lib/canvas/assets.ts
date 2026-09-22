/**
 * 画布图片资产编排（docs/idea-canvas-plan.md §6.3/§6.4）。
 *
 * - 真实模式：POST /api/upload（images bucket，5MB 白名单），成功后
 *   uploadStatus="saved"，url=/storage/...；
 * - mock 模式（/api/upload 未实现）：Blob 存 IndexedDB（按账号隔离），
 *   url=mock-image:<key>，刷新后经 resolveAssetUrl 重建对象 URL；
 * - 真实模式上传失败：保留预览（blob: 只在内存），uploadStatus="pending"，
 *   Blob 同样落 IndexedDB 供刷新后恢复与重试；绝不能把临时 blob URL
 *   标成已保存（校验层同时拒绝 blob: 进服务端文档）。
 */

import type { CanvasImageAsset } from "./model";
import { putBlob } from "./draft";

export const MAX_CANVAS_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];

export function isMockBackend(): boolean {
  return process.env.NEXT_PUBLIC_MOCK_BACKEND === "true";
}

export function isAllowedImageType(type: string): boolean {
  return ALLOWED_TYPES.includes(type);
}

/** 读取图片原始尺寸。 */
export function readImageSize(
  file: Blob,
): Promise<{ naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(size);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片解析失败"));
    };
    img.src = url;
  });
}

export interface CanvasUploadOutcome {
  asset: CanvasImageAsset;
  /** 仅供当前会话预览的对象 URL（pending 状态下使用；不入文档持久层）。 */
  previewUrl?: string;
}

export async function uploadCanvasImage(
  file: File,
  userId: string,
): Promise<CanvasUploadOutcome> {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const size = await readImageSize(file);
  const base = {
    naturalWidth: size.naturalWidth,
    naturalHeight: size.naturalHeight,
    name: file.name,
  };

  if (isMockBackend()) {
    // mock：本机 IndexedDB 适配器（有体积限制），刷新可重建 URL
    if (file.size > MAX_CANVAS_IMAGE_BYTES) {
      throw new Error("图片不能超过 5MB");
    }
    // E2E 钩子：模拟在途上传（仅 mock 路径生效，生产无行为变化）
    const delayMs =
      typeof window !== "undefined"
        ? ((window as unknown as { __canvasMockUploadDelayMs?: number }).__canvasMockUploadDelayMs ?? 0)
        : 0;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await putBlob(userId, key, file);
    return { asset: { url: `mock-image:${key}`, ...base, uploadStatus: "saved" } };
  }

  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || "上传失败");
    }
    const data = (await res.json()) as { url: string; name: string };
    return { asset: { url: data.url, ...base, uploadStatus: "saved" } };
  } catch {
    // 真实上传失败：保留预览与待重试状态；Blob 落本机，恢复后可重试
    await putBlob(userId, key, file);
    const previewUrl = URL.createObjectURL(file);
    return {
      asset: { url: "", ...base, uploadStatus: "pending", localKey: key },
      previewUrl,
    };
  }
}

/** 重试一个 pending 资产：从本机取 Blob 重新走上传链路。
 *  已持久化（saved）的资产无需重试，直接返回 null 由调用方跳过。 */
export async function retryPendingAsset(
  asset: CanvasImageAsset,
  localKey: string,
  userId: string,
): Promise<CanvasUploadOutcome | null> {
  if (asset.uploadStatus === "saved") return null;
  const { getBlob } = await import("./draft");
  const blob = await getBlob(userId, localKey);
  if (!blob) return null;
  const file = new File([blob], asset.name || "image", { type: blob.type || "image/png" });
  return uploadCanvasImage(file, userId);
}

/**
 * 文档加载后把资产 url 解析成可渲染地址：
 * - mock-image: → 从 IndexedDB 取 Blob 建对象 URL（找不到返回 null → 占位）
 * - pending + localKey → 同上（预览保留）
 * - 其余（/storage/、https）原样
 */
export async function resolveAssetUrl(
  asset: CanvasImageAsset,
  userId: string,
): Promise<string | null> {
  if (asset.url && !asset.url.startsWith("mock-image:")) return asset.url;
  const localKey = assetLocalKey(asset);
  if (!localKey) return null;
  const { getBlob } = await import("./draft");
  const blob = await getBlob(userId, localKey);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

/** mock-image:<key> / pending 资产的本机键。 */
export function assetLocalKey(asset: CanvasImageAsset): string | null {
  if (asset.url.startsWith("mock-image:")) return asset.url.slice("mock-image:".length);
  return asset.localKey ?? null;
}

/** 服务端保存前清理：pending 资产不带临时预览地址，但保留本机键（供恢复重试）。 */
export function serializeAssetForSave(asset: CanvasImageAsset): CanvasImageAsset {
  if (asset.uploadStatus === "saved") {
    const { localKey: _drop, ...rest } = asset;
    void _drop;
    return rest;
  }
  return { ...asset, url: "" };
}
