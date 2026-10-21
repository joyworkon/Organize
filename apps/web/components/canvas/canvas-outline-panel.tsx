"use client";

/**
 * 左侧「结构」大纲与「模板」分组（B1 内容；B2 拆分为可复用分组，
 * 由 canvas-add-panel 的折叠区直接组合，本文件不再提供独立面板包装）。
 *
 * - 结构：页面 → 区块树（缩进列表）；点击选中并平移使其可见（不改缩放）；
 *   双击名称或点铅笔图标改名；上移/下移/复制/删除小图标按钮（aria-label 齐全）。
 * - 模板：空白结构 / 图文介绍 / 三列卖点 / 行动区，插入到当前选中页面
 *   （无选中页面时先新建空白页面再插入，由工作区编排）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FilePlus,
  Image as ImageIcon,
  LayoutTemplate,
  Maximize2,
  Pencil,
  Trash2,
  Type as TypeIcon,
} from "@/components/icons";
import {
  renameBoard,
  deleteRegion,
  duplicateRegion,
  moveRegion,
  moveBoardInOrder,
  renameRegion,
  type CanvasTemplateKind,
} from "@/lib/canvas/commands";
import { Button } from "@/components/ui/button";
import { commitBoardDuplicate, confirmBoardDeletion } from "./canvas-board-actions";
import type { CanvasStore } from "./canvas-store";
import { useCanvasSelector } from "./use-canvas-selector";

export interface CanvasOutlineTreeProps {
  store: CanvasStore;
  /** 选中页面并适合该页（不写文档）。 */
  onFit?: (target: { kind: "board"; boardId: string }) => void;
  /** 选中并平移目标到视口中央（不改缩放）。 */
  onReveal: (target:
    | { kind: "board"; boardId: string }
    | { kind: "region"; boardId: string; regionId: string }) => void;
}

const TEMPLATES: Array<{ kind: CanvasTemplateKind; label: string; hint: string; icon: typeof LayoutTemplate }> = [
  { kind: "blank-structure", label: "空白结构", hint: "一个空正文块", icon: LayoutTemplate },
  { kind: "image-text", label: "图文介绍", hint: "双列：左文右图", icon: ImageIcon },
  { kind: "three-columns", label: "三列卖点", hint: "三列各一标题+正文", icon: FilePlus },
  { kind: "cta", label: "行动区", hint: "居中文本占位", icon: TypeIcon },
];

