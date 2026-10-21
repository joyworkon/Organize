/**
 * 链接 / 视频嵌入统一插入流程（对齐 image-insert 的占位-完成模式）。
 *
 * 两个 UI 来源（添加面板「链接 / 视频」、粘贴单行 URL）统一走 startEmbedInsert；
 * 属性栏「重新解析」与失败后的「重试」走 resolveEmbedBlock。
 *
 * 不变性（有单测）：
 * - 先插 loading 占位块（kind 按白名单预判 → 占位即最终高度，不跳），再 POST /api/oembed；
 * - 成功：一次 apply 写入全部快照字段（skipHistory——与「图片上传完成」同语义，
 *   撤销一步回到插入前）；可撤销的「重新解析」由调用方传 historyLabel；
 * - 失败：status:"error"（skipHistory），块不删，就地重试；
 * - 占位在解析期间被删除/撤销 → 迟到结果丢弃，绝不插回；
 * - 解析函数可注入（单测假解析；工作区用 fetchOEmbed）。
 *
 * 本模块不 import React/组件层：store 以最小结构接口注入。
 */

import { matchProvider } from "@/lib/oembed/providers";
import {
  CanvasDoc,
  CanvasFocus,
  CanvasEmbedKind,
  CanvasIdGenerator,
  createEmbedBlock,
  defaultIdGenerator,
  findBlockLocation,
  isSafeEmbedUrl,
} from "./model";
import { insertBlockAtTarget, updateEmbedBlock } from "./commands";
import type { InsertTarget } from "./insert-target";

/** /api/oembed 响应中画布消费的字段（真实 OEmbedResponse 子集）。 */
export interface EmbedResolveData {
  url: string;
  kind: CanvasEmbedKind;
  provider?: string;
  title: string;
  description?: string;
  html?: string;
  sandbox?: string;
  cover?: string | null;
  siteName?: string;
}

export type EmbedResolveResult = { ok: true; data: EmbedResolveData } | { ok: false; error: string };

export type EmbedResolveFn = (url: string, opts?: { force?: boolean }) => Promise<EmbedResolveResult>;

/** store 最小结构（组件层 zustand store 天然满足）。 */
export interface EmbedInsertStore {
  getState(): {
    doc: CanvasDoc;
    apply: (
      label: string,
      command: (doc: CanvasDoc) => { doc: CanvasDoc; focus?: CanvasFocus },
      opts?: { coalesceKey?: string; skipHistory?: boolean },
    ) => void;
  };
}

const EMBED_URL_MAX_LENGTH = 2048;

/**
 * 粘贴分流用：整段 trim 后是**单行** http(s) URL（不含任何空白）才返回该 URL，
 * 多行 / 带附加文字 / 非 http(s) 一律返回 null（走原纯文本粘贴路径）。
 */
export function matchSingleUrlText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return trimmed;
}

/**
 * 规范化用户输入：trim；无协议但形如域名时补 https://；长度与协议校验。
 * 非法返回 null（调用方 toast，不插入）。
 */
export function normalizeEmbedUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (!/^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(s)) return null;
    s = `https://${s}`;
  }
  if (!isSafeEmbedUrl(s) || s.length > EMBED_URL_MAX_LENGTH) return null;
  try {
    new URL(s);
  } catch {
    return null;
  }
  return s;
}

/** 占位 kind 预判：白名单 provider（YouTube/Bilibili 等）→ embed（16:9），否则 link-card。 */
export function predictEmbedKind(url: string): CanvasEmbedKind {
  return matchProvider(url) ? "embed" : "link-card";
}

/** 默认解析器：POST /api/oembed（与笔记编辑器 Embed 共用服务端与 mock shim）。 */
export const fetchOEmbed: EmbedResolveFn = async (url, opts) => {
  try {
    const res = await fetch("/api/oembed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, force: opts?.force === true }),
    });
    const data = (await res.json().catch(() => null)) as
      | (EmbedResolveData & { error?: string })
      | null;
    if (!res.ok) {
      return { ok: false, error: (typeof data?.error === "string" && data.error) || `解析失败（${res.status}）` };
    }
    if (!data || (data.kind !== "embed" && data.kind !== "link-card")) {
      return { ok: false, error: "解析结果无效" };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "网络错误，请重试" };
  }
};

/** 在途解析登记（视图自愈「刷新后卡 loading」时防重复触发）。 */
const resolvingBlocks = new Set<string>();

export function isEmbedResolving(blockId: string): boolean {
  return resolvingBlocks.has(blockId);
}

function blockExists(doc: CanvasDoc, blockId: string): boolean {
  const loc = findBlockLocation(doc, blockId);
  return !!loc && loc.block.type === "embed";
}

