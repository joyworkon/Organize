"use client";

/**
 * 版面渲染与版面内结构交互（docs/idea-canvas-plan.md §3.2–§3.4、§4.3）。
 *
 * - 三类加号各自独立：列左右加号（整列预览）、模块底部局部加号（列内预览）、
 *   分区右下「添加通栏」（通栏预览）——位置、提示、预览互不相同；
 * - 列分隔线拖拽只在提交时进历史（拖动全程一个事务）；
 * - 版面顶栏拖动移动、右缘拖动改宽；加号/手柄尺寸随缩放补偿，保持可点。
 */

import {
  memo,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { GripHorizontal, Plus, StretchHorizontal, Trash2 } from "@/components/icons";
import {
  COLUMN_MIN_WIDTH,
  type CanvasBoard,
  type CanvasDoc,
  type CanvasSection,
  findBlockLocation,
  findSection,
} from "@/lib/canvas/model";
import {
  deleteBoard,
  insertBlockBelow,
  insertColumn,
  insertSectionAfter,
  moveBoard,
  resizeBoard,
} from "@/lib/canvas/commands";
import { canAddColumn, manualWeightsFromDrag } from "@/lib/canvas/layout";
import type { SceneBoard, SceneSection } from "@/lib/canvas/layout";
import type { CanvasStore } from "./canvas-store";
import { CanvasImageBlockView, CanvasTextBlockView, displayKey } from "./canvas-block";

export interface CanvasBoardViewProps {
  board: CanvasBoard;
  sceneBoard: SceneBoard;
  store: CanvasStore;
  zoom: number;
  interactive: boolean;
  userId: string;
  assetUrls: Record<string, string>;
  selectedBoard: boolean;
  selectedBlockId: string | null;
  editingBlockId: string | null;
}

type PlusPreview =
  | { kind: "column-left" | "column-right"; sectionId: string; columnId: string }
  | { kind: "block-below"; sectionId: string; columnId: string; blockId: string }
  | { kind: "section-band"; sectionId: string }
  | null;

interface ColumnDragState {
  sectionId: string;
  boundaryIndex: number;
  startX: number;
  startLeftWidth: number;
  startDoc: CanvasDoc;
  moved: boolean;
}

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
  selectedBlockId,
  editingBlockId,
}: CanvasBoardViewProps) {
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlusPreview>(null);
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
  const colDragRef = useRef<ColumnDragState | null>(null);
  const [colDragging, setColDragging] = useState(false);

  const ui = uiSize(zoom);
  const doc = store.getState().doc;
  const hoveredLoc = hoveredBlockId ? findBlockLocation(doc, hoveredBlockId) : null;

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
        const nx = drag.originX + dx;
        const ny = drag.originY + dy;
        setLiveTransform(null);
        store.getState().apply("移动版面", (d) => moveBoard(d, { boardId: board.id, x: nx, y: ny }));
      } else {
        const nw = drag.originWidth + dx;
        setLiveWidth(null);
        // 拖动开始前的文档进历史：整次拖动一个事务
        store.getState().history.push(drag.startDoc, "调整版面宽度");
        store.getState().applyLayoutOnly((d) => resizeBoard(d, { boardId: board.id, width: nw }));
        store.getState().requestSmartRecompute();
      }
    },
    [board.id, store, zoom],
  );

  // ---------------- 列分隔线拖拽（提交才进历史） ----------------

  const beginColDrag = useCallback(
    (e: ReactPointerEvent, section: CanvasSection, boundaryIndex: number, leftWidth: number) => {
      if (!interactive) return;
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
      setColDragging(true);
    },
    [interactive, store],
  );

  const onColDragMove = useCallback(
    (e: ReactPointerEvent) => {
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
        const sceneSec = sceneBoard.sections.find((s) => s.sectionId === drag.sectionId);
        if (!sceneSec) return { doc: d };
        const nextWeights = manualWeightsFromDrag(sceneSec.columnWidths, drag.boundaryIndex, next);
        found.section.columnWeights = nextWeights;
        found.section.widthMode = "manual";
        return { doc: d };
      });
    },
    [sceneBoard, store, zoom],
  );

  const endColDrag = useCallback(
    (e: ReactPointerEvent) => {
      const drag = colDragRef.current;
      if (!drag) return;
      e.stopPropagation();
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      colDragRef.current = null;
      setColDragging(false);
      // 拖动全程一个事务：把拖动开始前的文档压入历史
      if (drag.moved) {
        store.getState().history.push(drag.startDoc, "调整列宽");
      }
    },
    [store],
  );

  // ---------------- 加号提交 ----------------

  const commitColumnPlus = useCallback(
    (side: "left" | "right") => {
      if (!hoveredLoc) return;
      store.getState().apply("添加列", (d) =>
        insertColumn(d, {
          boardId: board.id,
          sectionId: hoveredLoc.section.id,
          columnId: hoveredLoc.column.id,
          side,
        }),
      );
      setPreview(null);
    },
    [board.id, hoveredLoc, store],
  );

  const commitBlockBelow = useCallback(() => {
    if (!hoveredLoc) return;
    store.getState().apply("下方添加模块", (d) => insertBlockBelow(d, { blockId: hoveredLoc.block.id }));
    setPreview(null);
  }, [hoveredLoc, store]);

  const commitSectionBand = useCallback(() => {
    if (!hoveredLoc) return;
    store.getState().apply("添加通栏", (d) =>
      insertSectionAfter(d, { boardId: board.id, sectionId: hoveredLoc.section.id }),
    );
    setPreview(null);
  }, [board.id, hoveredLoc, store]);

  // ---------------- 渲染 ----------------

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
        borderRadius: `${board.style?.radius ?? 12}px`,
      }}
      data-board-id={board.id}
    >
      {sceneBoard.sections.map((sceneSection) => {
        const section = board.sections.find((s) => s.id === sceneSection.sectionId);
        if (!section) return null;
        return (
          <SectionBody
            key={sceneSection.sectionId}
            board={board}
            section={section}
            sceneSection={sceneSection}
            boardPadding={board.padding}
            store={store}
            interactive={interactive}
            userId={userId}
            assetUrls={assetUrls}
            zoom={zoom}
            ui={ui}
            selectedBlockId={selectedBlockId}
            editingBlockId={editingBlockId}
            hoveredBlockId={hoveredBlockId}
            setHoveredBlockId={setHoveredBlockId}
            preview={preview}
            setPreview={setPreview}
            onCommitColumnPlus={commitColumnPlus}
            onCommitBlockBelow={commitBlockBelow}
            onCommitSectionBand={commitSectionBand}
            onColDragStart={beginColDrag}
            onColDragMove={onColDragMove}
            onColDragEnd={endColDrag}
            colDragging={colDragging}
          />
        );
      })}

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
            title="删除版面（进垃圾箱可恢复前请先确认）"
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

