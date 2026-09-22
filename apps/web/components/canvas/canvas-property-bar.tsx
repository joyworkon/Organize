"use client";

/**
 * 右侧属性栏（docs/idea-canvas-plan.md §5）：按选中对象显示紧凑属性。
 * 文本：角色/字号档/加粗/颜色/对齐/背景/圆角；图片：完整显示 vs 铺满裁切；
 * 版面（页面）：页面名/宽度/背景/圆角；区块在左侧结构面板操作；
 * 自由容器：文本样式/图片显示与容器比例/层级/圆角/移入区块。
 * 不含无效占位控件。
 */

import { useCallback, useRef, useState } from "react";
import { Trash2 } from "@/components/icons";
import {
  attachFreeItemToRegion,
  deleteBlock,
  deleteBoard,
  deleteFreeItem,
  duplicateBlock,
  insertColumn,
  moveBlock,
  removeColumn,
  renameBoard,
  renameRegion,
  resizeBoard,
  setColumnWeights,
  setImageFit,
  updateBlockStyle,
  updateBoardPadding,
  updateBoardStyle,
  updateButtonBlock,
  updateFreeItem,
  updateFreeItemBlock,
  updateImageBlock,
  updateRegionStyle,
  updateSectionLayout,
  updateTextRole,
  setSectionWidthMode,
  applySmartWeights,
} from "@/lib/canvas/commands";
import {
  findBlockLocation,
  findFreeItem,
  findRegion,
  type CanvasFontSizeTier,
  type CanvasDoc,
  type CanvasImageRatio,
  type CanvasSectionVerticalAlign,
} from "@/lib/canvas/model";
import { computeSmartWeights, regionGap, regionInnerWidth } from "@/lib/canvas/layout";
import {
  CANVAS_BG_KEYS,
  CANVAS_COLOR_KEYS,
  COLOR_LABELS,
  FONT_SIZE_LABELS,
  resolveTextStyle,
  textStyleKey,
  type ResolvedTextStyle,
} from "@/lib/canvas/text-styles";
import { canSmartRecompute } from "@/lib/canvas/layout";
import type { CanvasStore } from "./canvas-store";
import { useCanvasSelector } from "./use-canvas-selector";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface MeasurerLike {
  measure: (text: string, key: string, style: ResolvedTextStyle, width: number) => number;
}