/** 把解析结果写回块（快照字段 + status ready；一次 apply，skipHistory）。 */
function commitResolve(store: EmbedInsertStore, blockId: string, data: EmbedResolveData): void {
  store.getState().apply("解析链接", (doc) =>
    updateEmbedBlock(doc, {
      blockId,
      url: data.url,
      kind: data.kind,
      title: data.title || "",
      description: data.description ?? "",
      siteName: data.siteName ?? "",
      provider: data.provider ?? "",
      cover: data.cover ?? null,
      html: data.html ?? "",
      sandbox: data.sandbox ?? "",
      status: "ready",
    }),
    { skipHistory: true },
  );
}

export interface ResolveEmbedOptions {
  store: EmbedInsertStore;
  blockId: string;
  /** 解析函数（缺省 fetchOEmbed；单测注入假实现）。 */
  resolve?: EmbedResolveFn;
  /** 覆盖块内 URL 解析（改链接后重新解析）；不传则用块当前 url。 */
  url?: string;
  /** 绕过服务端缓存（「重新解析」用）。 */
  force?: boolean;
  /**
   * 传入时以该标签把「置为 loading（含可选 url 覆盖）」作为一个可撤销事务
   * （撤销回到解析前的旧快照）；缺省置 loading 不进历史。
   */
  historyLabel?: string;
}

/**
 * 解析 / 重新解析已存在的 embed 块：
 * 置 loading → resolve → 成功写快照（skipHistory）/ 失败置 error（skipHistory，不删块）。
 * 块中途被删或 URL 非法 → 返回 false 且不动文档。
 */
export async function resolveEmbedBlock(options: ResolveEmbedOptions): Promise<boolean> {
  const { store, blockId } = options;
  const resolve = options.resolve ?? fetchOEmbed;
  const state = store.getState();
  if (!blockExists(state.doc, blockId) || isEmbedResolving(blockId)) return false;
  const url = options.url ?? (findBlockLocation(state.doc, blockId)?.block as { url?: string })?.url ?? "";
  if (!isSafeEmbedUrl(url)) return false;

  resolvingBlocks.add(blockId);
  try {
    const loc = findBlockLocation(store.getState().doc, blockId);
    const currentStatus = loc?.block.type === "embed" ? loc.block.status : undefined;
    if (options.historyLabel) {
      store.getState().apply(options.historyLabel, (doc) =>
        updateEmbedBlock(doc, {
          blockId,
          ...(options.url !== undefined ? { url: options.url } : {}),
          status: "loading",
        }),
      );
    } else if (currentStatus !== "loading") {
      store.getState().apply(
        "解析链接",
        (doc) => updateEmbedBlock(doc, { blockId, status: "loading" }),
        { skipHistory: true },
      );
    }

    const result = await resolve(url, { force: options.force });

    // 解析期间块被删除/撤销：丢弃结果，绝不插回
    if (!blockExists(store.getState().doc, blockId)) return false;
    if (result.ok) {
      commitResolve(store, blockId, result.data);
      return true;
    }
    store.getState().apply(
      "链接解析失败",
      (doc) => updateEmbedBlock(doc, { blockId, status: "error" }),
      { skipHistory: true },
    );
    return false;
  } finally {
    resolvingBlocks.delete(blockId);
  }
}

export interface EmbedInsertOptions {
  store: EmbedInsertStore;
  /** 已解析的落点（resolveInsertTargetNow 的结果；create:"page" 拒绝插入）。 */
  target: InsertTarget;
  /** 规范化后的 http(s) URL。 */
  url: string;
  resolve?: EmbedResolveFn;
  newId?: CanvasIdGenerator;
}

export interface EmbedInsertSummary {
  /** 占位块 id（目标非法 / URL 非法时为 null）。 */
  blockId: string | null;
  /** 解析是否成功（块已就绪）。 */
  resolved: boolean;
}

/** 统一插入入口：占位落块（可撤销）→ 解析（成功原地更新 / 失败就地错误态）。 */
export async function startEmbedInsert(options: EmbedInsertOptions): Promise<EmbedInsertSummary> {
  const { store, url, target } = options;
  const newId = options.newId ?? defaultIdGenerator;
  const summary: EmbedInsertSummary = { blockId: null, resolved: false };
  if ("create" in target) return summary;
  if (!isSafeEmbedUrl(url)) return summary;

  const placeholder = createEmbedBlock(url, { kind: predictEmbedKind(url) }, newId);
  store.getState().apply("插入链接/视频", (doc) => insertBlockAtTarget(doc, target, placeholder, newId));
  summary.blockId = placeholder.id;

  summary.resolved = await resolveEmbedBlock({
    store,
    blockId: placeholder.id,
    resolve: options.resolve,
  });
  return summary;
}
