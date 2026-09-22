"use client";

/**
 * 画布左侧「资料」面板（阶段 E）：搜索资料库 → 三种插入：
 * - 引用卡片：整条资料以快照卡片插入（materialCard 块）；
 * - 插入摘录：预览中选区文字（无选区时为完整摘要）以正文块插入，
 *   带来源引用；
 * - 插入图片：reading 正文第一张图复制为画布自有资产后插入。
 * 全部经工作区回调走统一插入目标解析（不产生画布外孤立内容）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryItem } from "@organize/shared";
import { FileText, Image as ImageIcon, Quote, Loader2, StickyNote } from "@/components/icons";
import { Button } from "@/components/ui/button";

export interface CanvasMaterialPanelProps {
  /** 引用整条资料卡片。 */
  onInsertCard: (item: LibraryItem) => void;
  /** 插入文字摘录（text = 选区或完整摘要，由面板取得选区后传入）。 */
  onInsertExcerpt: (item: LibraryItem, text: string) => void;
  /** 插入 reading 正文第一张图（复制为画布资产）。 */
  onInsertImage: (item: LibraryItem) => void;
}

const KIND_LABEL: Record<LibraryItem["source_type"], string> = {
  reading: "资料",
  memo: "速记",
};

export function CanvasMaterialPanel({ onInsertCard, onInsertExcerpt, onInsertImage }: CanvasMaterialPanelProps) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selection, setSelection] = useState("");
  const previewRef = useRef<HTMLDivElement | null>(null);
  const seqRef = useRef(0);

  // 搜索（防抖 250ms）；空查询也给最近资料（q 缺省 = 列表）
  useEffect(() => {
    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ view: "all", limit: "20" });
        const q = query.trim();
        if (q) params.set("q", q);
        const res = await fetch(`/api/library/items?${params}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { items: LibraryItem[] };
        if (seq !== seqRef.current) return;
        setItems(data.items);
        setExpandedId(null);
      } catch {
        /* 网络异常静默；下次输入重试 */
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // 预览区选区跟踪（插入选中摘录用）；预览切换时清空
  const trackSelection = useCallback(() => {
    const sel = window.getSelection()?.toString() ?? "";
    setSelection(sel.trim());
  }, []);

  const expanded = items.find((i) => i.id === expandedId) ?? null;
  const itemTitle = (item: LibraryItem) =>
    item.title || item.excerpt?.split("\n", 1)[0]?.trim() || "未命名资料";

  return (
    <div className="canvas-material-panel" data-testid="canvas-material-panel">
      <input
        type="search"
        className="canvas-material-search"
        placeholder="搜索资料库…"
        aria-label="搜索资料"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="canvas-add-note">插入的是独立快照：画布修改不回写原资料。</p>
      {loading ? (
        <p className="canvas-material-empty" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 搜索中…
        </p>
      ) : items.length === 0 ? (
        <p className="canvas-material-empty">没有匹配的资料</p>
      ) : (
        <ul className="canvas-material-list" aria-label="资料搜索结果">
          {items.map((item) => (
            <li key={`${item.source_type}-${item.id}`} className="canvas-material-item">
              <button
                type="button"
                className="canvas-material-row"
                aria-expanded={expandedId === item.id}
                aria-label={`预览${KIND_LABEL[item.source_type]}：${itemTitle(item)}`}
                onClick={() => {
                  setExpandedId((v) => (v === item.id ? null : item.id));
                  setSelection("");
                }}
              >
                {item.source_type === "memo" ? (
                  <StickyNote className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-left">
                  {itemTitle(item)}
                  <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                    {KIND_LABEL[item.source_type]}
                  </span>
                </span>
              </button>
              {expandedId === item.id && (
                <div className="canvas-material-preview" ref={previewRef}>
                  <div
                    className="canvas-material-preview-text"
                    onMouseUp={trackSelection}
                    onKeyUp={trackSelection}
                  >
                    {item.excerpt || "（无摘要）"}
                  </div>
                  <div className="canvas-material-actions">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      aria-label="引用整条资料卡片"
                      onClick={() => onInsertCard(item)}
                    >
                      <Quote className="mr-1 h-3 w-3" /> 引用卡片
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={!item.excerpt}
                      aria-label="插入选中的文字摘录"
                      title={selection ? "插入预览中选中的文字" : "插入完整摘要（先在预览中选中文字可只插入选中部分）"}
                      onClick={() => onInsertExcerpt(item, selection || item.excerpt || "")}
                    >
                      插入摘录
                    </Button>
                    {item.source_type === "reading" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        aria-label="插入正文中的图片"
                        title="复制正文第一张图作为画布资产插入"
                        onClick={() => onInsertImage(item)}
                      >
                        <ImageIcon className="mr-1 h-3 w-3" /> 图片
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