// ---------------------------------------------------------------------------
// 分区内部
// ---------------------------------------------------------------------------

interface SectionBodyProps {
  board: CanvasBoard;
  section: CanvasSection;
  sceneSection: SceneSection;
  boardPadding: number;
  store: CanvasStore;
  interactive: boolean;
  userId: string;
  assetUrls: Record<string, string>;
  zoom: number;
  ui: number;
  selectedBlockId: string | null;
  editingBlockId: string | null;
  hoveredBlockId: string | null;
  setHoveredBlockId: React.Dispatch<React.SetStateAction<string | null>>;
  preview: PlusPreview;
  setPreview: React.Dispatch<React.SetStateAction<PlusPreview>>;
  onCommitColumnPlus: (side: "left" | "right") => void;
  onCommitBlockBelow: () => void;
  onCommitSectionBand: () => void;
  onColDragStart: (e: ReactPointerEvent, section: CanvasSection, i: number, leftWidth: number) => void;
  onColDragMove: (e: ReactPointerEvent) => void;
  onColDragEnd: (e: ReactPointerEvent) => void;
  colDragging: boolean;
}

const SectionBody = memo(function SectionBody({
  board,
  section,
  sceneSection,
  boardPadding,
  store,
  interactive,
  userId,
  assetUrls,
  zoom,
  ui,
  selectedBlockId,
  editingBlockId,
  hoveredBlockId,
  setHoveredBlockId,
  preview,
  setPreview,
  onCommitColumnPlus,
  onCommitBlockBelow,
  onCommitSectionBand,
  onColDragStart,
  onColDragMove,
  onColDragEnd,
  colDragging,
}: SectionBodyProps) {
  const hoveredColumnId =
    hoveredBlockId && hoveredLocOf(board, hoveredBlockId)?.section.id === section.id
      ? hoveredLocOf(board, hoveredBlockId)!.column.id
      : null;
  const canGrow = interactive ? canAddColumn(board, section.columns.length) : false;
  const avgWidth = (sceneSection.columnWidths.reduce((s, w) => s + w, 0) || 1) / section.columns.length;

  return (
    <div
      className="canvas-section"
      data-section-id={section.id}
      style={{
        position: "absolute",
        left: `${boardPadding}px`,
        top: `${sceneSection.y - board.y}px`,
        width: `${board.width - boardPadding * 2}px`,
        height: `${sceneSection.height}px`,
      }}
    >
      {section.columns.map((column, columnIndex) => {
        const sceneColumn = sceneSection.columns[columnIndex];
        if (!sceneColumn) return null;
        const isHoveredColumn = column.id === hoveredColumnId;
        return (
          <div key={column.id} data-column-id={column.id} className="contents">
            {column.blocks.map((block, blockIndex) => {
              const box = sceneColumn.blocks[blockIndex];
              if (!box) return null;
              const common = {
                x: box.x - board.x,
                y: box.y - board.y,
                width: box.width,
                height: box.height,
                selected: selectedBlockId === block.id,
                store,
                interactive,
              };
              return (
                <div
                  key={block.id}
                  className="contents"
                  onPointerEnter={interactive ? () => setHoveredBlockId(block.id) : undefined}
                  onPointerLeave={
                    interactive
                      ? () => {
                          setHoveredBlockId((current) => (current === block.id ? null : current));
                          setPreview((current) => clearPreviewForBlock(current, block.id, column.id, section.id));
                        }
                      : undefined
                  }
                >
                  {block.type === "text" ? (
                    <CanvasTextBlockView
                      {...common}
                      block={block}
                      editing={editingBlockId === block.id}
                      structuralEnter
                      onEditEnd={() => store.getState().requestSmartRecompute()}
                    >
                      {/* 模块底部局部加号：只在本列向下添加（与通栏入口不同位、不同效） */}
                      {interactive && hoveredBlockId === block.id && (
                        <button
                          type="button"
                          className="canvas-plus canvas-plus-below"
                          style={{ width: `${ui}px`, height: `${ui}px` }}
                          title="在下方添加模块（仅本列）"
                          aria-label="在本列下方添加模块"
                          onPointerDown={(e) => e.stopPropagation()}
                          onMouseEnter={() =>
                            setPreview({
                              kind: "block-below",
                              sectionId: section.id,
                              columnId: column.id,
                              blockId: block.id,
                            })
                          }
                          onMouseLeave={() => setPreview(null)}
                          onClick={() => onCommitBlockBelow()}
                        >
                          <Plus style={{ width: ui * 0.55, height: ui * 0.55 }} />
                        </button>
                      )}
                    </CanvasTextBlockView>
                  ) : (
                    <CanvasImageBlockView
                      {...common}
                      block={block}
                      userId={userId}
                      resolvedUrl={
                        block.asset ? assetUrls[displayKey(block.id, block.asset)] ?? (block.asset.url || null) : null
                      }
                    >
                      {interactive && hoveredBlockId === block.id && (
                        <button
                          type="button"
                          className="canvas-plus canvas-plus-below"
                          style={{ width: `${ui}px`, height: `${ui}px` }}
                          title="在下方添加模块（仅本列）"
                          aria-label="在本列下方添加模块"
                          onPointerDown={(e) => e.stopPropagation()}
                          onMouseEnter={() =>
                            setPreview({
                              kind: "block-below",
                              sectionId: section.id,
                              columnId: column.id,
                              blockId: block.id,
                            })
                          }
                          onMouseLeave={() => setPreview(null)}
                          onClick={() => onCommitBlockBelow()}
                        >
                          <Plus style={{ width: ui * 0.55, height: ui * 0.55 }} />
                        </button>
                      )}
                    </CanvasImageBlockView>
                  )}
                </div>
              );
            })}

            {/* 列左右加号（悬停本列时显示；预览为贯穿整排的整列） */}
            {interactive && isHoveredColumn && (
              <>
                <button
                  type="button"
                  className={`canvas-plus canvas-plus-column ${canGrow ? "" : "is-disabled"}`}
                  style={{ left: `${-ui / 2}px`, top: "50%", width: `${ui}px`, height: `${ui}px`, transform: "translateY(-50%)" }}
                  title={canGrow ? "在左侧添加一列" : "版面宽度不足，请先加宽版面"}
                  aria-label="在左侧添加一列"
                  disabled={!canGrow}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseEnter={() => setPreview({ kind: "column-left", sectionId: section.id, columnId: column.id })}
                  onMouseLeave={() => setPreview(null)}
                  onClick={() => onCommitColumnPlus("left")}
                >
                  <Plus style={{ width: ui * 0.55, height: ui * 0.55 }} />
                </button>
                <button
                  type="button"
                  className={`canvas-plus canvas-plus-column ${canGrow ? "" : "is-disabled"}`}
                  style={{
                    right: `${-ui / 2}px`,
                    top: "50%",
                    width: `${ui}px`,
                    height: `${ui}px`,
                    transform: "translateY(-50%)",
                  }}
                  title={canGrow ? "在右侧添加一列" : "版面宽度不足，请先加宽版面"}
                  aria-label="在右侧添加一列"
                  disabled={!canGrow}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseEnter={() => setPreview({ kind: "column-right", sectionId: section.id, columnId: column.id })}
                  onMouseLeave={() => setPreview(null)}
                  onClick={() => onCommitColumnPlus("right")}
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
            className={`canvas-divider ${colDragging ? "is-dragging" : ""}`}
            style={{ left: `${sceneSection.columns[i].x - board.x + w + board.gap / 2}px` }}
            role="separator"
            aria-label="拖动调整列宽"
            title="拖动调整列宽"
            onPointerDown={(e) => onColDragStart(e, section, i, w)}
            onPointerMove={onColDragMove}
            onPointerUp={onColDragEnd}
          />
        ))}

      {/* 加号悬停插入预览（半透明，不参与布局，规格 §4.3） */}
      {preview && preview.sectionId === section.id && (
        <PreviewGhost
          preview={preview}
          board={board}
          sceneSection={sceneSection}
          avgWidth={avgWidth}
        />
      )}

      {/* 整排外侧「添加通栏」入口：与局部加号不同位、不同预览 */}
      {interactive && hoveredBlockId && hoveredColumnId && (
        <button
          type="button"
          className="canvas-plus canvas-plus-band"
          style={{ width: "auto", height: `${ui}px`, padding: `0 ${ui * 0.4}px` }}
          title="添加通栏（整排下方，与 Enter 相同）"
          aria-label="添加通栏"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseEnter={() => setPreview({ kind: "section-band", sectionId: section.id })}
          onMouseLeave={() => setPreview(null)}
          onClick={() => onCommitSectionBand()}
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
  board,
  sceneSection,
  avgWidth,
}: {
  preview: PlusPreview;
  board: CanvasBoard;
  sceneSection: SceneSection;
  avgWidth: number;
}) {
  const style: CSSProperties = { position: "absolute" };
  if (!preview) return null;
  if (preview.kind === "column-left") {
    const col = sceneSection.columns.find((c) => c.columnId === preview.columnId);
    if (!col) return null;
    Object.assign(style, {
      left: `${col.x - board.x - avgWidth / 2 - board.gap / 2}px`,
      top: "0",
      width: `${avgWidth}px`,
      height: "100%",
    });
  } else if (preview.kind === "column-right") {
    const col = sceneSection.columns.find((c) => c.columnId === preview.columnId);
    if (!col) return null;
    Object.assign(style, {
      left: `${col.x - board.x + col.width + board.gap / 2}px`,
      top: "0",
      width: `${avgWidth}px`,
      height: "100%",
    });
  } else if (preview.kind === "block-below") {
    const col = sceneSection.columns.find((c) => c.columnId === preview.columnId);
    const box = col?.blocks.find((b) => b.blockId === preview.blockId);
    if (!col || !box) return null;
    Object.assign(style, {
      left: `${box.x - board.x}px`,
      top: `${box.y - board.y + box.height + board.gap / 2}px`,
      width: `${box.width}px`,
      height: "48px",
    });
  } else {
    Object.assign(style, {
      left: "0",
      top: `${sceneSection.height + board.gap / 2}px`,
      width: "100%",
      height: "48px",
    });
  }
  return <div className="canvas-insert-preview" style={style} aria-hidden="true" />;
}

function hoveredLocOf(board: CanvasBoard, blockId: string) {
  for (const section of board.sections) {
    for (const column of section.columns) {
      if (column.blocks.some((b) => b.id === blockId)) {
        return { section, column };
      }
    }
  }
  return null;
}

/** 离开块时清除相关加号预览（仅清自己触发的，保留其它悬停态）。 */
function clearPreviewForBlock(
  current: PlusPreview,
  blockId: string,
  columnId: string,
  sectionId: string,
): PlusPreview {
  if (!current) return null;
  if (current.kind === "block-below" && current.blockId === blockId) return null;
  if ((current.kind === "column-left" || current.kind === "column-right") && current.columnId === columnId) {
    return null;
  }
  if (current.kind === "section-band" && current.sectionId === sectionId) return null;
  return current;
}
