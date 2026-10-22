"use client";

/**
 * 构思画布「导出页面为 PNG」的离屏渲染层与光栅化编排（零新依赖）。
 *
 * 思路：把目标页面与纳入的自由元素/连接线以 interactive=false（预览形态，
 * 无任何编辑 chrome）重渲染到 position:fixed 负偏移的离屏层；等字体
 * （organize:fonts-ready / document.fonts.ready）与图片就绪后，把离屏根连同
 * 序列化的同源 CSS、按 unicode-range 挑出的 MiSans 字体子集（data URI）、
 * 内联后的图片一起装进 SVG foreignObject，经 canvas.drawImage 光栅化为 PNG，
 * 触发 <a download> 下载。导出全程只读，不写文档/revision/保存队列。
 *
 * 已知边界：embed(kind=embed) 的 sandbox iframe 不参与 SVG-as-image 渲染；
 * 跨域图片取不到时保留中性占位，不阻塞导出。
 */

import { findBoard, type CanvasDoc } from "@/lib/canvas/model";
import type { Scene } from "@/lib/canvas/layout";
import {
  EXPORT_FONT_STACK,
  exportFileName,
  exportPixelRatio,
  fontFaceNeededForText,
  fontFamiliesInStack,
  membersForBoardExport,
  parseFontUnicodeRange,
} from "@/lib/canvas/board-export";
import { CanvasBoardView } from "./canvas-board";
import { CanvasConnectorLayer } from "./canvas-connectors";
import { CanvasFreeItemView } from "./canvas-free-item";
import type { CanvasStore } from "./canvas-store";
import type { SourceStatusMap } from "./use-source-status";

// ---------------------------------------------------------------------------
// 离屏导出层（静态渲染，与预览外观一致）
// ---------------------------------------------------------------------------

/**
 * 导出静态层：只含目标 board + 纳入的自由元素与连接线；世界坐标经
 * `.canvas-export-shift` 平移使页面包围盒左上角对齐导出画布原点。
 * 与线上画布同顺序渲染（连接线在页面之下，自由元素在页面之上）。
 */
export function CanvasBoardExportSurface({
  doc,
  scene,
  store,
  assetUrls,
  sourceStatuses,
  boardId,
}: {
  doc: CanvasDoc;
  scene: Scene;
  store: CanvasStore;
  assetUrls: Record<string, string>;
  sourceStatuses?: SourceStatusMap;
  boardId: string;
}) {
  const members = membersForBoardExport(doc, scene, boardId);
  if (!members) return null;
  const board = findBoard(doc, boardId);
  const sceneBoard = scene.boards.find((entry) => entry.boardId === boardId);
  if (!board || !sceneBoard) return null;
  const includeFree = new Set(members.freeItemIds);
  const includeConnector = new Set(members.connectorIds);
  const freeItems = doc.freeItems.filter((item) => includeFree.has(item.id));
  const freeBoxes = scene.freeItems.filter((box) => includeFree.has(box.itemId));
  const connectors = (doc.connectors ?? []).filter((edge) => includeConnector.has(edge.id));
  return (
    <div
      className="canvas-export-root"
      style={{ width: `${members.bounds.width}px`, height: `${members.bounds.height}px` }}
    >
      <div
        className="canvas-export-shift"
        style={{ transform: `translate(${-members.bounds.x}px, ${-members.bounds.y}px)` }}
      >
        <CanvasConnectorLayer
          store={store}
          doc={{ ...doc, connectors }}
          selection={null}
          boxes={freeBoxes}
          zoom={1}
          interactive={false}
          draft={null}
          onEditLabel={() => {}}
        />
        <CanvasBoardView
          board={board}
          sceneBoard={sceneBoard}
          store={store}
          zoom={1}
          interactive={false}
          userId=""
          assetUrls={assetUrls}
          selectedBoard={false}
          selectedRegion={null}
          selectedBlockIds={[]}
          editingBlockId={null}
          sourceStatuses={sourceStatuses ?? new Map()}
        />
        {freeItems.map((item) => {
          const box = freeBoxes.find((entry) => entry.itemId === item.id);
          if (!box) return null;
          return (
            <CanvasFreeItemView
              key={item.id}
              item={item}
              height={box.height}
              store={store}
              zoom={1}
              interactive={false}
              selected={false}
              editing={false}
              userId=""
              assetUrls={assetUrls}
              snapTargets={[]}
              snapTargetsFor={() => []}
              getGroupMembers={() => null}
              grouped={false}
              groupLive={null}
              onGroupLive={() => {}}
              onSnapGuides={() => {}}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 光栅化编排
// ---------------------------------------------------------------------------

const RESOURCE_TIMEOUT_MS = 3000;
const FONT_FACE_RULE_TYPE = 5;
const IMPORT_RULE_TYPE = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, error: Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(error), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 等 organize:fonts-ready / data-fonts-ready / document.fonts.ready，超时继续（接受字体回落）。 */
async function waitFontsReady(fontsReady: boolean, timeoutMs: number): Promise<void> {
  if (fontsReady || document.documentElement.dataset.fontsReady === "true") return;
  const bridge = new Promise<void>((resolve) => {
    window.addEventListener("organize:fonts-ready", () => resolve(), { once: true });
  });
  const fonts = "fonts" in document ? document.fonts.ready.then(() => undefined) : Promise.resolve();
  try {
    await withTimeout(Promise.race([bridge, fonts]), timeoutMs, new Error("字体等待超时"));
  } catch {
    // 超时继续导出
  }
}

/** 等导出层内 <img> complete（load/error 都算完成），总计不超过 timeoutMs。 */
async function waitForImages(root: HTMLElement, timeoutMs: number): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  const pending = images
    .filter((img) => !img.complete)
    .map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    );
  if (pending.length === 0) return;
  try {
    await withTimeout(Promise.all(pending), timeoutMs, new Error("图片等待超时"));
  } catch {
    // 单张图卡住不阻塞整次导出
  }
}

async function fetchAsDataUrl(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("资源读取失败"));
      reader.readAsDataURL(blob);
    });
  } finally {
    clearTimeout(timer);
  }
}

