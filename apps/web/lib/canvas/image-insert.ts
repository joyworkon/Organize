/**
 * 图片统一插入流程（阶段 B2）。
 *
 * 三个 UI 来源（左侧面板「图片」按钮、工作区拖入、粘贴）统一走 startImageInsert；
 * 「替换图片」走 replaceImage（同一上传入口，保留块位置/ratio/fit/样式）。
 *
 * 不变性（全部有单测）：
 * - target 是调用方在打开文件选择器/拖入那一刻的**快照**——上传期间用户改选区、
 *   改焦点都不影响在途目标；
 * - 占位块立即插入目标位置（uploadStatus="pending"、无 localKey = 上传中视觉）；
 *   完成后原地更新为 saved；失败原地 failed（或 pending+本机键，沿用 A6 重试链路）；
 * - 目标锚点/占位块在上传期间被删除或撤销 → 迟到的完成回调**绝不把图片插回**：
 *   上传成功的资产转为「待重新放置」自由图片（属性栏「移入区块…」可重新归位；
 *   由调用方传 fallbackPosition 决定落点）；上传失败则随占位一起丢弃；
 * - 多图按选择顺序依次插入同一目标容器（后者紧随前者）；
 * - 持久化只存可恢复 URL（isPersistableAssetUrl 语义），mock 走 IndexedDB mock-image:。
 *
 * 本模块不 import React/组件层：store 以最小结构接口注入，上传函数可替换
 * （单测注入假上传；工作区注入 uploadCanvasImage）。
 */

import {
  CanvasDoc,
  CanvasFocus,
  CanvasIdGenerator,
  CanvasImageAsset,
  createImageBlock,
  defaultIdGenerator,
  findBlockLocation,
} from "./model";
import { createFreeImage, insertBlockAtTarget, setImageAsset } from "./commands";
import type { CanvasUploadOutcome } from "./assets";
import type { InsertTarget } from "./insert-target";

/** 占位资产：4:3 临时比例撑起占位高；url 空 + 无本机键 = 「上传中」语义。 */
function placeholderAsset(name: string): CanvasImageAsset {
  return {
    url: "",
    naturalWidth: 4,
    naturalHeight: 3,
    name,
    uploadStatus: "pending",
  };
}

/** 失败占位（无本机键 → 块上只有「重新选择」）。 */
function failedAsset(name: string): CanvasImageAsset {
  return { url: "", naturalWidth: 4, naturalHeight: 3, name, uploadStatus: "failed" };
}

/** 与 canvas-block 的 displayKey 同规则（lib 层不 import 组件）。 */
function assetDisplayKey(blockId: string, asset: CanvasImageAsset): string {
  if (asset.url) return asset.url;
  return `${blockId}|${asset.localKey ?? ""}`;
}

/** store 最小结构（组件层 zustand store 天然满足）。 */
export interface ImageInsertStore {
  getState(): {
    doc: CanvasDoc;
    apply: (
      label: string,
      command: (doc: CanvasDoc) => { doc: CanvasDoc; focus?: CanvasFocus },
      opts?: { coalesceKey?: string; skipHistory?: boolean },
    ) => void;
    setAssetUrl: (key: string, url: string) => void;
    select?: (selection: { kind: "block"; blockId: string }) => void;
  };
}

export type ImageUploadFn = (file: File, userId: string) => Promise<CanvasUploadOutcome>;

export interface ImageInsertOptions {
  store: ImageInsertStore;
  /** 已解析并快照的落点（调用方在打开选择器/拖入瞬间经 resolveInsertTarget 解析）。 */
  target: InsertTarget;
  files: File[];
  upload: ImageUploadFn;
  userId: string;
  newId?: CanvasIdGenerator;
  /** 占位被删后「待重新放置」自由图片的落点（缺省原点）。 */
  fallbackPosition?: () => { x: number; y: number };
  /** 文件校验前置失败（类型/体积）时回调（缺省忽略该文件）。 */
  onInvalidFile?: (file: File, reason: string) => void;
  /** 在途目标被删、上传成功后转为自由图片时回调（工作区弹 toast）。 */
  onOrphaned?: (fileName: string) => void;
  /** 每张图上传成功后回调（工作区触发智能比例重算）。 */
  onUploaded?: () => void;
}

export interface ImageInsertSummary {
  /** 成功在目标位置落块的文件数。 */
  inserted: number;
  /** 转为「待重新放置」自由图片的文件名。 */
  orphaned: string[];
  /** 校验前置失败的文件数。 */
  invalid: number;
}

function focusBlockIds(state: { doc: CanvasDoc }): Set<string> {
  const ids = new Set<string>();
  for (const board of state.doc.boards) {
    for (const region of board.regions) {
      for (const section of region.sections) {
        for (const column of section.columns) {
          for (const block of column.blocks) ids.add(block.id);
        }
      }
    }
  }
  return ids;
}

/**
 * 统一图片插入入口。多图按顺序依次插入同一目标容器（后者锚定前者之后）。
 * 逐张 await：上传顺序 = 文档顺序。
 */
