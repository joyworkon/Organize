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
  Pencil,
  Trash2,
  Type as TypeIcon,
} from "@/components/icons";
import {
  deleteRegion,
  duplicateRegion,
  moveRegion,
  renameRegion,
  type CanvasTemplateKind,
} from "@/lib/canvas/commands";
import type { CanvasStore } from "./canvas-store";
import { useCanvasSelector } from "./use-canvas-selector";

export interface CanvasOutlineTreeProps {
  store: CanvasStore;
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
export function CanvasOutlineTree({ store, onReveal }: CanvasOutlineTreeProps) {
  const doc = useCanvasSelector(store, useCallback((s: ReturnType<CanvasStore["getState"]>) => s.doc, []));
  const selection = useCanvasSelector(store, useCallback((s: ReturnType<CanvasStore["getState"]>) => s.selection, []));

  return (
    <div className="canvas-outline-tree">
      {doc.boards.length === 0 && (
        <p className="canvas-outline-empty">还没有页面。双击画布空白，或用下方模板开始。</p>
      )}
      {doc.boards.map((board, bi) => (
        <div key={board.id} className="canvas-outline-board">
          <button
            type="button"
            className={`canvas-outline-row is-board ${
              selection?.kind === "board" && selection.boardId === board.id ? "is-selected" : ""
            }`}
            title={`选中页面「${board.name || `页面 ${bi + 1}`}」并定位`}
            aria-label={`页面：${board.name || `页面 ${bi + 1}`}`}
            onClick={() => {
              store.getState().select({ kind: "board", boardId: board.id });
              onReveal({ kind: "board", boardId: board.id });
            }}
          >
            <span className="canvas-outline-name">{board.name || `页面 ${bi + 1}`}</span>
          </button>
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
            />
          ))}
        </div>
      ))}
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
}: {
  store: CanvasStore;
  boardId: string;
  boardIndex: number;
  regionId: string;
  name: string;
  index: number;
  total: number;
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
            setDraft(name);
            setEditing(true);
          }}
        >
          {name}
        </button>
      )}
      <span className="canvas-outline-actions">
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
      </span>
    </div>
  );
}
