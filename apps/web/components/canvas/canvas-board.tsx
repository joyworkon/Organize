"use client";

/**
 * 版面渲染与版面内结构交互（docs/idea-canvas-plan.md §3.2–§3.4、§4.3；
 * 阶段 B1：版面 → 区块 → 行 → 列 → 块）。
 *
 * - 区块（Region）有独立外框与可编辑名称；编辑态轻量边框（--border 级），
 *   选中态只强调当前对象与必要父级，避免多层粗边框；
 * - 三类加号各自独立：列左右加号（整列预览）、模块底部局部加号（列内预览）、
 *   行右下「添加通栏」（通栏预览）——位置、提示、预览互不相同；
 * - 悬停状态挂在行容器上（块→加号的指针移动不离开行子树，
 *   加号不会中途卸载）；离开行才清除；
 * - 列分隔线拖拽与版面拖动/改宽全程一个事务；
 * - 加号/手柄尺寸随缩放补偿，保持可点（规格 §4.3）。
 */

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { GripHorizontal, Plus, StretchHorizontal, Trash2 } from "@/components/icons";
import {
  COLUMN_MIN_WIDTH,
  type CanvasBoard,
  type CanvasDoc,
  type CanvasRegion,
  type CanvasSection,
  findSection,
} from "@/lib/canvas/model";
import {
  deleteBoard,
  insertBlockBelow,
  insertColumn,
  insertRegionAfter,
  insertSectionAfter,
  moveBoard,
  renameRegion,
  resizeBoard,
} from "@/lib/canvas/commands";
import {
  canAddColumnAt,
  manualWeightsFromDrag,
  regionGap,
  regionInnerWidth,
  regionPadding,
} from "@/lib/canvas/layout";
import type { SceneBoard, SceneRegion, SceneSection } from "@/lib/canvas/layout";
import type { CanvasStore } from "./canvas-store";
import {
  CanvasButtonBlockView,
  CanvasDividerBlockView,
  CanvasImageBlockView,
  CanvasTextBlockView,
  displayKey,
} from "./canvas-block";

export interface CanvasBoardViewProps {
  board: CanvasBoard;
  sceneBoard: SceneBoard;
  store: CanvasStore;
  zoom: number;
  interactive: boolean;
  userId: string;
  assetUrls: Record<string, string>;
  selectedBoard: boolean;
  selectedRegion: { boardId: string; regionId: string } | null;
  selectedBlockId: string | null;
  editingBlockId: string | null;
  /** 图片替换（B2 统一上传入口）：块原位更新，失败保留旧图。 */
  onReplaceImage?: (blockId: string, file: File) => void;
}

type PlusPreview =
  | { kind: "column-left" | "column-right"; columnId: string }
  | { kind: "block-below"; columnId: string; blockId: string }
  | { kind: "section-band" }
  | { kind: "region-band" }
  | null;

/** 随缩放补偿的控件尺寸：世界尺寸 = 22px / zoom，夹在 22–64。 */
function uiSize(zoom: number): number {
  return Math.min(64, Math.max(22, 22 / zoom));
}