export function CanvasPropertyBar({
  store,
  measurer,
  onReplaceImage,
}: {
  store: CanvasStore;
  measurer: MeasurerLike;
  /** 图片「替换图片」（B2 统一上传入口）：块原位更新，失败保留旧图。 */
  onReplaceImage?: (blockId: string, file: File) => void;
}) {
  const doc = useCanvasSelector(store, useCallback((s: ReturnType<CanvasStore["getState"]>) => s.doc, []));
  const selection = useCanvasSelector(store, useCallback((s: ReturnType<CanvasStore["getState"]>) => s.selection, []));
  // 「移入区块…」对话框开关（hooks 必须无条件执行，放最顶层）
  const [moveTargetOpen, setMoveTargetOpen] = useState(false);

  const target = (() => {
    if (!selection) return null;
    if (selection.kind === "block") {
      const loc = findBlockLocation(doc, selection.blockId);
      return loc ? { kind: "block" as const, ...loc } : null;
    }
    if (selection.kind === "free") {
      const item = findFreeItem(doc, selection.itemId);
      return item ? { kind: "free" as const, item } : null;
    }
    if (selection.kind === "region") {
      const found = findRegion(doc, selection.regionId);
      return found && found.board.id === selection.boardId
        ? { kind: "region" as const, board: found.board, region: found.region }
        : null;
    }
    const board = doc.boards.find((b) => b.id === selection.boardId);
    return board ? { kind: "board" as const, board } : null;
  })();

  if (!target) {
    return (
      <div className="canvas-property-bar" aria-label="属性">
        <p className="text-xs text-muted-foreground">选中模块、页面、区块或自由容器后，这里显示属性。</p>
      </div>
    );
  }

  if (target.kind === "board") {
    const board = target.board;
    return (
      <div className="canvas-property-bar" aria-label="页面属性">
        <h3 className="canvas-prop-title">页面</h3>
        <label className="canvas-prop-row">
          <span className="canvas-prop-label">页面名</span>
          <input
            className="canvas-prop-input"
            style={{ width: 132 }}
            value={board.name ?? ""}
            placeholder="未命名页面"
            aria-label="页面名"
            onChange={(e) =>
              store.getState().apply("页面改名", (d) =>
                renameBoard(d, { boardId: board.id, name: e.target.value }),
              )
            }
          />
        </label>
        <label className="canvas-prop-row">
          <span className="canvas-prop-label">宽度</span>
          <input
            type="number"
            min={320}
            max={2000}
            step={10}
            value={board.width}
            onChange={(e) =>
              store.getState().apply("调整版面宽度", (d) =>
                resizeBoard(d, { boardId: board.id, width: Number(e.target.value) || board.width }),
              )
            }
            className="canvas-prop-input"
          />
        </label>
        <label className="canvas-prop-row">
          <span className="canvas-prop-label">内边距</span>
          <input
            type="number"
            min={0}
            max={128}
            step={4}
            value={board.padding}
            aria-label="页面内边距"
            onChange={(e) =>
              store.getState().apply("页面内边距", (d) =>
                updateBoardPadding(d, { boardId: board.id, padding: Number(e.target.value) || 0 }),
              )
            }
            className="canvas-prop-input"
          />
        </label>
        <SwatchRow
          label="背景"
          keys={CANVAS_BG_KEYS}
          value={board.style?.background ?? ""}
          onPick={(key) =>
            store.getState().apply("版面背景", (d) =>
              updateBoardStyle(d, { boardId: board.id, style: { background: key || null } }),
            )
          }
        />
        <label className="canvas-prop-row">
          <span className="canvas-prop-label">圆角</span>
          <input
            type="range"
            min={0}
            max={32}
            value={board.style?.radius ?? 12}
            onChange={(e) =>
              store.getState().apply("版面圆角", (d) =>
                updateBoardStyle(d, { boardId: board.id, style: { radius: Number(e.target.value) } }),
              )
            }
          />
        </label>
        <button
          type="button"
          className="canvas-prop-danger"
          onClick={() => store.getState().apply("删除页面", (d) => deleteBoard(d, { boardId: board.id }))}
        >
          <Trash2 className="h-3.5 w-3.5" /> 删除页面
        </button>
      </div>
    );
  }

  // 选中区块（B2）：名称/背景/内边距/行间距/边框
  if (target.kind === "region") {
    const { board, region } = target;
    return (
      <div className="canvas-property-bar" aria-label="区块属性">
        <h3 className="canvas-prop-title">区块</h3>
        <label className="canvas-prop-row">
          <span className="canvas-prop-label">名称</span>
          <input
            className="canvas-prop-input"
            style={{ width: 132 }}
            value={region.name}
            aria-label="区块名"
            onChange={(e) =>
              store.getState().apply("重命名区块", (d) =>
                renameRegion(d, { boardId: board.id, regionId: region.id, name: e.target.value }),
              )
            }
          />
        </label>
        <SwatchRow
          label="背景"
          keys={CANVAS_BG_KEYS}
          value={region.style?.background ?? ""}
          onPick={(key) =>
            store.getState().apply("区块背景", (d) =>
              updateRegionStyle(d, { boardId: board.id, regionId: region.id, style: { background: key || null } }),
            )
          }
        />
        <label className="canvas-prop-row">
          <span className="canvas-prop-label">内边距</span>
          <input
            type="number"
            min={0}
            max={128}
            step={2}
            value={region.style?.padding ?? 0}
            aria-label="区块内边距"
            onChange={(e) =>
              store.getState().apply("区块内边距", (d) =>
                updateRegionStyle(d, {
                  boardId: board.id,
                  regionId: region.id,
                  style: { padding: Math.min(128, Math.max(0, Number(e.target.value) || 0)) },
                }),
              )
            }
            className="canvas-prop-input"
          />
        </label>
        <label className="canvas-prop-row">
          <span className="canvas-prop-label">行间距</span>
          <input
            type="number"
            min={0}
            max={128}
            step={2}
            value={region.style?.rowGap ?? board.gap}
            aria-label="区块行间距"
            onChange={(e) =>
              store.getState().apply("区块行间距", (d) =>
                updateRegionStyle(d, {
                  boardId: board.id,
                  regionId: region.id,
                  style: { rowGap: Math.min(128, Math.max(0, Number(e.target.value) || 0)) },
                }),
              )
            }
            className="canvas-prop-input"
          />
        </label>
        <label className="canvas-prop-row">
          <span className="canvas-prop-label">边框</span>
          <input
            type="checkbox"
            checked={region.style?.border === true}
            aria-label="区块装饰边框"
            onChange={(e) =>
              store.getState().apply("区块边框", (d) =>
                updateRegionStyle(d, {
                  boardId: board.id,
                  regionId: region.id,
                  style: { border: e.target.checked },
                }),
              )
            }
          />
          <span className="text-xs text-muted-foreground">装饰边框</span>
        </label>
        <p className="text-xs text-muted-foreground">区块的上移/下移/复制/删除在左侧「结构」分组。</p>
      </div>
    );
  }

  if (target.kind === "free") {
    const item = target.item;
    const freeText = item.block.type === "text" ? item.block : null;
    const freeImage = item.block.type === "image" ? item.block : null;
    return (
      <div className="canvas-property-bar" aria-label="自由容器属性">
        <h3 className="canvas-prop-title">{freeText ? "自由文本" : "自由图片"}</h3>
        <p className="text-xs text-muted-foreground">自由定位，不参与自动排版。</p>
        {freeText && (
          <>
            <ModeRow
              value={freeText.role}
              options={[
                { value: "title", label: "标题" },
                { value: "body", label: "正文" },
              ]}
              onChange={(role) =>
                store.getState().apply("切换角色", (d) =>
                  updateFreeItemBlock(d, { itemId: item.id, role: role as "title" | "body" }),
                )
              }
            />
            <ModeRow
              value={(freeText.style?.fontSize ?? (freeText.role === "title" ? "lg" : "md")) as CanvasFontSizeTier}
              options={(Object.keys(FONT_SIZE_LABELS) as CanvasFontSizeTier[]).map((tier) => ({
                value: tier,
                label: FONT_SIZE_LABELS[tier],
              }))}
              onChange={(tier) =>
                store.getState().apply("字号", (d) =>
                  updateFreeItemBlock(d, { itemId: item.id, style: { fontSize: tier } }),
                )
              }
            />
            <ModeRow
              value={freeText.style?.align ?? "left"}
              options={[
                { value: "left", label: "左对齐" },
                { value: "center", label: "居中" },
                { value: "right", label: "右对齐" },
              ]}
              onChange={(align) =>
                store.getState().apply("对齐", (d) =>
                  updateFreeItemBlock(d, { itemId: item.id, style: { align: align as "left" | "center" | "right" } }),
                )
              }
            />
            <label className="canvas-prop-row">
              <span className="canvas-prop-label">加粗</span>
              <input
                type="checkbox"
                checked={freeText.style?.bold ?? freeText.role === "title"}
                onChange={(e) =>
                  store.getState().apply("加粗", (d) =>
                    updateFreeItemBlock(d, { itemId: item.id, style: { bold: e.target.checked } }),
                  )
                }
              />
            </label>
            <SwatchRow
              label="文字色"
              keys={CANVAS_COLOR_KEYS}
              value={freeText.style?.color ?? ""}
              onPick={(key) =>
                store.getState().apply("文字颜色", (d) =>
                  updateFreeItemBlock(d, { itemId: item.id, style: { color: key } }),
                )
              }
            />
          </>
        )}
        {freeImage && (
          <>
            <ModeRow
              value={freeImage.fit}
              options={[
                { value: "contain", label: "完整显示" },
                { value: "cover", label: "铺满裁切" },
              ]}
              onChange={(fit) =>
                store.getState().apply("切换图片显示", (d) =>
                  updateFreeItemBlock(d, { itemId: item.id, fit: fit as "contain" | "cover" }),
                )
              }
            />
            <ModeRow
              value={freeImage.ratio ?? "auto"}
              options={[
                { value: "auto", label: "原始比例" },
                { value: "1:1", label: "1:1" },
                { value: "4:3", label: "4:3" },
                { value: "16:9", label: "16:9" },
              ]}
              onChange={(ratio) =>
                store.getState().apply("容器比例", (d) =>
                  updateFreeItemBlock(d, { itemId: item.id, ratio: ratio as CanvasImageRatio }),
                )
              }
            />
          </>
        )}
        <div className="canvas-prop-row canvas-prop-actions">
          <button
            type="button"
            className="canvas-prop-btn"
            onClick={() =>
              store.getState().apply("上移一层", (d) => updateFreeItem(d, { itemId: item.id, zIndex: item.zIndex + 1 }))
            }
          >
            上移一层
          </button>
          <button
            type="button"
            className="canvas-prop-btn"
            onClick={() =>
              store.getState().apply("下移一层", (d) =>
                updateFreeItem(d, { itemId: item.id, zIndex: Math.max(0, item.zIndex - 1) }),
              )
            }
          >
            下移一层
          </button>
        </div>
        <button
          type="button"
          className="canvas-prop-btn"
          onClick={() => setMoveTargetOpen(true)}
        >
          移入区块…
        </button>
        <MoveFreeItemDialog
          store={store}
          doc={doc}
          itemId={item.id}
          open={moveTargetOpen}
          onOpenChange={setMoveTargetOpen}
        />
        <RadiusControl store={store} blockId={item.block.id} itemId={item.id} />
        <button
          type="button"
          className="canvas-prop-danger"
          onClick={() => store.getState().apply("删除自由容器", (d) => deleteFreeItem(d, { itemId: item.id }))}
        >
          <Trash2 className="h-3.5 w-3.5" /> 删除
        </button>
      </div>
    );
  }

  // 选中模块
  const { block, section, board } = target;
  const blockTitle =
    block.type === "text"
      ? block.role === "title"
        ? "标题模块"
        : block.role === "list"
          ? "列表模块"
          : "文本模块"
      : block.type === "image"
        ? "图片模块"
        : block.type === "divider"
          ? "分隔线"
          : "行动按钮";
  const ratio = block.type === "image" ? (block.ratio ?? "auto") : "auto";
  const canRemoveColumn =
    section.columns.length > 1 && section.columns[section.columns.length - 1].blocks.length === 0;
  const isTwoCols = section.columns.length === 2;
  const leftShare = isTwoCols
    ? Math.round((section.columnWeights[0] / (section.columnWeights[0] + section.columnWeights[1])) * 100)
    : 50;

  return (
    <div className="canvas-property-bar" aria-label="模块属性">
      <h3 className="canvas-prop-title">{blockTitle}</h3>
      {block.type === "text" && (
        <>
          <ModeRow
            value={block.role}
            options={[
              { value: "title", label: "标题" },
              { value: "body", label: "正文" },
              { value: "list", label: "列表" },
            ]}
            onChange={(role) =>
              store.getState().apply("切换角色", (d) =>
                updateTextRole(d, { blockId: block.id, role: role as "title" | "body" | "list" }),
              )
            }
          />
          <ModeRow
            value={(block.style?.fontSize ?? (block.role === "title" ? "lg" : "md")) as CanvasFontSizeTier}
            options={(Object.keys(FONT_SIZE_LABELS) as CanvasFontSizeTier[]).map((tier) => ({
              value: tier,
              label: FONT_SIZE_LABELS[tier],
            }))}
            onChange={(tier) =>
              store.getState().apply("字号", (d) =>
                updateBlockStyle(d, { blockId: block.id, style: { fontSize: tier } }),
              )
            }
          />
          <ModeRow
            value={block.style?.align ?? "left"}
            options={[
              { value: "left", label: "左对齐" },
              { value: "center", label: "居中" },
              { value: "right", label: "右对齐" },
            ]}
            onChange={(align) =>
              store.getState().apply("对齐", (d) =>
                updateBlockStyle(d, { blockId: block.id, style: { align: align as "left" | "center" | "right" } }),
              )
            }
          />
          <label className="canvas-prop-row">
            <span className="canvas-prop-label">加粗</span>
            <input
              type="checkbox"
              checked={block.style?.bold ?? block.role === "title"}
              onChange={(e) =>
                store.getState().apply("加粗", (d) => updateBlockStyle(d, { blockId: block.id, style: { bold: e.target.checked } }))
              }
            />
          </label>
          <SwatchRow
            label="文字色"
            keys={CANVAS_COLOR_KEYS}
            value={block.style?.color ?? ""}
            onPick={(key) =>
              store.getState().apply("文字颜色", (d) => updateBlockStyle(d, { blockId: block.id, style: { color: key } }))
            }
          />
        </>
      )}
      {block.type === "image" && (
        <>
          <ModeRow
            value={ratio}
            options={[
              { value: "auto", label: "原始比例" },
              { value: "1:1", label: "1:1" },
              { value: "4:3", label: "4:3" },
              { value: "16:9", label: "16:9" },
            ]}
            onChange={(next) =>
              store.getState().apply("容器比例", (d) =>
                updateImageBlock(d, { blockId: block.id, ratio: next as CanvasImageRatio }),
              )
            }
          />
          {/* 定比例容器才显示 fit：auto 时块高随原比例，cover 视觉等价 contain，
              显示该控件会让用户误以为「没作用」（B2） */}
          {ratio !== "auto" && (
            <ModeRow
              value={block.fit}
              options={[
                { value: "contain", label: "完整显示" },
                { value: "cover", label: "铺满裁切" },
              ]}
              onChange={(fit) =>
                store.getState().apply("切换图片显示", (d) => setImageFit(d, { blockId: block.id, fit: fit as "contain" | "cover" }))
              }
            />
          )}
          <ReplaceImageRow onReplaceImage={onReplaceImage} blockId={block.id} />
          <label className="canvas-prop-row">
            <span className="canvas-prop-label">说明</span>
            <input
              className="canvas-prop-input"
              style={{ width: 132 }}
              value={block.alt ?? ""}
              placeholder="图片说明（alt）"
              aria-label="图片说明"
              onChange={(e) =>
                store.getState().apply("图片说明", (d) =>
                  updateImageBlock(d, { blockId: block.id, alt: e.target.value }),
                )
              }
            />
          </label>
        </>
      )}
      {block.type === "divider" && (
        <ModeRow
          value={block.style?.align ?? "left"}
          options={[
            { value: "left", label: "左对齐" },
            { value: "center", label: "居中" },
            { value: "right", label: "右对齐" },
          ]}
          onChange={(align) =>
            store.getState().apply("对齐", (d) =>
              updateBlockStyle(d, { blockId: block.id, style: { align: align as "left" | "center" | "right" } }),
            )
          }
        />
      )}
      {block.type === "button" && (
        <>
          <label className="canvas-prop-row">
            <span className="canvas-prop-label">文案</span>
            <input
              className="canvas-prop-input"
              style={{ width: 132 }}
              value={block.label}
              aria-label="按钮文案"
              onChange={(e) =>
                store.getState().apply("按钮文案", (d) =>
                  updateButtonBlock(d, { blockId: block.id, label: e.target.value }),
                )
              }
            />
          </label>
          <label className="canvas-prop-row">
            <span className="canvas-prop-label">链接</span>
            <input
              className="canvas-prop-input"
              style={{ width: 132 }}
              value={block.href}
              placeholder="https://…"
              aria-label="按钮链接"
              onChange={(e) =>
                store.getState().apply("按钮链接", (d) =>
                  updateButtonBlock(d, { blockId: block.id, href: e.target.value }),
                )
              }
            />
          </label>
          <ModeRow
            value={block.align}
            options={[
              { value: "left", label: "左对齐" },
              { value: "center", label: "居中" },
              { value: "right", label: "右对齐" },
            ]}
            onChange={(align) =>
              store.getState().apply("对齐", (d) =>
                updateButtonBlock(d, { blockId: block.id, align: align as "left" | "center" | "right" }),
              )
            }
          />
          <ModeRow
            value={block.variant}
            options={[
              { value: "primary", label: "主要" },
              { value: "secondary", label: "次要" },
            ]}
            onChange={(variant) =>
              store.getState().apply("按钮样式", (d) =>
                updateButtonBlock(d, { blockId: block.id, variant: variant as "primary" | "secondary" }),
              )
            }
          />
        </>
      )}
      <SwatchRow
        label="背景"
        keys={CANVAS_BG_KEYS}
        value={block.style?.background ?? ""}
        onPick={(key) =>
          store.getState().apply("模块背景", (d) => updateBlockStyle(d, { blockId: block.id, style: { background: key || null } }))
        }
      />
      <RadiusControl store={store} blockId={block.id} />
      <h3 className="canvas-prop-subtitle">所在行</h3>
      <div className="canvas-prop-row canvas-prop-actions">
        <button
          type="button"
          className="canvas-prop-btn"
          title="在右侧添加一列"
          onClick={() =>
            store.getState().apply("添加列", (d) =>
              insertColumn(d, {
                boardId: board.id,
                sectionId: section.id,
                columnId: section.columns[section.columns.length - 1].id,
                side: "right",
              }),
            )
          }
        >
          加列
        </button>
        <button
          type="button"
          className="canvas-prop-btn"
          disabled={!canRemoveColumn}
          title={canRemoveColumn ? "删除最后一列（仅空列）" : "仅可删除空列，且至少保留一列"}
          onClick={() =>
            store.getState().apply("减列", (d) =>
              removeColumn(d, {
                boardId: board.id,
                sectionId: section.id,
                columnId: section.columns[section.columns.length - 1].id,
              }),
            )
          }
        >
          减列
        </button>
      </div>
      <div className="canvas-prop-row canvas-prop-actions">
        <button
          type="button"
          className="canvas-prop-btn"
          onClick={() =>
            store.getState().apply("等分列宽", (d) =>
              setSectionWidthMode(d, { boardId: board.id, sectionId: section.id, mode: "equal" }),
            )
          }
        >
          等分
        </button>
        <button
          type="button"
          className="canvas-prop-btn"
          disabled={!isTwoCols}
          title={isTwoCols ? "左列占 1/3" : "仅两列可用"}
          onClick={() =>
            store.getState().apply("列宽 1:2", (d) =>
              setColumnWeights(d, { boardId: board.id, sectionId: section.id, weights: [1, 2] }),
            )
          }
        >
          1:2
        </button>
        <button
          type="button"
          className="canvas-prop-btn"
          disabled={!isTwoCols}
          title={isTwoCols ? "左列占 2/3" : "仅两列可用"}
          onClick={() =>
            store.getState().apply("列宽 2:1", (d) =>
              setColumnWeights(d, { boardId: board.id, sectionId: section.id, weights: [2, 1] }),
            )
          }
        >
          2:1
        </button>
        {canSmartRecompute(section) && (
          <button
            type="button"
            className="canvas-prop-btn"
            title="一文一图智能比例"
            onClick={() => {
              store.getState().apply("智能比例", (d) =>
                setSectionWidthMode(d, { boardId: board.id, sectionId: section.id, mode: "smart" }),
              );
              recomputeSmartSection(store, measurer, section.id);
            }}
          >
            智能
          </button>
        )}
      </div>
      {isTwoCols && (
        <label className="canvas-prop-row">
          <span className="canvas-prop-label">列宽</span>
          <input
            type="range"
            min={20}
            max={80}
            value={leftShare}
            aria-label="左列宽度占比"
            onChange={(e) => {
              const share = Number(e.target.value);
              store.getState().apply(
                "自定义列宽",
                (d) => setColumnWeights(d, { boardId: board.id, sectionId: section.id, weights: [share, 100 - share] }),
                { coalesceKey: `colw:${section.id}` },
              );
            }}
          />
          <span className="text-xs text-muted-foreground">{leftShare}%</span>
        </label>
      )}
      <ModeRow
        value={section.verticalAlign ?? "stretch"}
        options={[
          { value: "stretch", label: "拉伸" },
          { value: "top", label: "顶对齐" },
          { value: "middle", label: "居中" },
          { value: "bottom", label: "底对齐" },
        ]}
        onChange={(align) =>
          store.getState().apply("垂直对齐", (d) =>
            updateSectionLayout(d, {
              boardId: board.id,
              sectionId: section.id,
              verticalAlign: align as CanvasSectionVerticalAlign,
            }),
          )
        }
      />
      <label className="canvas-prop-row">
        <span className="canvas-prop-label">间距</span>
        <input
          type="range"
          min={0}
          max={64}
          value={section.gap ?? board.gap}
          aria-label="行内间距"
          onChange={(e) =>
            store.getState().apply(
              "行内间距",
              (d) =>
                updateSectionLayout(d, {
                  boardId: board.id,
                  sectionId: section.id,
                  gap: Number(e.target.value),
                }),
              { coalesceKey: `secgap:${section.id}` },
            )
          }
        />
        <span className="text-xs text-muted-foreground">{section.gap ?? board.gap}px</span>
      </label>
      <div className="canvas-prop-row canvas-prop-actions">
        <button
          type="button"
          className="canvas-prop-btn"
          onClick={() => store.getState().apply("复制模块", (d) => duplicateBlock(d, { blockId: block.id }))}
        >
          复制
        </button>
        <button
          type="button"
          className="canvas-prop-btn"
          onClick={() => store.getState().apply("模块上移", (d) => moveBlock(d, { blockId: block.id, direction: "up" }))}
        >
          上移
        </button>
        <button
          type="button"
          className="canvas-prop-btn"
          onClick={() =>
            store.getState().apply("模块下移", (d) => moveBlock(d, { blockId: block.id, direction: "down" }))
          }
        >
          下移
        </button>
      </div>
      <button
        type="button"
        className="canvas-prop-danger"
        onClick={() => store.getState().apply("删除模块", (d) => deleteBlock(d, { blockId: block.id }))}
      >
        <Trash2 className="h-3.5 w-3.5" /> 删除模块
      </button>
    </div>
  );
}