/** 结构分组（B2 抽出：大纲树本体，供添加面板折叠区复用）。 */
export function CanvasOutlineTree({ store, onReveal, onFit }: CanvasOutlineTreeProps) {
  const doc = useCanvasSelector(store, useCallback((s: ReturnType<CanvasStore["getState"]>) => s.doc, []));
  const selection = useCanvasSelector(store, useCallback((s: ReturnType<CanvasStore["getState"]>) => s.selection, []));

  const writable = useCanvasSelector(store, useCallback((s) => !s.readOnly && !s.previewMode, []));

  return (
    <div className="canvas-outline-tree">
      {doc.boards.length === 0 && (
        <p className="canvas-outline-empty">还没有页面。双击画布空白，或用下方模板开始。</p>
      )}
      {doc.boards.map((board, bi) => (
        <div key={board.id} className="canvas-outline-board">
          <BoardRow store={store} boardId={board.id} name={board.name ?? ""}
            label={board.name || `页面 ${bi + 1}`} writable={writable}
            index={bi} total={doc.boards.length}
            selected={selection?.kind === "board" && selection.boardId === board.id}
            onReveal={onReveal} onFit={onFit} />
          {board.regions.map((region, ri) => (
            <RegionRow
              key={region.id}
              store={store}
              boardId={board.id}
              boardIndex={bi}
              regionId={region.id}
              name={region.name}
              index={ri}
              total={board.regions.length}
              selected={selection?.kind === "region" && selection.regionId === region.id}
              onReveal={onReveal}
              writable={writable}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function BoardRow({ store, boardId, name, label, writable, selected, index, total, onReveal, onFit }: {
  store: CanvasStore; boardId: string; name: string; label: string; writable: boolean; selected: boolean;
  index: number; total: number;
  onReveal: CanvasOutlineTreeProps["onReveal"]; onFit: CanvasOutlineTreeProps["onFit"];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  // 防止 Enter/Esc 后卸载 input 的 blur 重复提交。
  const editingRef = useRef(false);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  const startRename = () => {
    setDraft(name); editingRef.current = true; setEditing(true);
  };
  const commit = () => {
    if (!editingRef.current) return;
    editingRef.current = false; setEditing(false);
    if (draft.trim() !== name) store.getState().apply("重命名页面", (doc) => renameBoard(doc, { boardId, name: draft }));
  };
  const fit = () => {
    store.getState().select({ kind: "board", boardId });
    onFit?.({ kind: "board", boardId });
  };
  return (
    <div className={`canvas-outline-row is-board ${selected ? "is-selected" : ""}`}
      onDoubleClick={(e) => { if (!editing && e.target === e.currentTarget) fit(); }}>
      {editing && writable ? (
        <input ref={inputRef} className="canvas-region-name-input" style={{ position: "static", flex: 1, minWidth: 0 }}
          value={draft} aria-label="页面名称" onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") { e.preventDefault(); editingRef.current = false; setEditing(false); }
          }} />
      ) : (
        <button type="button" className="canvas-outline-name" aria-label={`页面：${label}`}
          title={`选中页面「${label}」并定位（双击适合页面${writable ? "并改名" : ""}）`}
          onClick={() => { store.getState().select({ kind: "board", boardId }); onReveal({ kind: "board", boardId }); }}
          onDoubleClick={(e) => { e.stopPropagation(); fit(); if (writable) startRename(); }}>{label}</button>
      )}
      <span className="canvas-outline-actions">
        {onFit && <Button type="button" variant="ghost" size="icon" className="canvas-outline-action"
          title="适合此页面" aria-label={`适合页面 ${label}`} onClick={fit}><Maximize2 className="h-3 w-3" /></Button>}
        {writable && <>
          <Button type="button" variant="ghost" size="icon" className="canvas-outline-action"
            title="重命名页面" aria-label={`重命名页面 ${label}`} onClick={startRename}><Pencil className="h-3 w-3" /></Button>
          <Button type="button" variant="ghost" size="icon" className="canvas-outline-action"
            title={index === 0 ? "已是第一个页面，无法上移" : "上移页面（调整预览顺序，画布位置不变）"}
            aria-label={`上移页面 ${label}`} disabled={index === 0}
            onClick={() => store.getState().apply("上移页面", (doc) => moveBoardInOrder(doc, { boardId, direction: "up" }))}>
            <ArrowUp className="h-3 w-3" /></Button>
          <Button type="button" variant="ghost" size="icon" className="canvas-outline-action"
            title={index === total - 1 ? "已是最后一个页面，无法下移" : "下移页面（调整预览顺序，画布位置不变）"}
            aria-label={`下移页面 ${label}`} disabled={index === total - 1}
            onClick={() => store.getState().apply("下移页面", (doc) => moveBoardInOrder(doc, { boardId, direction: "down" }))}>
            <ArrowDown className="h-3 w-3" /></Button>
          <Button type="button" variant="ghost" size="icon" className="canvas-outline-action"
            title="复制页面" aria-label={`复制页面 ${label}`} onClick={() => {
              const id = commitBoardDuplicate(store, boardId);
              if (id) onReveal({ kind: "board", boardId: id });
            }}><Copy className="h-3 w-3" /></Button>
          <Button type="button" variant="ghost" size="icon" className="canvas-outline-action is-danger"
            title="删除页面" aria-label={`删除页面 ${label}`} onClick={() => void confirmBoardDeletion(store, boardId)}><Trash2 className="h-3 w-3" /></Button>
        </>}
      </span>
    </div>
  );
}

/** 模板分组（B2 抽出，供添加面板复用）。 */
export function CanvasTemplateList({ onApplyTemplate }: { onApplyTemplate: (template: CanvasTemplateKind) => void }) {
  return (
    <div className="canvas-template-list">
      {TEMPLATES.map((t) => (
        <button
          key={t.kind}
          type="button"
          className="canvas-template-item"
          title={`插入模板：${t.label}（${t.hint}）`}
          aria-label={`插入模板：${t.label}`}
          onClick={() => onApplyTemplate(t.kind)}
        >
          <t.icon className="h-4 w-4 flex-shrink-0" />
          <span className="canvas-template-label">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function RegionRow({
  store,
  boardId,
  boardIndex,
  regionId,
  name,
  index,
  total,
  selected,
  onReveal,
  writable,
}: {
  store: CanvasStore;
  boardId: string;
  boardIndex: number;
  regionId: string;
  name: string;
  index: number;
  total: number;
  writable: boolean;
  selected: boolean;
  onReveal: CanvasOutlineTreeProps["onReveal"];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== name) {
      store.getState().apply("重命名区块", (d) => renameRegion(d, { boardId, regionId, name: next }));
    } else {
      setDraft(name);
    }
  }, [boardId, draft, name, regionId, store]);

  return (
    <div className={`canvas-outline-row is-region ${selected ? "is-selected" : ""}`}>
      {editing ? (
        <input
          ref={inputRef}
          className="canvas-region-name-input"
          style={{ position: "static", flex: 1, maxWidth: 96 }}
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
              setDraft(name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="canvas-outline-name is-region-name"
          title={`选中区块「${name}」并定位（双击改名）`}
          aria-label={`区块：${name}（页面 ${boardIndex + 1}）`}
          onClick={() => {
            store.getState().select({ kind: "region", boardId, regionId });
            onReveal({ kind: "region", boardId, regionId });
          }}
          onDoubleClick={() => {
            if (writable) { setDraft(name); setEditing(true); }
          }}
        >
          {name}
        </button>
      )}
      {writable && <span className="canvas-outline-actions">
        <button
          type="button"
          className="canvas-outline-action"
          title="重命名区块"
          aria-label={`重命名区块 ${name}`}
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          className="canvas-outline-action"
          title="上移区块"
          aria-label={`上移区块 ${name}`}
          disabled={index === 0}
          onClick={() =>
            store.getState().apply("上移区块", (d) => moveRegion(d, { boardId, regionId, direction: "up" }))
          }
        >
          <ArrowUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          className="canvas-outline-action"
          title="下移区块"
          aria-label={`下移区块 ${name}`}
          disabled={index === total - 1}
          onClick={() =>
            store.getState().apply("下移区块", (d) => moveRegion(d, { boardId, regionId, direction: "down" }))
          }
        >
          <ArrowDown className="h-3 w-3" />
        </button>
        <button
          type="button"
          className="canvas-outline-action"
          title="复制区块"
          aria-label={`复制区块 ${name}`}
          onClick={() =>
            store.getState().apply("复制区块", (d) => duplicateRegion(d, { boardId, regionId }))
          }
        >
          <Copy className="h-3 w-3" />
        </button>
        <button
          type="button"
          className="canvas-outline-action is-danger"
          title="删除区块"
          aria-label={`删除区块 ${name}`}
          onClick={() =>
            store.getState().apply("删除区块", (d) => deleteRegion(d, { boardId, regionId }))
          }
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </span>}
    </div>
  );
}