export const CanvasBoardView = memo(function CanvasBoardView({
  board,
  sceneBoard,
  store,
  zoom,
  interactive,
  userId,
  assetUrls,
  selectedBoard,
  selectedRegion,
  selectedBlockId,
  editingBlockId,
  onReplaceImage,
}: CanvasBoardViewProps) {
  const dragRef = useRef<{
    kind: "move" | "resize";
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originWidth: number;
    startDoc: CanvasDoc;
    raf: number | null;
    moved: boolean;
  } | null>(null);
  const [liveTransform, setLiveTransform] = useState<{ dx: number; dy: number } | null>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  /** 悬停的区块间隙（在其后插入新区块）；null = 未悬停。 */
  const [gapHover, setGapHover] = useState<number | null>(null);
  const [gapPreview, setGapPreview] = useState(false);

  const ui = uiSize(zoom);
  const colDrag = useRef(beginColDragFor(store, zoom, sceneBoard));

  // ---------------- 版面移动 / 改宽（拖动全程一个事务） ----------------

  const beginBoardDrag = useCallback(
    (e: ReactPointerEvent, kind: "move" | "resize") => {
      if (!interactive) return;
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        kind,
        startX: e.clientX,
        startY: e.clientY,
        originX: board.x,
        originY: board.y,
        originWidth: board.width,
        startDoc: store.getState().doc,
        raf: null,
        moved: false,
      };
    },
    [board.width, board.x, board.y, interactive, store],
  );

  const onBoardDragMove = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.stopPropagation();
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
      if (drag.raf) cancelAnimationFrame(drag.raf);
      drag.raf = requestAnimationFrame(() => {
        if (drag.kind === "move") setLiveTransform({ dx, dy });
        else setLiveWidth(drag.originWidth + dx);
      });
    },
    [zoom],
  );

  const endBoardDrag = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      e.stopPropagation();
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      dragRef.current = null;
      if (drag.raf) cancelAnimationFrame(drag.raf);
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      if (!drag.moved) {
        setLiveTransform(null);
        setLiveWidth(null);
        return;
      }
      if (drag.kind === "move") {
        setLiveTransform(null);
        store.getState().apply("移动版面", (d) => moveBoard(d, { boardId: board.id, x: drag.originX + dx, y: drag.originY + dy }));
      } else {
        setLiveWidth(null);
        // 拖动开始前的文档进历史：整次拖动一个事务
        store.getState().history.push(drag.startDoc, "调整版面宽度");
        store.getState().applyLayoutOnly((d) => resizeBoard(d, { boardId: board.id, width: drag.originWidth + dx }));
        store.getState().requestSmartRecompute();
      }
    },
    [board.id, store, zoom],
  );

  const width = liveWidth ?? board.width;

  return (
    <div
      className={`canvas-board ${selectedBoard ? "is-selected" : ""} ${interactive ? "" : "is-static"}`}
      style={{
        left: `${board.x + (liveTransform?.dx ?? 0)}px`,
        top: `${board.y + (liveTransform?.dy ?? 0)}px`,
        width: `${width}px`,
        height: `${sceneBoard.height}px`,
        background: board.style?.background ? `var(--cv-bg-${board.style.background})` : undefined,
        borderRadius: board.style?.radius != null ? `${board.style.radius}px` : "var(--radius-xl)",
      }}
      data-board-id={board.id}
    >
      {sceneBoard.regions.map((sceneRegion) => {
        const region = board.regions.find((r) => r.id === sceneRegion.regionId);
        if (!region) return null;
        return (
          <RegionBody
            key={sceneRegion.regionId}
            board={board}
            region={region}
            sceneRegion={sceneRegion}
            store={store}
            interactive={interactive}
            userId={userId}
            assetUrls={assetUrls}
            zoom={zoom}
            ui={ui}
            selected={selectedRegion?.regionId === region.id}
            selectedBlockId={selectedBlockId}
            editingBlockId={editingBlockId}
            colDrag={colDrag.current}
            onReplaceImage={onReplaceImage}
          />
        );
      })}

      {/* 区块间隙「＋」（B2）：在两个区块之间插入新区块，与块下＋/行边缘＋语义不同 */}
      {interactive &&
        sceneBoard.regions.slice(0, -1).map((sceneRegion, i) => (
          <div
            key={`region-gap-${sceneRegion.regionId}`}
            className="canvas-region-gap"
            style={{
              left: `${board.padding}px`,
              width: `${board.width - board.padding * 2}px`,
              top: `${sceneRegion.y + sceneRegion.height - board.y - 4}px`,
              height: `${board.gap + 8}px`,
            }}
            onPointerEnter={() => {
              setGapHover(i);
              setGapPreview(true);
            }}
            onPointerLeave={() => {
              setGapHover(null);
              setGapPreview(false);
            }}
          >
            {gapHover === i && (
              <button
                type="button"
                className="canvas-plus canvas-plus-region"
                style={{ width: `${Math.max(20, ui * 0.9)}px`, height: `${Math.max(20, ui * 0.9)}px` }}
                title="在下方添加区块"
                aria-label="在下方添加区块"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  const afterId = sceneBoard.regions[i]?.regionId;
                  store.getState().apply("添加区块", (d) =>
                    insertRegionAfter(d, { boardId: board.id, regionId: afterId }),
                  );
                  setGapHover(null);
                  setGapPreview(false);
                }}
              >
                <Plus style={{ width: ui * 0.5, height: ui * 0.5 }} />
              </button>
            )}
            {gapPreview && gapHover === i && (
              <div className="canvas-insert-preview canvas-region-insert-preview" aria-hidden="true" />
            )}
          </div>
        ))}

      {/* 版面操作条（悬停显示）：拖动移动 + 删除 */}
      {interactive && (
        <div className="canvas-board-handle">
          <div
            className="canvas-board-handle-grip"
            title="拖动移动版面"
            aria-label="拖动移动版面"
            role="button"
            tabIndex={0}
            onPointerDown={(e) => beginBoardDrag(e, "move")}
            onPointerMove={onBoardDragMove}
            onPointerUp={endBoardDrag}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 40 : 10;
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                store.getState().apply("移动版面", (d) => moveBoard(d, { boardId: board.id, x: board.x - step, y: board.y }));
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                store.getState().apply("移动版面", (d) => moveBoard(d, { boardId: board.id, x: board.x + step, y: board.y }));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                store.getState().apply("移动版面", (d) => moveBoard(d, { boardId: board.id, x: board.x, y: board.y - step }));
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                store.getState().apply("移动版面", (d) => moveBoard(d, { boardId: board.id, x: board.x, y: board.y + step }));
              }
            }}
          >
            <GripHorizontal style={{ width: ui * 0.8, height: ui * 0.8 }} />
          </div>
          <button
            type="button"
            className="canvas-board-delete"
            title="删除版面"
            aria-label="删除版面"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => store.getState().apply("删除版面", (d) => deleteBoard(d, { boardId: board.id }))}
          >
            <Trash2 style={{ width: ui * 0.7, height: ui * 0.7 }} />
          </button>
        </div>
      )}

      {/* 右缘改宽手柄 */}
      {interactive && (
        <div
          className="canvas-board-resize"
          title="拖动调整版面宽度"
          aria-label="拖动调整版面宽度"
          role="button"
          tabIndex={0}
          style={{ width: `${Math.max(12, ui * 0.5)}px` }}
          onPointerDown={(e) => beginBoardDrag(e, "resize")}
          onPointerMove={onBoardDragMove}
          onPointerUp={endBoardDrag}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              store.getState().apply("调整版面宽度", (d) => resizeBoard(d, { boardId: board.id, width: board.width - 20 }));
              store.getState().requestSmartRecompute();
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              store.getState().apply("调整版面宽度", (d) => resizeBoard(d, { boardId: board.id, width: board.width + 20 }));
              store.getState().requestSmartRecompute();
            }
          }}
        />
      )}
    </div>
  );
});