/** 图片块「替换图片」：走统一上传入口，保留块位置/ratio/fit/样式，失败保留旧图。 */
function ReplaceImageRow({
  onReplaceImage,
  blockId,
}: {
  onReplaceImage?: (blockId: string, file: File) => void;
  blockId: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="canvas-prop-row">
      <span className="canvas-prop-label">图片</span>
      <button
        type="button"
        className="canvas-prop-btn"
        style={{ flex: 1 }}
        onClick={() => inputRef.current?.click()}
      >
        替换图片…
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
        className="hidden"
        aria-label="选择替换图片"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && onReplaceImage) onReplaceImage(blockId, file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ---------- 小部件 ----------

function ModeRow({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="canvas-prop-row" role="radiogroup">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className={`canvas-seg ${value === opt.value ? "is-active" : ""}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SwatchRow({
  label,
  keys,
  value,
  onPick,
}: {
  label: string;
  keys: readonly string[];
  value: string;
  onPick: (key: string) => void;
}) {
  return (
    <div className="canvas-prop-row">
      <span className="canvas-prop-label">{label}</span>
      <div className="canvas-swatch-row" role="radiogroup" aria-label={label}>
        {keys.map((key) => (
          <button
            key={key || "default"}
            type="button"
            role="radio"
            aria-checked={value === key}
            title={COLOR_LABELS[key] ?? key}
            aria-label={`${label}：${COLOR_LABELS[key] ?? key}`}
            className={`canvas-swatch cv-bg-${key || "default"} ${value === key ? "is-active" : ""}`}
            onClick={() => onPick(key)}
          />
        ))}
      </div>
    </div>
  );
}

function RadiusControl({
  store,
  blockId,
  itemId,
}: {
  store: CanvasStore;
  blockId: string;
  /** 自由容器 id：传入时圆角写回自由块（findBlockLocation 只遍历 boards）。 */
  itemId?: string;
}) {
  const doc = useCanvasSelector(store, useCallback((s: ReturnType<CanvasStore["getState"]>) => s.doc, []));
  const located = findBlockLocation(doc, blockId)?.block;
  const free = itemId ? findFreeItem(doc, itemId)?.block : undefined;
  const block = located ?? free;
  if (!block) return null;
  return (
    <label className="canvas-prop-row">
      <span className="canvas-prop-label">圆角</span>
      <input
        type="range"
        min={0}
        max={32}
        value={block.style?.radius ?? 8}
        onChange={(e) =>
          store.getState().apply("圆角", (d) =>
            itemId
              ? updateFreeItemBlock(d, { itemId, style: { radius: Number(e.target.value) } })
              : updateBlockStyle(d, { blockId, style: { radius: Number(e.target.value) } }),
          )
        }
      />
    </label>
  );
}

/** 立即重算一个分区的智能比例（属性栏「智能比例」/触发点共用，B1 区块内宽版）。 */
export function recomputeSmartSection(
  store: CanvasStore,
  measurer: MeasurerLike,
  sectionId: string,
): void {
  const doc: CanvasDoc = store.getState().doc;
  for (const board of doc.boards) {
    for (const region of board.regions) {
      const section = region.sections.find((s) => s.id === sectionId);
      if (!section || section.columns.length !== 2) continue;
      const textCol = section.columns.find((c) => c.blocks.length === 1 && c.blocks[0].type === "text");
      const imageCol = section.columns.find((c) => c.blocks.length === 1 && c.blocks[0].type === "image");
      if (!textCol || !imageCol) continue;
      const textBlock = textCol.blocks[0];
      const imageBlock = imageCol.blocks[0];
      if (imageBlock.type !== "image" || !imageBlock.asset) continue;
      if (textBlock.type !== "text") continue;
      const style = resolveTextStyle(textBlock);
      const gap = regionGap(board, region);
      const contentWidth = regionInnerWidth(board, region);
      const refWidth = Math.max(40, (contentWidth - gap) / 2 - 24); // 等分参考宽，扣块内边距
      const t = measurer.measure(textBlock.text, textStyleKey(textBlock), style, refWidth);
      const ratio = imageBlock.asset.naturalHeight > 0
        ? imageBlock.asset.naturalWidth / imageBlock.asset.naturalHeight
        : 1;
      const weights = computeSmartWeights({
        contentWidth,
        gap,
        textNaturalHeightAtRef: t,
        imageRatio: ratio,
      });
      store.getState().applyLayoutOnly((d) => applySmartWeights(d, { boardId: board.id, sectionId, weights }));
      return;
    }
  }
}

/** 自由容器「移入区块…」：选择目标页面 → 区块，执行 attachFreeItemToRegion（可撤销）。 */
function MoveFreeItemDialog({
  store,
  doc,
  itemId,
  open,
  onOpenChange,
}: {
  store: CanvasStore;
  doc: CanvasDoc;
  itemId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [boardId, setBoardId] = useState("");
  const [regionId, setRegionId] = useState("");
  const boards = doc.boards;
  const effectiveBoardId = boards.some((b) => b.id === boardId) ? boardId : (boards[0]?.id ?? "");
  const regions = boards.find((b) => b.id === effectiveBoardId)?.regions ?? [];
  const effectiveRegionId = regions.some((r) => r.id === regionId)
    ? regionId
    : (regions[0]?.id ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>移入区块</DialogTitle>
          <DialogDescription>自由对象将移动到所选区块末尾（新建一行），可用 ⌘Z 撤销。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">目标页面</span>
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5"
              aria-label="目标页面"
              value={effectiveBoardId}
              onChange={(e) => {
                setBoardId(e.target.value);
                setRegionId("");
              }}
            >
              {boards.map((b, i) => (
                <option key={b.id} value={b.id}>
                  {b.name || `页面 ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">目标区块</span>
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5"
              aria-label="目标区块"
              value={effectiveRegionId}
              onChange={(e) => setRegionId(e.target.value)}
            >
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-sm"
            onClick={() => onOpenChange(false)}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            disabled={!effectiveBoardId || !effectiveRegionId}
            onClick={() => {
              store.getState().apply("移入区块", (d) =>
                attachFreeItemToRegion(d, {
                  freeItemId: itemId,
                  boardId: effectiveBoardId,
                  regionId: effectiveRegionId,
                }),
              );
              onOpenChange(false);
            }}
          >
            移入
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