export async function startImageInsert(options: ImageInsertOptions): Promise<ImageInsertSummary> {
  const { store, upload, userId } = options;
  const newId = options.newId ?? defaultIdGenerator;
  const summary: ImageInsertSummary = { inserted: 0, orphaned: [], invalid: 0 };
  const target = options.target;
  if ("create" in target) {
    // 调用方负责先建页面再二次解析；这里直接拒绝，避免隐式建页面
    return summary;
  }

  let anchor: typeof target = target;
  for (const file of options.files) {
    if (!file.type.startsWith("image/")) {
      summary.invalid += 1;
      options.onInvalidFile?.(file, "不支持的图片格式");
      continue;
    }
    // 1) 立即插入占位块（快照目标；后续图锚定前一张占位块之后）
    const placeholder = createImageBlock(placeholderAsset(file.name), newId);
    store.getState().apply("插入图片", (doc) =>
      insertBlockAtTarget(doc, anchor, placeholder, newId),
    );
    // focus 带出新块位置：后续图紧随其后的锚点
    const state = store.getState() as {
      focus?: { kind?: string; sectionId?: string; columnId?: string; blockId?: string } | null;
    };
    if (state.focus?.kind === "block" && state.focus.sectionId && state.focus.columnId) {
      anchor = {
        kind: "column",
        boardId: ("boardId" in anchor ? anchor.boardId : ""),
        regionId: ("regionId" in anchor ? anchor.regionId : ""),
        sectionId: state.focus.sectionId,
        columnId: state.focus.columnId,
        afterBlockId: state.focus.blockId,
      };
    }

    // 2) 上传（目标已快照：期间选区变化不影响本张图）
    let outcome: CanvasUploadOutcome;
    try {
      outcome = await upload(file, userId);
    } catch {
      // 硬失败（体积/解析等）：占位原地转 failed，无本机键 → 块上提供「重新选择」
      if (focusBlockIds(store.getState()).has(placeholder.id)) {
        store.getState().apply("图片上传失败", (doc) =>
          setImageAsset(doc, { blockId: placeholder.id, asset: failedAsset(file.name) }),
        );
      }
      continue;
    }

    // 3) 占位是否还在（被删除/撤销 → 绝不插回）
    if (!focusBlockIds(store.getState()).has(placeholder.id)) {
      if (outcome.asset.uploadStatus === "saved") {
        // 上传已成功：资产转「待重新放置」自由图片（不自动插进任何区块）
        const at = options.fallbackPosition?.() ?? { x: 0, y: 0 };
        store.getState().apply("图片待重新放置", (doc) =>
          createFreeImage(doc, { ...at, asset: outcome.asset }, newId),
        );
        summary.orphaned.push(file.name);
        options.onOrphaned?.(file.name);
      }
      // 未成功的上传随占位一起丢弃（用户已明确删除该占位）
      continue;
    }

    // 4) 原地更新资产 + 预览
    store.getState().apply("图片上传完成", (doc) =>
      setImageAsset(doc, { blockId: placeholder.id, asset: outcome.asset }),
    );
    if (outcome.previewUrl) {
      store.getState().setAssetUrl(assetDisplayKey(placeholder.id, outcome.asset), outcome.previewUrl);
    }
    summary.inserted += 1;
    options.onUploaded?.();
  }
  return summary;
}

export interface ReplaceImageOptions {
  store: ImageInsertStore;
  blockId: string;
  file: File;
  upload: ImageUploadFn;
  userId: string;
  /** 上传成功后回调（预览键已写入）。 */
  onReplaced?: (asset: CanvasImageAsset) => void;
}

/**
 * 替换图片：先上传成功再原地更新资产——块位置/ratio/fit/alt/样式全保留；
 * 硬失败（抛错）不动旧图，交由调用方提示。软失败（真实模式 pending  outcome）
 * 沿用 A6 语义：新图保留本机预览 + 待上传徽标 + 重试。
 */
export async function replaceImage(options: ReplaceImageOptions): Promise<CanvasImageAsset> {
  const { store, blockId, file, upload, userId } = options;
  const outcome = await upload(file, userId);
  const doc = store.getState().doc;
  const loc = findBlockLocation(doc, blockId);
  if (!loc || loc.block.type !== "image") {
    // 替换期间块被删：同 startImageInsert 的孤儿策略
    const at = { x: 0, y: 0 };
    store.getState().apply("图片待重新放置", (d) => createFreeImage(d, { ...at, asset: outcome.asset }));
    return outcome.asset;
  }
  store.getState().apply("替换图片", (d) => setImageAsset(d, { blockId, asset: outcome.asset }));
  if (outcome.previewUrl) {
    store.getState().setAssetUrl(assetDisplayKey(blockId, outcome.asset), outcome.previewUrl);
  }
  options.onReplaced?.(outcome.asset);
  return outcome.asset;
}

/** 供组件判断「上传中」占位（url 空 + 无本机键的 pending 资产）。 */
export function isUploadingAsset(asset: CanvasImageAsset | null | undefined): boolean {
  return !!asset && asset.uploadStatus === "pending" && asset.url === "" && !asset.localKey;
}