/** 列分隔线拖拽句柄工厂：拖动全程一个事务（提交时把拖前快照压入历史）。 */
function beginColDragFor(store: CanvasStore, zoom: number, sceneBoard: SceneBoard) {
  const colDragRef = { current: null as null | {
    sectionId: string;
    boundaryIndex: number;
    startX: number;
    startLeftWidth: number;
    startDoc: CanvasDoc;
    moved: boolean;
  } };
  return {
    colDragRef,
    onColDragStart(e: ReactPointerEvent, section: CanvasSection, boundaryIndex: number, leftWidth: number) {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      colDragRef.current = {
        sectionId: section.id,
        boundaryIndex,
        startX: e.clientX,
        startLeftWidth: leftWidth,
        startDoc: store.getState().doc,
        moved: false,
      };
    },
    onColDragMove(e: ReactPointerEvent) {
      const drag = colDragRef.current;
      if (!drag) return;
      e.stopPropagation();
      const dx = (e.clientX - drag.startX) / zoom;
      if (Math.abs(dx) > 2) drag.moved = true;
      const next = Math.max(COLUMN_MIN_WIDTH, drag.startLeftWidth + dx);
      // live 更新走 layoutOnly（手动比例，不受 smart 覆盖）；结束时统一进历史
      store.getState().applyLayoutOnly((d) => {
        const found = findSection(d, drag.sectionId);
        if (!found) return { doc: d };
        const sceneSec = sceneBoard.regions
          .flatMap((r) => r.sections)
          .find((s) => s.sectionId === drag.sectionId);
        if (!sceneSec) return { doc: d };
        const nextWeights = manualWeightsFromDrag(sceneSec.columnWidths, drag.boundaryIndex, next);
        found.section.columnWeights = nextWeights;
        found.section.widthMode = "manual";
        return { doc: d };
      });
    },
    onColDragEnd(e: ReactPointerEvent) {
      const drag = colDragRef.current;
      if (!drag) return;
      e.stopPropagation();
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      colDragRef.current = null;
      if (drag.moved) {
        // 拖动全程一个事务：把拖动开始前的文档压入历史
        store.getState().history.push(drag.startDoc, "调整列宽");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 区块（Region，B1）：独立外框 + 可编辑名称；行在区块内排版
// ---------------------------------------------------------------------------

interface RegionBodyProps {
  board: CanvasBoard;
  region: CanvasRegion;
  sceneRegion: SceneRegion;
  store: CanvasStore;
  interactive: boolean;
  userId: string;
  assetUrls: Record<string, string>;
  zoom: number;
  ui: number;
  selected: boolean;
  selectedBlockId: string | null;
  editingBlockId: string | null;
  colDrag: ReturnType<typeof beginColDragFor>;
  onReplaceImage?: (blockId: string, file: File) => void;
}

const RegionBody = memo(function RegionBody({
  board,
  region,
  sceneRegion,
  store,
  interactive,
  userId,
  assetUrls,
  ui,
  selected,
  selectedBlockId,
  editingBlockId,
  colDrag,
  onReplaceImage,
}: RegionBodyProps) {
  const pad = regionPadding(board, region);
  const inner = regionInnerWidth(board, region);
  // 区块内容区相对版面原点的偏移
  const offsetX = board.padding + pad;
  const decorated = region.style?.border === true;

  return (
    <div
      className={`canvas-region ${selected ? "is-selected" : ""} ${interactive ? "" : "is-static"} ${
        decorated ? "is-decorated" : ""
      }`}
      data-region-id={region.id}
      style={{
        left: `${board.padding}px`,
        top: `${sceneRegion.y - board.y}px`,
        width: `${board.width - board.padding * 2}px`,
        height: `${sceneRegion.height}px`,
        padding: `${pad}px`,
        background: region.style?.background ? `var(--cv-bg-${region.style.background})` : undefined,
      }}
      onPointerDown={
        interactive
          ? (e) => {
              // 点击区块空白（非块/列/加号）时选中区块本身
              const target = e.target as HTMLElement;
              if (target.closest("[data-block-id], [data-column-id], button, input, textarea")) return;
              store.getState().select({ kind: "region", boardId: board.id, regionId: region.id });
            }
          : undefined
      }
    >
      <RegionNameLabel
        boardId={board.id}
        region={region}
        store={store}
        editable={interactive}
      />
      <div className="canvas-region-content" style={{ position: "relative", width: `${inner}px`, height: "100%" }}>
        {sceneRegion.sections.map((sceneSection) => {
          const section = region.sections.find((s) => s.id === sceneSection.sectionId);
          if (!section) return null;
          return (
            <SectionBody
              key={sceneSection.sectionId}
              board={board}
              section={section}
              sceneSection={sceneSection}
              offsetX={offsetX}
              offsetY={sceneSection.y - board.y}
              contentWidth={inner}
              gap={regionGap(board, region)}
              store={store}
              interactive={interactive}
              userId={userId}
              assetUrls={assetUrls}
              ui={ui}
              selectedBlockId={selectedBlockId}
              editingBlockId={editingBlockId}
              colDrag={colDrag}
              onReplaceImage={onReplaceImage}
            />
          );
        })}
      </div>
    </div>
  );
});

/** 区块名：编辑态点击进入编辑（输入框按键不触发画布快捷键，由工作区 isTypingTarget 统一屏蔽）。 */
function RegionNameLabel({
  boardId,
  region,
  store,
  editable,
}: {
  boardId: string;
  region: CanvasRegion;
  store: CanvasStore;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(region.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== region.name) {
      store.getState().apply("重命名区块", (d) => renameRegion(d, { boardId, regionId: region.id, name }));
    } else {
      setDraft(region.name);
    }
  }, [boardId, draft, region.id, region.name, store]);

  if (!editable) {
    // 预览/只读：有名称时作为区块标题文本显示
    return region.name ? (
      <div className="canvas-region-title" data-region-name>
        {region.name}
      </div>
    ) : null;
  }
  if (editing) {
    return (
      <input
        ref={inputRef}
        className="canvas-region-name-input"
        value={draft}
        aria-label="区块名称"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(region.name);
            setEditing(false);
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <button
      type="button"
      className="canvas-region-name"
      data-region-name
      title="点击重命名区块"
      aria-label={`区块名称：${region.name}（点击重命名）`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        setDraft(region.name);
        setEditing(true);
      }}
    >
      {region.name}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 行内部：悬停状态挂在行容器（块→加号的移动不离开子树，加号不卸载）
// ---------------------------------------------------------------------------

interface SectionBodyProps {
  board: CanvasBoard;
  section: CanvasSection;
  sceneSection: SceneSection;
  /** 行内容区相对版面原点的偏移 x（= 版面 padding + 区块 padding）。 */
  offsetX: number;
  /** 行内容区相对版面原点的偏移 y。 */
  offsetY: number;
  /** 行内容宽（区块内宽）。 */
  contentWidth: number;
  /** 行内列/块间距缺省值（区块行距；行级 section.gap 优先）。 */
  gap: number;
  store: CanvasStore;
  interactive: boolean;
  userId: string;
  assetUrls: Record<string, string>;
  ui: number;
  selectedBlockId: string | null;
  editingBlockId: string | null;
  colDrag: ReturnType<typeof beginColDragFor>;
  onReplaceImage?: (blockId: string, file: File) => void;
}

const SectionBody = memo(function SectionBody({
  board,
  section,
  sceneSection,
  offsetX,
  offsetY,
  contentWidth,
  gap,
  store,
  interactive,
  userId,
  assetUrls,
  ui,
  selectedBlockId,
  editingBlockId,
  colDrag,
  onReplaceImage,
}: SectionBodyProps) {
  const [hovered, setHovered] = useState<{ blockId: string; columnId: string } | null>(null);
  const [preview, setPreview] = useState<PlusPreview>(null);

  const effectiveGap = section.gap ?? gap;
  const canGrow = interactive ? canAddColumnAt(contentWidth, effectiveGap, section.columns.length) : false;
  const avgWidth = (sceneSection.columnWidths.reduce((s, w) => s + w, 0) || 1) / section.columns.length;

  const commitColumnPlus = useCallback(
    (side: "left" | "right") => {
        if (!hovered) return;
      store.getState().apply("添加列", (d) =>
        insertColumn(d, {
          boardId: board.id,
          sectionId: section.id,
          columnId: hovered.columnId,
          side,
        }),
      );
      setPreview(null);
    },
    [board.id, hovered, section.id, store],
  );

  const commitBlockBelow = useCallback(() => {
    if (!hovered) return;
    store.getState().apply("下方添加模块", (d) => insertBlockBelow(d, { blockId: hovered.blockId }));
    setPreview(null);
  }, [hovered, store]);

  const commitSectionBand = useCallback(() => {
    store.getState().apply("添加通栏", (d) =>
      insertSectionAfter(d, { boardId: board.id, sectionId: section.id }),
    );
    setPreview(null);
  }, [board.id, section.id, store]);

  return (
    <div
      className="canvas-section"
      data-section-id={section.id}
      style={{
        position: "absolute",
        left: `${offsetX}px`,
        top: `${offsetY}px`,
        width: `${contentWidth}px`,
        height: `${sceneSection.height}px`,
      }}
      onPointerLeave={
        interactive
          ? () => {
              setHovered(null);
              setPreview(null);
            }
          : undefined
      }
    >
      {section.columns.map((column, columnIndex) => {
        const sceneColumn = sceneSection.columns[columnIndex];
        if (!sceneColumn) return null;
        const isHoveredColumn = interactive && hovered?.columnId === column.id;
        const colLeft = sceneColumn.x - board.x - offsetX;
        return (
          <div key={column.id} data-column-id={column.id} className="contents">
            {column.blocks.map((block, blockIndex) => {
              const box = sceneColumn.blocks[blockIndex];
              if (!box) return null;
              // 行内坐标：行容器已按 (offsetX, offsetY) 定位，
              // 块再用世界-版面相对值会双重偏移
              const secX = board.x + offsetX;
              const secY = board.y + offsetY;
              const common = {
                x: box.x - secX,
                y: box.y - secY,
                width: box.width,
                height: box.height,
                selected: selectedBlockId === block.id,
                store,
                interactive,
              };
              const belowPlus =
                interactive && hovered?.blockId === block.id ? (
                  <button
                    type="button"
                    className="canvas-plus canvas-plus-below"
                    style={{ width: `${ui}px`, height: `${ui}px` }}
                    title="在下方添加模块（仅本列）"
                    aria-label="在本列下方添加模块"
                    onPointerDown={(e) => {
                      // pointerdown 提交：press 即响应，且 preventDefault 抑制后续 click 双触发
                      e.stopPropagation();
                      e.preventDefault();
                      commitBlockBelow();
                    }}
                    onMouseEnter={() => setPreview({ kind: "block-below", columnId: column.id, blockId: block.id })}
                    onMouseLeave={() => setPreview(null)}
                  >
                    <Plus style={{ width: ui * 0.55, height: ui * 0.55 }} />
                  </button>
                ) : null;
              const hoverWrapper = (node: ReactNode) => (
                <div
                  key={block.id}
                  className="contents"
                  onPointerEnter={
                    interactive
                      ? () => setHovered({ blockId: block.id, columnId: column.id })
                      : undefined
                  }
                >
                  {node}
                </div>
              );
              if (block.type === "text") {
                return hoverWrapper(
                  <CanvasTextBlockView
                    {...common}
                    block={block}
                    editing={editingBlockId === block.id}
                    structuralEnter
                    onEditEnd={() => store.getState().requestSmartRecompute()}
                  >
                    {belowPlus}
                  </CanvasTextBlockView>,
                );
              }
              if (block.type === "divider") {
                return hoverWrapper(
                  <CanvasDividerBlockView {...common} block={block}>
                    {belowPlus}
                  </CanvasDividerBlockView>,
                );
              }
              if (block.type === "button") {
                return hoverWrapper(
                  <CanvasButtonBlockView {...common} block={block}>
                    {belowPlus}
                  </CanvasButtonBlockView>,
                );
              }
              return hoverWrapper(
                <CanvasImageBlockView
                  {...common}
                  block={block}
                  userId={userId}
                  onReplace={onReplaceImage}
                  resolvedUrl={
                    block.asset
                      ? assetUrls[displayKey(block.id, block.asset)] ?? (block.asset.url || null)
                      : null
                  }
                >
                  {belowPlus}
                </CanvasImageBlockView>,
              );
            })}

            {/* 列左右加号：定位到所悬停列的左/右边缘，垂直居中贯穿整列 */}
            {isHoveredColumn && (
              <>
                <button
                  type="button"
                  className={`canvas-plus canvas-plus-column ${canGrow ? "" : "is-disabled"}`}
                  style={{
                    left: `${colLeft - ui / 2}px`,
                    top: "50%",
                    width: `${ui}px`,
                    height: `${ui}px`,
                    transform: "translateY(-50%)",
                  }}
                  title={canGrow ? "在左侧添加一列" : "版面宽度不足，请先加宽版面"}
                  aria-label="在左侧添加一列"
                  disabled={!canGrow}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    commitColumnPlus("left");
                  }}
                  onMouseEnter={() => setPreview({ kind: "column-left", columnId: column.id })}
                  onMouseLeave={() => setPreview(null)}
                >
                  <Plus style={{ width: ui * 0.55, height: ui * 0.55 }} />
                </button>
                <button
                  type="button"
                  className={`canvas-plus canvas-plus-column ${canGrow ? "" : "is-disabled"}`}
                  style={{
                    left: `${colLeft + sceneColumn.width - ui / 2}px`,
                    top: "50%",
                    width: `${ui}px`,
                    height: `${ui}px`,
                    transform: "translateY(-50%)",
                  }}
                  title={canGrow ? "在右侧添加一列" : "版面宽度不足，请先加宽版面"}
                  aria-label="在右侧添加一列"
                  disabled={!canGrow}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    commitColumnPlus("right");
                  }}
                  onMouseEnter={() => setPreview({ kind: "column-right", columnId: column.id })}
                  onMouseLeave={() => setPreview(null)}
                >
                  <Plus style={{ width: ui * 0.55, height: ui * 0.55 }} />
                </button>
              </>
            )}
          </div>
        );
      })}

      {/* 列间分隔线 */}
      {interactive &&
        sceneSection.columnWidths.slice(0, -1).map((w, i) => (
          <div
            key={`divider-${i}`}
            className="canvas-divider"
            style={{ left: `${sceneSection.columns[i].x - board.x - offsetX + w + effectiveGap / 2}px` }}
            role="separator"
            aria-label="拖动调整列宽"
            title="拖动调整列宽"
            onPointerDown={(e) => colDrag.onColDragStart(e, section, i, w)}
            onPointerMove={(e) => colDrag.onColDragMove(e)}
            onPointerUp={(e) => colDrag.onColDragEnd(e)}
          />
        ))}

      {/* 加号悬停插入预览（半透明，不参与布局，规格 §4.3；位置全部来自 computeScene 场景几何） */}
      {preview && <PreviewGhost preview={preview} gap={effectiveGap} sceneSection={sceneSection} avgWidth={avgWidth} />}

      {/* 整排外侧「添加通栏」入口：与局部加号不同位、不同预览、不同提示 */}
      {interactive && hovered && (
        <button
          type="button"
          className="canvas-plus canvas-plus-band"
          style={{ width: "auto", height: `${ui}px`, padding: `0 ${ui * 0.4}px` }}
          title="添加通栏（整排下方，与 Enter 相同）"
          aria-label="添加通栏"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            commitSectionBand();
          }}
          onMouseEnter={() => setPreview({ kind: "section-band" })}
          onMouseLeave={() => setPreview(null)}
        >
          <StretchHorizontal style={{ width: ui * 0.6, height: ui * 0.6 }} />
          <Plus style={{ width: ui * 0.45, height: ui * 0.45 }} />
        </button>
      )}
    </div>
  );
});