/** 收集导出层可见文本（含连接线标签与列表符号），供字体子集过滤。 */
function collectExportText(root: HTMLElement): string {
  let text = "\u2022";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) text += walker.currentNode.nodeValue ?? "";
  for (const label of Array.from(root.querySelectorAll("text"))) text += label.textContent ?? "";
  return text;
}

/**
 * 序列化同源样式表进导出 SVG：@import 丢弃（SVG-as-image 不加载外部资源），
 * @font-face 只保留导出字体栈中、unicode-range 与导出文本相交的子集，
 * 并把字体文件换成 data URI（跨域样式表读不到 cssRules，跳过）。
 */
async function buildExportCss(text: string): Promise<string> {
  const neededFamilies = new Set(fontFamiliesInStack(EXPORT_FONT_STACK));
  const chunks: string[] = [];
  const fontFaces: { cssText: string; family: string; unicodeRange: string; src: string; baseUrl: string }[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 跨域样式表
    }
    const baseUrl = sheet.href ?? document.baseURI;
    for (const rule of Array.from(rules)) {
      const type = (rule as CSSRule).type;
      if (type === IMPORT_RULE_TYPE) continue;
      if (type === FONT_FACE_RULE_TYPE) {
        const style = (rule as CSSFontFaceRule).style;
        fontFaces.push({
          cssText: rule.cssText,
          family: style.getPropertyValue("font-family").trim().replace(/^["']|["']$/g, ""),
          unicodeRange: style.getPropertyValue("unicode-range"),
          src: style.getPropertyValue("src"),
          baseUrl,
        });
        continue;
      }
      chunks.push(rule.cssText);
    }
  }
  const faceCss = await Promise.all(
    fontFaces.map(async (face) => {
      if (!neededFamilies.has(face.family)) return null;
      const ranges = face.unicodeRange ? parseFontUnicodeRange(face.unicodeRange) : null;
      if (!fontFaceNeededForText(text, ranges)) return null;
      const urlMatch = face.src.match(/url\(\s*(['"]?)([^'")]+)\1\s*\)/);
      if (!urlMatch) return null;
      try {
        const dataUrl = await fetchAsDataUrl(new URL(urlMatch[2], face.baseUrl).href, RESOURCE_TIMEOUT_MS);
        return face.cssText.replace(/url\(\s*(['"]?)(?:[^)'"]+)\1\s*\)/, `url("${dataUrl}")`);
      } catch {
        return null; // 字体取不下来：跳过该子集，回退系统字体
      }
    }),
  );
  return faceCss.filter(Boolean).join("\n") + "\n" + chunks.join("\n");
}

/**
 * 克隆导出根并内联图片：blob:/同源图转 data URI；跨域/失败清空 src 并画中性占位
 * （保留版位，不因单张图卡死导出）。
 */
async function inlineImagesInClone(clone: HTMLElement): Promise<void> {
  const images = Array.from(clone.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) return;
      try {
        img.setAttribute("src", await fetchAsDataUrl(src, RESOURCE_TIMEOUT_MS));
      } catch {
        img.removeAttribute("src");
        img.setAttribute(
          "style",
          `${img.getAttribute("style") ?? ""};width:100%;height:100%;box-sizing:border-box;background:hsl(var(--muted) / 0.4);border:1.5px dashed hsl(var(--border));border-radius:var(--radius-xs);`,
        );
      }
    }),
  );
}

/** 当前主题的实底背景色（兜底白色），画进 PNG 底，不出现透明棋盘。 */
function themeBackgroundColor(): string {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== "transparent" && !bg.endsWith(", 0)")) return bg;
  }
  return "#ffffff";
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** UTF-8 文本 → data URL（分块 base64，避免大 SVG 一次性展开栈溢出）。 */
function svgToDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

/**
 * 导出编排主入口：stage 为离屏层容器（内含 .canvas-export-root）。
 * 任一步失败抛中文 Error，由调用方转 destructive toast。
 */
export async function runBoardExport(opts: {
  stage: HTMLElement | null;
  boardId: string;
  doc: CanvasDoc;
  scene: Scene;
  canvasTitle: string;
  fontsReady: boolean;
}): Promise<string> {
  const { stage, boardId, doc, scene, canvasTitle, fontsReady } = opts;
  const board = findBoard(doc, boardId);
  if (!board) throw new Error("没有可导出的页面");
  const members = membersForBoardExport(doc, scene, boardId);
  if (!members || members.bounds.width <= 0 || members.bounds.height <= 0) {
    throw new Error("页面内容为空，无法导出");
  }
  const root = stage?.querySelector<HTMLElement>(".canvas-export-root");
  if (!stage || !root) throw new Error("导出层未就绪");

  await waitFontsReady(fontsReady, RESOURCE_TIMEOUT_MS);
  await waitForImages(stage, RESOURCE_TIMEOUT_MS);
  const css = await buildExportCss(collectExportText(stage));

  const clone = root.cloneNode(true) as HTMLElement;
  await inlineImagesInClone(clone);
  const style = document.createElement("style");
  style.textContent = css;
  clone.insertBefore(style, clone.firstChild);
  const dark = document.documentElement.classList.contains("dark");
  if (dark) clone.classList.add("dark");
  const xhtml = new XMLSerializer().serializeToString(clone);

  const { width, height } = members.bounds;
  const scale = exportPixelRatio(window.devicePixelRatio || 1);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg"${dark ? ' class="dark"' : ""}` +
    ` width="${Math.round(width * scale)}" height="${Math.round(height * scale)}"` +
    ` viewBox="0 0 ${width} ${height}">` +
    `<foreignObject width="${width}" height="${height}">${xhtml}</foreignObject></svg>`;
  // Chromium 对 blob: URL 的 foreignObject SVG 判定污染 canvas（toBlob 抛
  // SecurityError）；data: URL 保持 origin-clean，实测同一 SVG 可正常导出。
  const imageUrl = svgToDataUrl(svg);
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("导出图像解码失败"));
  });
  image.src = imageUrl;
  await withTimeout(loaded, 10000, new Error("导出图像解码超时"));
  await nextFrame();

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建导出画布上下文");
  ctx.fillStyle = themeBackgroundColor();
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("PNG 生成失败，请重试");
  const fileName = exportFileName(canvasTitle, board.name ?? "");
  downloadBlob(blob, fileName);
  return fileName;
}

/** 触发浏览器下载；延迟 revoke，留出读取窗口（e2e 亦依赖该锚点点击）。 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
