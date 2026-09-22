"use client";

/**
 * 左侧添加面板（阶段 B2）：带文字的分组面板，替代孤立的自由文本/自由图片图标。
 *
 * - 「添加」组：标题/正文/图片/列表/分隔线/行动按钮六项直接可见
 *  （图标 + 文字，title 悬停提示，button + aria-label 可 Tab 聚焦，
 *   点击后插入并更新目标提示）；
 * - 「页面」组：新建空白页面 / 宣传落地页骨架（B1 入口保留）；
 * - 「自由放置」次级折叠区：自由文本 / 自由图片，明确标注「自由定位，不随页面排版」
 *  （默认添加**不**创建脱离页面的自由内容）；
 * - 「结构」「模板」折叠区：复用 B1 大纲树与四项模板；
 * - 「资料」折叠区（E 阶段）：由工作区注入资料搜索面板（引用卡片/摘录/图片）；
 * - 窄空间可折叠（默认展开）；手机只读模式由工作区整体隐藏本面板。
 */

import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Heading1,
  Image as ImageIcon,
  LayoutTemplate,
  List,
  Minus,
  MousePointerClick,
  Rows3,
  Type as TypeIcon,
} from "@/components/icons";
import type { CanvasTemplateKind } from "@/lib/canvas/commands";
import type { CanvasStore } from "./canvas-store";
import { CanvasOutlineTree, CanvasTemplateList } from "./canvas-outline-panel";

/** 「添加」组六项（图片项由工作区接管文件选择）。 */
export type AddBlockKind = "title" | "body" | "image" | "list" | "divider" | "button";

const ADD_ITEMS: Array<{ kind: AddBlockKind; label: string; hint: string; icon: typeof TypeIcon }> = [
  { kind: "title", label: "标题", hint: "插入标题块（点击即改目标区块）", icon: Heading1 },
  { kind: "body", label: "正文", hint: "插入正文块", icon: TypeIcon },
  { kind: "image", label: "图片", hint: "选择图片插入目标位置（上传期间可继续编辑）", icon: ImageIcon },
  { kind: "list", label: "列表", hint: "插入列表块，每行一条", icon: List },
  { kind: "divider", label: "分隔线", hint: "插入细分隔线", icon: Minus },
  { kind: "button", label: "行动按钮", hint: "插入行动按钮（纯链接，属性栏改文案与链接）", icon: MousePointerClick },
];

export interface CanvasAddPanelProps {
  store: CanvasStore;
  /** 统一插入目标提示（添加到：区块名 / 新页面）。 */
  hint: string;
  narrow: boolean;
  onAddBlock: (kind: AddBlockKind) => void;
  onAddBlankBoard: () => void;
  onAddLandingBoard: () => void;
  onAddFreeText: () => void;
  onAddFreeImage: () => void;
  onApplyTemplate: (template: CanvasTemplateKind) => void;
  /** 资料面板（E 阶段接入）：由工作区提供，渲染在「资料」折叠组。 */
  material?: ReactNode;
  onReveal: (
    target:
      | { kind: "board"; boardId: string }
      | { kind: "region"; boardId: string; regionId: string },
  ) => void;
}

/** 折叠分组（默认收起；窄屏下结构/模板也收起）。 */
function DetailsGroup({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="canvas-add-group">
      <button
        type="button"
        className="canvas-add-group-title"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {title}
      </button>
      {open && <div className="canvas-add-group-body">{children}</div>}
    </div>
  );
}

export function CanvasAddPanel({
  store,
  hint,
  narrow,
  onAddBlock,
  onAddBlankBoard,
  onAddLandingBoard,
  onAddFreeText,
  onAddFreeImage,
  onApplyTemplate,
  material,
  onReveal,
}: CanvasAddPanelProps) {
  return (
    <div className="canvas-add-panel" role="toolbar" aria-label="画布添加面板" data-testid="canvas-add-panel">
      <p className="canvas-add-hint" data-testid="canvas-insert-hint" aria-live="polite">
        {hint}
      </p>

      <div className="canvas-add-group">
        <h3 className="canvas-add-group-title is-static">添加</h3>
        <div className="canvas-add-grid">
          {ADD_ITEMS.map((item) => (
            <button
              key={item.kind}
              type="button"
              className="canvas-add-item"
              title={item.hint}
              aria-label={`添加${item.label}`}
              onClick={() => onAddBlock(item.kind)}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="canvas-add-group">
        <h3 className="canvas-add-group-title is-static">页面</h3>
        <div className="canvas-add-grid">
          <button
            type="button"
            className="canvas-add-item"
            title="新建空白页面：一个默认区块 + 标题块"
            aria-label="新建空白页面"
            onClick={onAddBlankBoard}
          >
            <LayoutTemplate className="h-4 w-4 flex-shrink-0" />
            <span>空白页面</span>
          </button>
          <button
            type="button"
            className="canvas-add-item"
            title="新建宣传落地页骨架：头部 / 中部 / 底部三个区块"
            aria-label="新建宣传落地页骨架"
            onClick={onAddLandingBoard}
          >
            <Rows3 className="h-4 w-4 flex-shrink-0" />
            <span>落地页骨架</span>
          </button>
        </div>
      </div>

      <DetailsGroup title="自由放置">
        <p className="canvas-add-note">自由定位，不随页面排版。</p>
        <div className="canvas-add-grid">
          <button
            type="button"
            className="canvas-add-item"
            title="自由文本：Enter 只换行，不参与自动排版"
            aria-label="新建自由文本"
            onClick={onAddFreeText}
          >
            <TypeIcon className="h-4 w-4 flex-shrink-0" />
            <span>自由文本</span>
          </button>
          <button
            type="button"
            className="canvas-add-item"
            title="自由图片：选择文件后自由定位，可用属性栏「移入区块…」归位"
            aria-label="新建自由图片"
            onClick={onAddFreeImage}
          >
            <ImageIcon className="h-4 w-4 flex-shrink-0" />
            <span>自由图片</span>
          </button>
        </div>
      </DetailsGroup>

      <DetailsGroup title="模板" defaultOpen={!narrow}>
        <CanvasTemplateList onApplyTemplate={onApplyTemplate} />
      </DetailsGroup>

      {material && (
        <DetailsGroup title="资料">
          {material}
        </DetailsGroup>
      )}

      <DetailsGroup title="结构">
        <CanvasOutlineTree store={store} onReveal={onReveal} />
      </DetailsGroup>
    </div>
  );
}