function PreviewGhost({
  preview,
  gap,
  sceneSection,
  avgWidth,
}: {
  preview: PlusPreview;
  gap: number;
  sceneSection: SceneSection;
  avgWidth: number;
}) {
  const style: CSSProperties = { position: "absolute" };
  if (!preview) return null;
  const secY = sceneSection.y;
  if (preview.kind === "column-left") {
    const col = sceneSection.columns.find((c) => c.columnId === preview.columnId);
    if (!col) return null;
    Object.assign(style, {
      left: `${col.x - sceneSection.columns[0].x - avgWidth / 2 - gap / 2}px`,
      top: "0",
      width: `${avgWidth}px`,
      height: "100%",
    });
  } else if (preview.kind === "column-right") {
    const col = sceneSection.columns.find((c) => c.columnId === preview.columnId);
    if (!col) return null;
    Object.assign(style, {
      left: `${col.x - sceneSection.columns[0].x + col.width + gap / 2}px`,
      top: "0",
      width: `${avgWidth}px`,
      height: "100%",
    });
  } else if (preview.kind === "block-below") {
    const col = sceneSection.columns.find((c) => c.columnId === preview.columnId);
    const box = col?.blocks.find((b) => b.blockId === preview.blockId);
    if (!col || !box) return null;
    Object.assign(style, {
      left: `${box.x - sceneSection.columns[0].x}px`,
      top: `${box.y - secY + box.height + gap / 2}px`,
      width: `${box.width}px`,
      height: "48px",
    });
  } else {
    Object.assign(style, {
      left: "0",
      top: `${sceneSection.height + gap / 2}px`,
      width: "100%",
      height: "48px",
    });
  }
  return <div className="canvas-insert-preview" style={style} aria-hidden="true" />;
}
