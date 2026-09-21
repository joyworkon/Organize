"use client";

import "katex/dist/katex.min.css";
import { useEditor, EditorContent, BubbleMenu, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import type { JSONContent } from "@tiptap/core";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TaskItemLinked } from "./extensions/task-item-linked";
import { TaskItemToggleGuard } from "./extensions/task-item-toggle-guard";
import Details from "@tiptap/extension-details";
import DetailsContent from "@tiptap/extension-details-content";
import DetailsSummary from "@tiptap/extension-details-summary";
import { Callout } from "./extensions/callout";
import { InlineMath, MathBlock, MathCommands } from "./extensions/math";
import { Columns, Column } from "./extensions/columns";
import { BlockStyle } from "./extensions/block-style";
import { ListBackspaceFix } from "./extensions/list-backspace";
import { ListStyleExtension } from "./extensions/list-style";
import {
  createTableContent,
  getActiveTable,
  OrganizeTable,
  OrganizeTableCell,
  OrganizeTableHeader,
  OrganizeTableRow,
  OrganizeTableView,
  topLevelBlockPlaceholder,
} from "./extensions/table-style";
import { HtmlEmbed } from "./extensions/html-embed";
import { ResizableImage } from "./extensions/resizable-image";
import { FileAttachment } from "./extensions/file-attachment";
import { TableOfContents } from "./extensions/table-of-contents";
import { Breadcrumb } from "./extensions/breadcrumb";
import { ButtonBlock } from "./extensions/button-node";
import { Tabs, Tab } from "./extensions/tabs-node";
import { Mermaid } from "./extensions/mermaid-node";
import { Embed } from "./extensions/embed";
import { SyncedBlock } from "./extensions/synced-block";
import { createSyncedBlockAt } from "./extensions/synced-block-client";
import { DatabaseBlock } from "./extensions/database-block";
import { insertInlineDatabase, insertPageDatabase, insertLinkedDatabase } from "./extensions/database-block-client";
import { SlashCommand } from "./extensions/slash-command";
import { BlockDeepLink } from "./extensions/deep-link";
import {
  InternalLinkStateDecorations,
  internalLinkStateKey,
} from "./extensions/internal-link-state";
import { TransformedBlockSelection } from "./extensions/block-selection";
import {
  BlockMultiSelect,
  blockSelectionBoundsForElement,
  getMultiSelectedBlocks,
  pointIsInsideBlockSelectionBounds,
  setMultiSelectedBlocks,
  setMultiSelectDragInProgress,
  type BlockSelectionRect,
} from "./extensions/block-multi-select";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { showPrompt } from "@/components/ui/prompt-dialog";
import { cn } from "@/lib/utils";
import { buildEditorExtensions } from "./editor-extensions";
import { useEditorUpload } from "./use-editor-upload";
import { BLOCK_ID_TYPES, findBlockById, isSameNodeSnapshot, moveBlockTransaction, nodeText, replaceAt } from "./block-utils";
import { BlockCommandMenu } from "./block-command-menu";
import { BlockActionMenu, type EditorSkillAction } from "./block-action-menu";
import { EditorDialogs } from "./editor-dialogs";
import { EditorPopover } from "./editor-popover";
import { PresentationMode } from "./presentation-mode";
import { TableGridPicker, TableToolbar } from "./table-controls";
import { TableDirectControls } from "./table-direct-controls";
import type { EditorBlockTarget, EditorDialog, EditorMenuPoint } from "./types";
import { usePluginStore } from "@/lib/plugin/store";
import type { AIActionExtension, PluginContext, ToolbarActionExtension } from "@organize/plugin-sdk";
import {
  internalLinkKeyFromHref,
  type InternalLinkStateRow,
} from "@/lib/note-links";
import { createClient } from "@/lib/supabase/client";

// internalLinkStates 的默认值必须模块级稳定：作为 effect 依赖，内联 {} 会让
// 「dispatch 刷新 NodeView」effect 每渲染重跑（dispatch → onUpdate → 重渲染 死循环）
const EMPTY_INTERNAL_LINK_STATES: Record<string, InternalLinkStateRow> = {};
import { createNewNote } from "@/lib/notes/create-note";
import { Plus } from "@/components/icons";

/** 事务来源分类（见 docs/g0-protocol.md §4）。 */
import {
  resolveTransactionSource,
  type TransactionSource,
} from "@/lib/collab/transaction-source";
/** 协作播种租约协议（067/A04/B05）：状态机隔离自本组件的原内联 effect */
import { createCollabSeedController } from "./collab-seeding";

export type { TransactionSource };

interface EditorProps {
  pageTemplate?: "default" | "red-blue";
  noteId: string;
  noteTitle?: string;
  content: Record<string, unknown>;
  /**
   * 内容变化回调。
   * @param content 编辑器 JSON
   * @param source 变更来源：
   *   - "user":用户主动编辑（键盘/鼠标/命令）——G2/G3 会激活 legacy、生成 task mutation、进 Undo
   *   - "hydrate":打开笔记初始加载
   *   - "remote-sync":Realtime 远端推入（G3 引入）
   *   - "version-restore":版本恢复
   *   - "backup-restore":备份恢复
   *   系统事务（非 user）不得激活 legacy、不得生成 mutation、不得进 Undo（见 docs/g0-protocol.md §4）。
   */
  onUpdate: (content: Record<string, unknown>, source: TransactionSource) => void;
  /** 编辑器实例就绪 / 销毁时回调，供页面标题与正文联动（T1/T2） */
  onEditorReady?: (editor: Editor | null) => void;
  /** 笔记树（含 parent_note_id），供路径栏(Breadcrumb)块渲染父级链；不传则该块显示占位 */
  noteTree?: { id: string; title: string | null; icon: string | null; parent_note_id: string | null }[];
/** 当前正文内站内链接的受控状态；删除/缺失目标不可继续导航。 */
  internalLinkStates?: Record<string, InternalLinkStateRow>;
  /** 只读模式（协作 viewer）：编辑器不可输入，默认 true 不影响单用户链路 */
  editable?: boolean;
  /** 匿名可编辑公开链接（072）：禁用本端任务勾选，任务状态只跟随后端同步显示 */
  disableTaskItemToggle?: boolean;
  /**
   * 实时协作会话（P5-03，ADR 0003）：传入即启用 Yjs 协作扩展。
   * 此时 initial content 由 Y.Doc 接管（首次同步后若文档为空才用 seedContent 播种），
   * History 扩展被 Collaboration 的 UndoManager 取代。
   */
  collab?: {
    provider: HocuspocusProvider;
    user: { name: string; color: string };
    /** DB 加载时的原始内容快照：仅用于空房间播种，勿传可变 state */
    seedContent: Record<string, unknown> | null;
  } | null;
}

interface SectionHeadingOverlay {
  pos: number;
  value: string;
  top: number;
  right: number;
  height: number;
}

/** Editable labels live outside ProseMirror's managed DOM so an empty heading
 * remains safe for IME input and template toggles cannot invalidate DOM anchors. */
function SectionHeadingLabels({
  editor,
  rootRef,
  enabled,
  editable,
}: {
  editor: Editor;
  rootRef: { current: HTMLDivElement | null };
  enabled: boolean;
  editable: boolean;
}) {
  const [items, setItems] = useState<SectionHeadingOverlay[]>([]);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!enabled || !root || editor.isDestroyed) {
      setItems([]);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const next = Array.from(
      root.querySelectorAll<HTMLElement>(
        ".organize-editor.prose > h1.organize-section-card-first"
      )
    ).flatMap((heading) => {
      const pos = editor.view.posAtDOM(heading, 0) - 1;
      const node = editor.state.doc.nodeAt(pos);
      if (!node || node.type.name !== "heading" || node.attrs.level !== 1) return [];
      const rect = heading.getBoundingClientRect();
      const style = getComputedStyle(heading);
      const paddingTop = Number.parseFloat(style.paddingTop) || 0;
      const paddingInline = Number.parseFloat(style.paddingLeft) || 0;
      const lineHeight = Number.parseFloat(style.lineHeight) || 38;
      const textRange = document.createRange();
      textRange.selectNodeContents(heading);
      const textRect = textRange.getBoundingClientRect();
      const hasMeasuredText = Boolean(heading.textContent?.trim()) && textRect.height > 0;
      return [{
        pos,
        value: node.attrs.sectionLabel || "Title",
        top: hasMeasuredText
          ? textRect.top - rootRect.top
          : rect.top - rootRect.top + paddingTop,
        right: rootRect.right - rect.right + paddingInline,
        // Keep the arrow baseline with the last rendered title line when a
        // narrow canvas wraps the heading, while preserving one-line layout.
        height: hasMeasuredText ? Math.max(lineHeight, textRect.height) : lineHeight,
      }];
    });
    setItems(next);
  }, [editor, enabled, rootRef]);

  useEffect(() => {
    measure();
    if (!enabled) return;
    const schedule = () => requestAnimationFrame(measure);
    editor.on("update", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const observer = new ResizeObserver(schedule);
    if (rootRef.current) observer.observe(rootRef.current);
    return () => {
      editor.off("update", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      observer.disconnect();
    };
  }, [editor, enabled, measure, rootRef]);

  return (
    <div
      className="note-section-label-layer"
      aria-hidden={!enabled || !editable}
      hidden={!enabled || items.length === 0}
    >
      {items.map((item) => (
        <div
          key={`${item.pos}-${item.value}`}
          className="organize-section-heading-suffix"
          style={{ top: item.top, right: item.right, height: item.height }}
        >
          <input
            className="organize-section-heading-label"
            aria-label="章节英文标题"
            defaultValue={item.value}
            maxLength={40}
            readOnly={!editable}
            tabIndex={editable ? 0 : -1}
            onBlur={(event) => {
              if (!editable) return;
              const node = editor.state.doc.nodeAt(item.pos);
              if (!node || node.type.name !== "heading") return;
              const value = event.currentTarget.value.trim() || "Title";
              editor.view.dispatch(editor.state.tr.setNodeMarkup(item.pos, undefined, {
                ...node.attrs,
                sectionLabel: value,
              }));
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== "Escape") return;
              event.preventDefault();
              if (event.key === "Escape") event.currentTarget.value = item.value;
              event.currentTarget.blur();
              editor.commands.focus();
            }}
          />
          <span className="organize-section-heading-arrow" aria-hidden="true">←</span>
        </div>
      ))}
    </div>
  );
}


// B04（R09 续）：气泡工具栏与块交互纯函数层拆出（纯移动；keydown 提为可单测工厂）
import { BubbleToolbar } from "./bubble-toolbar";
import {
  activeTableReferenceRect,
  blockElementAtTarget,
  createBlockKeydownHandlers,
  firstTextblockElement,
  handleLeftForBlock,
  handleTopForBlock,
  menuPointBelowBlock,
  nodePosForElement,
  pointIsOverRenderedText,
  shouldShowTextToolbar,
  type BlockDropTarget,
  type BlockPointerDrag,
  type HoveredBlock,
  type OpenActionState,
  type OpenMenuState,
  type OpenTablePickerState,
} from "./block-interaction";
export function TipTapEditor({
  noteId,
  noteTitle = "",
  pageTemplate = "default",
  content,
  onUpdate,
  onEditorReady,
  noteTree,
  internalLinkStates = EMPTY_INTERNAL_LINK_STATES,
  editable = true,
  collab = null,
  /** 匿名可编辑公开链接（072）：true 时拦截本端 taskItem 勾选（远端同步不受影响） */
  disableTaskItemToggle = false,
}: EditorProps) {
  const pageTemplateRef = useRef(pageTemplate);
  pageTemplateRef.current = pageTemplate;
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;
  const initialContentRef = useRef(content);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const internalLinkStatesRef = useRef(internalLinkStates);
  internalLinkStatesRef.current = internalLinkStates;
  const hoveredRef = useRef<HoveredBlock | null>(null);
  const pointerDragRef = useRef<BlockPointerDrag | null>(null);
  const dropTargetRef = useRef<BlockDropTarget | null>(null);
  const suppressGripClickRef = useRef(false);
  const [hoveredBlock, setHoveredBlock] = useState<HoveredBlock | null>(null);
  const [isDraggingBlock, setIsDraggingBlock] = useState(false);
  const [dropTarget, setDropTarget] = useState<BlockDropTarget | null>(null);
  const [commandMenu, setCommandMenu] = useState<OpenMenuState | null>(null);
  const [actionMenu, setActionMenu] = useState<OpenActionState | null>(null);
  const [tablePicker, setTablePicker] = useState<OpenTablePickerState | null>(null);
  const [tableFullscreen, setTableFullscreen] = useState(false);
  const [dialog, setDialog] = useState<EditorDialog>(null);
  const [presentationStart, setPresentationStart] = useState<string | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [blockSelectCount, setBlockSelectCount] = useState(0);
  const [selectRect, setSelectRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const selectDragRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
    /** 从文字上起拖：拖出起始块纵向范围才切换为块多选 */
    fromText: boolean;
    blockTop: number;
    blockBottom: number;
    bounds: BlockSelectionRect;
  } | null>(null);
  const activePlugins = usePluginStore((state) => Array.from(state.activePlugins.entries()));
  const pluginContexts = usePluginStore((state) => state.contexts);

  // R09：扩展装配抽离至 editor-extensions.ts；依赖保持 [collab, disableTaskItemToggle]，
  // 数组引用稳定，不会重建编辑器
  const extensions = useMemo(
    () =>
      buildEditorExtensions({
        collab,
        disableTaskItemToggle,
        sectionCardsEnabled: () => pageTemplateRef.current === "red-blue",
        getInternalLinkStates: () => internalLinkStatesRef.current,
      }),
    [collab, disableTaskItemToggle]
  );

  const editor = useEditor({
    extensions,
    // 协作模式：初始内容归 Y.Doc 管（首次同步后按需播种 DB 内容），不能注入初始 content
    content: collab ? null : content,
    immediatelyRender: false,
    onUpdate: ({ editor, transaction }) => {
      // 仅用于强制 NodeView 刷新的无内容变化事务，不触发上层 onUpdate/自动保存
      if (transaction.getMeta("breadcrumb:storage-refresh")) return;
      // 来源分类抽为纯函数（B05）：y-sync 协作事务（远端协作者的变更推入）=
      // remote-sync，不进 Undo、不生成 task mutation、不标脏（ADR 0003）
      const source = resolveTransactionSource(transaction);
      onUpdateRef.current(editor.getJSON(), source);
    },
    editable,
    editorProps: {
      attributes: {
        // 正文 16px（sm 以下 prose-sm）：与阅读页 17px/1.8 有意区分——编辑态需要操作密度
        class: "prose prose-sm sm:prose max-w-none min-h-[50vh] focus:outline-none py-2 organize-editor",
      },
      // B04：键盘分派提为可单测工厂（IME 守卫/标题行尾回车/⌘/ 块菜单/⌘F 搜索），
      // 行为逐行保持——菜单/搜索的打开仍落到组件 state
      handleKeyDown: createBlockKeydownHandlers({
        onOpenCommandMenu: (pos, point) => {
          setActionMenu(null);
          setCommandMenu({ pos, point });
        },
        onOpenSearchDialog: () => setDialog({ type: "search" }),
      }),
      handleClickOn: (_view, _pos, _node, _nodePos, event) => {
        const anchor = (event.target as HTMLElement)?.closest("a");
        if (!(anchor instanceof HTMLAnchorElement)) return false;
        const href = anchor.getAttribute("href");
        if (!href) return false;
        const linkStateKey = internalLinkKeyFromHref(href);
        const linkState = linkStateKey ? internalLinkStatesRef.current[linkStateKey] : null;
        if (linkState && linkState.state !== "active") {
          event.preventDefault();
          toast({
            title: linkState.state === "deleted" ? "链接目标已在垃圾箱中" : "链接目标不存在或无权访问",
            variant: "destructive",
          });
          return true;
        }
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
          return true;
        }
        // 站内链接（如「转换成页面」/ 拖入子页面产生的 /notes/<id>）单击直接跳转
        if (href.startsWith("/")) {
          event.preventDefault();
          router.push(href);
          return true;
        }
        return false;
      },
      // 从编辑器外拖入文件（图片 / 视频 / 音频 / 附件）
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        void insertFilesRef.current(files, coords?.pos);
        return true;
      },
      // 粘贴文件（截图、从文件管理器复制的文件）
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        void insertFilesRef.current(files);
        return true;
      },
    },
    // 协作会话建立/销毁时重建编辑器（扩展集合随 provider 变化）；勾选守卫开关同理
  }, [collab?.provider, collab?.user, disableTaskItemToggle]);

  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(internalLinkStateKey, true));
  }, [editor, internalLinkStates]);

  // 协作 viewer 只读：角色变化（含挂载时序）都同步到编辑器实例；
  // 协作播种未定形时同样锁编辑（A05 D4 收尾）：房间为空且 DB 有内容时，
  // 在播种租约落定前放行输入，首个按键就会把服务端 markSeeded → 租约 deny
  // → DB 内容进不了房间，本端碎片再经保存链反写 notes.content（A04 实测路径）
  const [collabSeedBlocked, setCollabSeedBlocked] = useState(false);
  useEffect(() => {
    if (!editor) return;
    const want = editable && !collabSeedBlocked;
    if (editor.isEditable !== want) editor.setEditable(want);
  }, [editor, editable, collabSeedBlocked]);

  // 协作模式：房间为空时向服务端申请播种租约，获准后才用 DB 原始内容播种一次。
  // 协议状态机（seed-req/grant/wait/deny + 重试 + deny 观察窗）隔离在
  // collab-seeding.ts（B05）；本组件只保留 UI 侧关切：阻塞态锁编辑与 deny toast。
  // 播种源必须是 seedContent（DB 加载时的原始快照）：页面 content state 会被
  // UniqueID 回填等编辑器事务覆盖，用它播种会把空文档写回房间。
  useEffect(() => {
    if (!collab || !editor) return;
    const provider = collab.provider;
    const controller = createCollabSeedController({
      editor: {
        get isEmpty() {
          return editor.isEmpty;
        },
        get isDestroyed() {
          return editor.isDestroyed;
        },
        setContent: (content, emitUpdate) => {
          // 第二参 false = 不产生 onUpdate（不标脏、不触发保存）
          editor.commands.setContent(content as never, emitUpdate);
        },
        onUpdate: (fn) => {
          editor.on("update", fn);
        },
        offUpdate: (fn) => {
          editor.off("update", fn);
        },
      },
      provider: {
        get isSynced() {
          return provider.isSynced;
        },
        onSynced: (fn) => {
          provider.on("synced", fn);
        },
        offSynced: (fn) => {
          provider.off("synced", fn);
        },
        onStateless: (fn) => {
          provider.on("stateless", fn);
        },
        offStateless: (fn) => {
          provider.off("stateless", fn);
        },
        sendStateless: (payload) => provider.sendStateless(payload),
      },
      seedContent: collab.seedContent,
      callbacks: {
        onBlockedChange: setCollabSeedBlocked,
        onDenyTimeout: () => {
          toast({
            title: "协作内容加载受阻",
            description: "未能从服务器同步到笔记内容，请刷新页面重试；笔记内容没有丢失。",
          });
        },
      },
    });
    return () => controller.detach();
  }, [collab, editor]);

  const closeMenus = useCallback(() => {
    setCommandMenu(null);
    setActionMenu(null);
    editor?.commands.focus();
  }, [editor]);

  // 把编辑器实例上抛给页面（标题回车拆分等联动需要它），卸载时清空。
  useEffect(() => {
    onEditorReadyRef.current?.(editor ?? null);
    return () => onEditorReadyRef.current?.(null);
  }, [editor]);

  // 路径栏(Breadcrumb)块通过 editor.storage 读取当前页 id/标题与笔记树，
  // 避免在块内做网络请求；父级链由编辑器外算好后注入。
  useEffect(() => {
    if (!editor) return;
    editor.storage.breadcrumb = {
      noteId,
      noteTitle,
      noteTree: noteTree || [],
    };
    // storage 变化不会产生事务，NodeView 不会自动重渲染（路径栏块可能
    // 长期显示"当前页位于顶层"，直到用户敲字）。派发一个无内容变化的
    // meta 事务，强制订阅了编辑器更新的 NodeView 刷新。
    editor.view.dispatch(editor.state.tr.setMeta("breadcrumb:storage-refresh", true));
  }, [editor, noteId, noteTitle, noteTree]);

  // UniqueID 负责后续事务；历史 JSON 初始化时不会产生事务，因此这里主动补齐并保存。
  // 协作模式必须等首次同步后再补：同步前文档为空，此刻补齐会把空文档经
  // onUpdate('hydrate') 上抛，随后的快照保存会把房间/DB 内容清掉。
  useEffect(() => {
    if (!editor) return;
    let seedWaitRetries = 0;
    let seedWaitTimer: ReturnType<typeof setTimeout> | null = null;
    const runBackfill = () => {
      if (editor.isDestroyed) return;
      // 协作模式下文档为空：先等播种租约流程把 DB 内容写入房间（setContent
      // 整体替换文档，先补 id 是给空文档发更新，白白广播空状态，还会让服务端
      // onChange 把播种阶段标记结束 → 租约 deny → 真内容永远无法播种，空 ydoc
      // 落库还会借新鲜度规则遮蔽 notes.content）。seedContent 是页面异步 DB 加载
      // 的产物，可能晚于 WS synced 就绪：null 只说明「还没加载完」，不代表不会
      // 播种——同样必须等待，不能落到空文档回填。
      if (collab && editor.isEmpty && seedWaitRetries < 8) {
        seedWaitRetries += 1;
        seedWaitTimer = setTimeout(runBackfill, 1000);
        return;
      }
      // 协作等待封顶后仍为空 = 播种失败/被拒：空文档既不能写进房间（更新会
      // 把播种阶段标记结束），更不能上抛 hydrate 保存——保存链会把空文档写回
      // notes.content，反向覆盖真实内容（A04 实测的丢数据路径）。用户开始输入
      // 后新块由 appendTransaction 自动补 id，无需在此兜底；非协作维持旧行为。
      if (collab && editor.isEmpty) return;
      let transaction = editor.state.tr;
      editor.state.doc.descendants((node, pos) => {
        if (BLOCK_ID_TYPES.includes(node.type.name) && !node.attrs.id) {
          const id = typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `block-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          transaction = transaction.setNodeMarkup(pos, undefined, { ...node.attrs, id });
        }
      });
      if (transaction.docChanged) {
        // 系统操作（补 block id）：打 hydrate meta，使 onUpdate 读到非 user 来源，
        // 不激活 legacy / 不进 Undo（见 docs/g0-protocol.md §4）
        transaction = transaction.setMeta("transactionSource", "hydrate");
        editor.view.dispatch(transaction);
        onUpdateRef.current(editor.getJSON(), "hydrate");
        return;
      }
      const upgraded = editor.getJSON();
      if (!isSameNodeSnapshot(upgraded, initialContentRef.current)) {
        onUpdateRef.current(upgraded, "hydrate");
      }
    };
    if (!collab) {
      runBackfill();
      return;
    }
    const provider = collab.provider;
    if (provider.isSynced) {
      runBackfill();
    } else {
      provider.on("synced", runBackfill);
    }
    return () => {
      provider.off("synced", runBackfill);
      if (seedWaitTimer) clearTimeout(seedWaitTimer);
    };
  }, [editor, collab]);

  // R09：上传与插入抽离至 use-editor-upload（含编辑器销毁守卫：切页/关页后不再插入）
  const { insertImage, uploadImage, insertFiles, insertFilesRef, uploadAttachment, addImageUrl } =
    useEditorUpload(editor);

  const addReadingReference = useCallback((pos?: number) => {
    if (!editor) return;
    void showPrompt({ title: "输入要引用的阅读条目 URL", placeholder: "https://" }).then((url) => {
      if (!url) return;
      const paragraph = {
        type: "paragraph",
        content: [
          { type: "text", text: "📖 参考: " },
          { type: "text", marks: [{ type: "link", attrs: { href: url } }], text: url },
        ],
      };
      pos === undefined ? editor.chain().focus().insertContent(paragraph).run() : replaceAt(editor, pos, paragraph);
    });
  }, [editor]);

  const addTable = useCallback((rows: number, cols: number) => {
    editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
  }, [editor]);

  const addTableAt = useCallback((pos: number, rows: number, cols: number) => {
    if (!editor) return;
    replaceAt(editor, pos, createTableContent(rows, cols));
    setTablePicker(null);
  }, [editor]);

  // 「转换成 → 页面」：以块文本为标题创建子笔记，并把块替换为指向它的链接段落。
  // 必须走浏览器端 Supabase 客户端（会话内 RLS）：/api/notes 是服务端路由，
  // 假后端（NEXT_PUBLIC_MOCK_BACKEND）模式下不可用——走它会导致转换静默失败，
  // 块原地不动也点击不进去（这正是历史 bug）。
  const convertBlockToPage = useCallback(async (pos: number) => {
    if (!editor) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    const blockId = String(node.attrs?.id || "");
    if (!blockId) return;
    const title = node.textContent.trim() || "无标题笔记";
    // N02：统一创建服务；离线时 queued 也直接用客户端 id 建链（回放后即真实页面）
    const result = await createNewNote(supabase, {
      title,
      parent_note_id: noteId ?? null,
    });
    if (result.status === "unauthenticated" || result.status === "failed") {
      toast({ title: "转换成页面失败，请重试", description: result.status === "failed" ? result.message : undefined, variant: "destructive" });
      return;
    }
    const createdId = result.noteId;
    // 创建期间块可能已被删除/移动：校验同位置的块仍是原来那个（按 block id）
    const current = editor.state.doc.nodeAt(pos);
    if (!current || String(current.attrs?.id || "") !== blockId) return;
    replaceAt(editor, pos, {
      type: "paragraph",
      content: [
        { type: "text", text: "📄 " },
        {
          type: "text",
          marks: [{ type: "link", attrs: { href: `/notes/${createdId}` } }],
          text: title,
        },
      ],
    });
    // 刷新父页的笔记树：子页面列表（页面最底部）立即出现新页面，
    // 内容里的链接状态校验（internal link states）也会随之重取
    window.dispatchEvent(new CustomEvent("organize:notes-changed"));
    toast({ title: `已转换为子页面「${title}」` });
  }, [editor, noteId, supabase]);

  useEffect(() => {
    if (!editor) return;
    const root = rootRef.current;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { type: string; pos?: number; target?: EditorBlockTarget; point?: EditorMenuPoint; nested?: boolean; range?: { from: number; to: number } };
      if (typeof detail.pos === "number") {
        if (detail.type === "slash-menu" && detail.point) {
          setActionMenu(null);
          setTablePicker(null);
          setCommandMenu({ pos: detail.pos, point: detail.point, slash: true, nested: detail.nested, range: detail.range });
        } else if (detail.type === "html") {
          if (detail.nested && detail.range) {
            editor.chain().focus().deleteRange(detail.range).insertContent({ type: "htmlEmbed" }).run();
          } else {
            replaceAt(editor, detail.pos, { type: "htmlEmbed" });
          }
        }
        else if (detail.type === "ai-notes") setDialog({ type: "ai-notes", pos: detail.pos });
        else if (detail.type === "image") {
          uploadImage(detail.pos, detail.nested, detail.range);
        }
        else if (detail.type === "math") {
          const pos = detail.pos;
          const nestedRange = detail.nested && detail.range ? detail.range : null;
          void showPrompt({ title: "输入 LaTeX 公式", placeholder: "例如 E = mc^2" }).then((latex) => {
            if (!latex) return;
            if (nestedRange) {
              editor.chain().focus().deleteRange(nestedRange).insertContent({ type: "mathBlock", attrs: { latex } }).run();
            } else {
              replaceAt(editor, pos, { type: "mathBlock", attrs: { latex } });
            }
          });
        } else if (detail.type === "reference") {
          if (detail.nested && detail.range) {
            const range = detail.range;
            void showPrompt({ title: "输入要引用的阅读条目 URL", placeholder: "https://" }).then((url) => {
              if (!url) return;
              editor.chain().focus().deleteRange(range).insertContent({
                type: "paragraph",
                content: [
                  { type: "text", text: "📖 参考: " },
                  { type: "text", marks: [{ type: "link", attrs: { href: url } }], text: url },
                ],
              }).run();
            });
          } else {
            addReadingReference(detail.pos);
          }
        }
        else if (detail.type === "table") {
          // 表格不允许在嵌套块内插入（表格内不能再套表格）
          if (!detail.nested) {
            setTablePicker({
              pos: detail.pos,
              point: menuPointBelowBlock(editor, detail.pos, detail.pos + 1),
            });
          }
        }
        else if (detail.type === "page") {
          if (!detail.nested) {
            void convertBlockToPage(detail.pos);
          }
        }
        else if (detail.type === "synced-block") {
          // 同步区块：异步创建服务端记录拿到 id，再插入带 syncedId 的块
          void createSyncedBlockAt(editor, detail.nested ? undefined : detail.pos);
        }
        else if (detail.type === "database-inline") {
          // 行内数据库：创建 db 记录后在当前位置插入 databaseBlock
          void insertInlineDatabase(editor, noteId, detail.nested ? undefined : detail.pos);
        }
        else if (detail.type === "database-page") {
          // 整页数据库：创建子笔记 + 数据库 + 在原位置插入链接并跳转
          if (!detail.nested) {
            void insertPageDatabase(editor, noteId, detail.pos, router);
          }
        }
        else if (detail.type === "database-linked") {
          // 链接的视图：选择已有数据库，插入新视图引用
          void insertLinkedDatabase(editor, detail.nested ? undefined : detail.pos);
        }
      } else if (detail.target) {
        if (detail.type === "move") setDialog({ type: "move", target: detail.target });
        if (detail.type === "comment") setDialog({ type: "comment", target: detail.target });
        if (detail.type === "suggestion") setDialog({ type: "suggestion", target: detail.target });
        if (detail.type === "ask-ai") setDialog({ type: "ask-ai", target: detail.target });
      }
    };
    root?.addEventListener("organize-editor-action", handler);
    return () => root?.removeEventListener("organize-editor-action", handler);
  }, [addReadingReference, convertBlockToPage, editor, noteId, router, uploadImage]);

  useEffect(() => {
    if (!editor || !tableFullscreen) return;
    const shell = rootRef.current;
    if (!shell) return;

    const syncFullscreenTable = () => {
      shell
        .querySelectorAll(".organize-table-fullscreen")
        .forEach((element) => element.classList.remove("organize-table-fullscreen"));
      const table = getActiveTable(editor);
      if (!table) {
        setTableFullscreen(false);
        return;
      }
      const dom = editor.view.nodeDOM(table.pos);
      if (!(dom instanceof HTMLElement)) return;
      const tableElement = dom.matches("table")
        ? dom
        : dom.querySelector("table");
      tableElement?.classList.add("organize-table-fullscreen");
    };

    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTableFullscreen(false);
    };
    syncFullscreenTable();
    editor.on("transaction", syncFullscreenTable);
    window.addEventListener("keydown", exitOnEscape);
    return () => {
      editor.off("transaction", syncFullscreenTable);
      window.removeEventListener("keydown", exitOnEscape);
      shell
        .querySelectorAll(".organize-table-fullscreen")
        .forEach((element) => element.classList.remove("organize-table-fullscreen"));
    };
  }, [editor, tableFullscreen]);

  useEffect(() => {
    let active = true;
    fetch(`/api/notes/${noteId}/comments`)
      .then((response) => response.ok ? response.json() : [])
      .then((threads) => {
        if (!active) return;
        const counts: Record<string, number> = {};
        for (const thread of threads) if (!thread.resolved_at) counts[thread.block_id] = (counts[thread.block_id] || 0) + 1;
        setCommentCounts(counts);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [dialog, noteId]);

  const skills = useMemo<EditorSkillAction[]>(() => {
    const actions: EditorSkillAction[] = [];
    for (const [pluginId, plugin] of activePlugins) {
      for (const extension of plugin.extensions) {
        const supports = "supports" in extension ? extension.supports : undefined;
        if (!supports?.includes("note-block")) continue;
        if (extension.type !== "ai-action" && extension.type !== "toolbar-action") continue;
        actions.push({
          id: `${plugin.id}:${extension.id}`,
          label: extension.label,
          icon: extension.icon,
          run: async (target) => {
            const baseContext = pluginContexts.get(pluginId);
            const context: PluginContext = {
              // spread 透传 registerCommand / registerSlashCommand / onAppEvent / data 等宿主装配字段，
              // 下方仅覆盖 note-block 场景化字段与兜底
              ...baseContext,
              userId: baseContext?.userId || "current",
              getCurrentItem: baseContext?.getCurrentItem || (() => null),
              getCurrentNote: () => ({ id: noteId, title: noteTitle, content: editor?.getJSON() || null }),
              getCurrentBlock: () => {
                const selection = editor?.state.selection;
                return {
                  noteId,
                  blockId: target.id,
                  nodeType: target.type,
                  text: target.text,
                  json: target.json as Record<string, unknown>,
                  selection: selection ? {
                    from: selection.from,
                    to: selection.to,
                    text: editor.state.doc.textBetween(selection.from, selection.to, " "),
                  } : undefined,
                };
              },
              getConfig: baseContext?.getConfig || (<T = Record<string, unknown>>() => ({} as T)),
              setConfig: baseContext?.setConfig || (async () => {}),
              notify: baseContext?.notify || ((message) => toast({ title: message })),
            };
            if (extension.type === "ai-action") {
              const result = await (extension as AIActionExtension).handler(target.text, context);
              if (typeof result === "string" && result && result !== target.text) {
                // await 期间文档可能已变化，target.pos 会过期：按块 id 重新定位
                if (!editor) return;
                const found = findBlockById(editor.state.doc, target.id);
                if (!found) return;
                editor.chain().focus().insertContentAt(found.pos + found.node.nodeSize, { type: "paragraph", content: [{ type: "text", text: result }] }).run();
              }
            } else await (extension as ToolbarActionExtension).handler(context);
          },
        });
      }
    }
    return actions;
  }, [activePlugins, editor, noteId, noteTitle, pluginContexts]);

  const showHandleForBlock = useCallback((block: HTMLElement) => {
    if (!editor) return;
    const pos = nodePosForElement(editor, block);
    const node = editor.state.doc.nodeAt(pos);
    const shell = rootRef.current;
    if (!node || !shell) return;

    const shellRect = shell.getBoundingClientRect();
    const handleWidth = rootRef.current.querySelector(".organize-block-handle")?.clientWidth || 35;
    const next: HoveredBlock = {
      editor,
      node,
      pos,
      top: handleTopForBlock(block, shellRect),
      left: handleLeftForBlock(block, shellRect, handleWidth),
      element: block,
    };

    hoveredRef.current = next;
    setHoveredBlock((previous) => (
      previous?.pos === pos && Math.abs(previous.top - next.top) < 0.5 && previous.left === next.left ? previous : next
    ));
  }, [editor]);

  const updateHoveredBlock = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || isDraggingBlock || selectDragRef.current?.active) return;
    const editorDom = editor.view.dom;
    const target = event.target as HTMLElement | null;

    if (!target || !editorDom.contains(target)) return;
    const block = blockElementAtTarget(editorDom, target, event.clientY);
    if (!block) return;
    showHandleForBlock(block);
  }, [editor, isDraggingBlock, showHandleForBlock]);

  // 触屏设备没有 hover：点按块（产生选区）时显示该块的手柄，
  // 否则触屏上既不能打开块操作菜单、也没有任何块操作入口。
  useEffect(() => {
    if (!editor) return;
    if (typeof window === "undefined" || !window.matchMedia?.("(pointer: coarse)").matches) return;
    const showHandleForSelection = () => {
      if (isDraggingBlock) return;
      const { from } = editor.state.selection;
      const domAtPos = editor.view.domAtPos(from).node;
      const el = domAtPos instanceof HTMLElement ? domAtPos : domAtPos.parentElement;
      const block = el?.closest("[data-id]") as HTMLElement | null;
      if (block) showHandleForBlock(block);
    };
    editor.on("selectionUpdate", showHandleForSelection);
    return () => {
      editor.off("selectionUpdate", showHandleForSelection);
    };
  }, [editor, isDraggingBlock, showHandleForBlock]);

  // 文档可能已被菜单操作改写（转换成列表、拖拽移动等），而鼠标未再移动：
  // 此时 hoveredRef 里的 pos / node 已过期。点击 + / 6 点前按块 id 重新定位，
  // 避免插入点算错（新块插进当前内容里）或菜单作用到错误的块上。
  const resolveHoveredBlock = useCallback((): HoveredBlock | null => {
    const current = hoveredRef.current;
    if (!editor || !current) return current;
    const id = String(current.node.attrs?.id || "");
    if (!id) return current;
    const found = findBlockById(editor.state.doc, id);
    if (!found) {
      hoveredRef.current = null;
      setHoveredBlock(null);
      return null;
    }
    if (found.pos === current.pos) {
      // 位置没变：刷新 node 引用即可，避免重排手柄
      const next = { ...current, node: found.node };
      hoveredRef.current = next;
      return next;
    }
    const element = editor.view.nodeDOM(found.pos);
    const shell = rootRef.current;
    if (!(element instanceof HTMLElement) || !shell) return current;
    const shellRect = shell.getBoundingClientRect();
    const handleWidth = shell.querySelector(".organize-block-handle")?.clientWidth || 35;
    const next: HoveredBlock = {
      editor,
      node: found.node,
      pos: found.pos,
      top: handleTopForBlock(element, shellRect),
      left: handleLeftForBlock(element, shellRect, handleWidth),
      element,
    };
    hoveredRef.current = next;
    setHoveredBlock(next);
    return next;
  }, [editor]);

  // 文档变化后（输入 / 菜单操作）刷新一次手柄位置，避免手柄停留在过期位置
  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      if (hoveredRef.current) resolveHoveredBlock();
    };
    editor.on("update", refresh);
    return () => {
      editor.off("update", refresh);
    };
  }, [editor, resolveHoveredBlock]);

  const hideHoveredBlock = useCallback(() => {
    if (commandMenu || actionMenu || tablePicker || isDraggingBlock) return;
    hoveredRef.current = null;
    setHoveredBlock(null);
  }, [actionMenu, commandMenu, isDraggingBlock, tablePicker]);

  useEffect(() => {
    const hideWhenPointerLeavesEditor = (event: MouseEvent) => {
      const shell = rootRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      const LEFT_GUTTER = 16;
      const inside =
        event.clientX >= rect.left - LEFT_GUTTER &&
        event.clientX <= rect.right + 8 &&
        event.clientY >= rect.top - 8 &&
        event.clientY <= rect.bottom + 8;
      if (!inside) hideHoveredBlock();
    };
    document.addEventListener("mousemove", hideWhenPointerLeavesEditor, true);
    return () => document.removeEventListener("mousemove", hideWhenPointerLeavesEditor, true);
  }, [hideHoveredBlock]);

  const insertBlockBelow = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const current = resolveHoveredBlock();
    if (!current || current.pos < 0) return;

    const isListItem = current.node.type.name === "listItem" || current.node.type.name === "taskItem";
    const emptyBlock = isListItem
      ? {
          type: current.node.type.name,
          ...(current.node.type.name === "taskItem" ? { attrs: { checked: false } } : {}),
          content: [{ type: "paragraph" }],
        }
      : { type: "paragraph" };
    // 按住 Option/Alt 点击：在上方插入（Notion 风格），只插入不弹菜单
    const above = event.altKey;
    const insertPos = above ? current.pos : current.pos + current.node.nodeSize;
    const textSelectionPos = insertPos + (isListItem ? 2 : 1);
    current.editor
      .chain()
      .focus()
      .insertContentAt(insertPos, emptyBlock)
      .setTextSelection(textSelectionPos)
      .run();
    if (above) {
      setActionMenu(null);
      setCommandMenu(null);
      return;
    }
    // 新块可能插在视口外（比如页底）。PM 的 tr.scrollIntoView 在编辑器尚无
    // DOM 焦点时不生效（TipTap 的 focus 命令是 rAF 异步的），这里直接滚到新块，
    // 再按它的真实位置锚定菜单
    const newBlockDom = current.editor.view.nodeDOM(insertPos);
    if (newBlockDom instanceof HTMLElement) {
      newBlockDom.scrollIntoView({ block: "nearest" });
    }
    setActionMenu(null);
    setTablePicker(null);
    setCommandMenu({
      pos: insertPos,
      point: menuPointBelowBlock(current.editor, insertPos, textSelectionPos),
    });
  }, [resolveHoveredBlock]);

  const openBlockActions = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (suppressGripClickRef.current) {
      suppressGripClickRef.current = false;
      return;
    }
    const current = resolveHoveredBlock();
    if (!current || current.pos < 0) return;
    const id = String(current.node.attrs?.id || "");
    if (!id) return;

    // 让块进入 NodeSelection 选中态 → 触发 .ProseMirror-selectednode 样式（淡粉红背景）
    try {
      editor?.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, current.pos))
      );
    } catch {
      // 忽略：某些节点类型不支持 NodeSelection
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const target: EditorBlockTarget = {
      pos: current.pos,
      id,
      type: current.node.type.name,
      text: nodeText(current.node),
      json: current.node.toJSON(),
    };
    setCommandMenu(null);
    setTablePicker(null);
    setActionMenu({
      pos: current.pos,
      target,
      point: {
        left: rect.left - 338,
        top: rect.top,
        anchorTop: current.element.getBoundingClientRect().top,
      },
    });
  }, [editor, resolveHoveredBlock]);

  const beginBlockPointerDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const current = resolveHoveredBlock();
    if (!current || event.button !== 0) return;
    suppressGripClickRef.current = false;
    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      source: current,
      active: false,
    };
  }, [resolveHoveredBlock]);

  const moveBlockPointerDrag = useCallback((event: PointerEvent) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.active) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < 5) return;
      drag.active = true;
      suppressGripClickRef.current = true;
      const selection = NodeSelection.create(drag.source.editor.state.doc, drag.source.pos);
      drag.source.editor.view.dispatch(drag.source.editor.state.tr.setSelection(selection));
      setIsDraggingBlock(true);
    }

    event.preventDefault();
    const editorDom = drag.source.editor.view.dom;
    const sourceParent = drag.source.element.parentElement;
    const sourceIsListItem = drag.source.element.matches("li") && sourceParent?.matches("ul, ol");
    let blocks: HTMLElement[];
    if (sourceIsListItem && sourceParent) {
      blocks = Array.from(sourceParent.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.matches("li"));
    } else {
      // 指针悬在哪个折叠内容区上，候选块就是哪个内容区的直接子块；
      // 不在任何折叠内容区上时回退到顶层块。这样既能拖入/拖出折叠区，
      // 也能在折叠区内部排序。源块自己包含的内容区除外（不能拖进自己）。
      const underPointer = document.elementFromPoint(event.clientX, event.clientY);
      const detailsContent = underPointer instanceof HTMLElement
        ? underPointer.closest('div[data-type="detailsContent"]')
        : null;
      if (
        detailsContent instanceof HTMLElement
        && editorDom.contains(detailsContent)
        && !drag.source.element.contains(detailsContent)
      ) {
        blocks = Array.from(detailsContent.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
      } else {
        blocks = Array.from(editorDom.children) as HTMLElement[];
      }
    }
    const shell = rootRef.current;
    if (!blocks.length || !shell) return;

    let targetElement = blocks[blocks.length - 1];
    let placeBefore = false;
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        targetElement = block;
        placeBefore = true;
        break;
      }
    }

    const targetPos = nodePosForElement(drag.source.editor, targetElement);
    const targetNode = drag.source.editor.state.doc.nodeAt(targetPos);
    if (!targetNode) return;
    const insertPos = placeBefore ? targetPos : targetPos + targetNode.nodeSize;
    const indicatorY = placeBefore
      ? targetElement.getBoundingClientRect().top
      : targetElement.getBoundingClientRect().bottom;
    const nextTarget = {
      insertPos,
      top: indicatorY - shell.getBoundingClientRect().top,
    };
    dropTargetRef.current = nextTarget;
    setDropTarget(nextTarget);
  }, []);

  const finishBlockPointerDrag = useCallback((event: PointerEvent) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active) {
      pointerDragRef.current = null;
      return;
    }

    event.preventDefault();
    const target = dropTargetRef.current;
    const { editor: currentEditor, pos: sourcePos } = drag.source;
    const transaction = target
      ? moveBlockTransaction(currentEditor.state, sourcePos, target.insertPos)
      : null;
    if (transaction) {
      currentEditor.view.dispatch(transaction);
      currentEditor.commands.focus();
    }

    pointerDragRef.current = null;
    dropTargetRef.current = null;
    setIsDraggingBlock(false);
    setDropTarget(null);
    hoveredRef.current = null;
    setHoveredBlock(null);
  }, []);

  const cancelBlockPointerDrag = useCallback((event: PointerEvent) => {
    if (pointerDragRef.current?.pointerId !== event.pointerId) return;
    pointerDragRef.current = null;
    dropTargetRef.current = null;
    suppressGripClickRef.current = false;
    setIsDraggingBlock(false);
    setDropTarget(null);
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", moveBlockPointerDrag, { capture: true, passive: false });
    window.addEventListener("pointerup", finishBlockPointerDrag, true);
    window.addEventListener("pointercancel", cancelBlockPointerDrag, true);
    return () => {
      window.removeEventListener("pointermove", moveBlockPointerDrag, true);
      window.removeEventListener("pointerup", finishBlockPointerDrag, true);
      window.removeEventListener("pointercancel", cancelBlockPointerDrag, true);
    };
  }, [cancelBlockPointerDrag, finishBlockPointerDrag, moveBlockPointerDrag]);

  /* ------------------------- 拖拽块多选 ------------------------- */

  // 三种起点都算框选：
  // 1）笔记画布左右留白 / 编辑器 padding → 直接框选；
  // 2）块内没有文字的横向空白 → 直接框选；
  // 3）文字上（图3 的 Notion 方式）→ 先让浏览器做原生文本选择，一旦拖出起始块的
  //    纵向范围就切换为块多选（清掉文本选区、画选择矩形）。
  const beginSelectDrag = useCallback((event: MouseEvent) => {
    if (!editor || event.button !== 0) return;
    if (commandMenu || actionMenu || tablePicker) return;
    if (event.defaultPrevented) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest(
      ".organize-block-handle, .organize-column-resizer, .editor-popover, "
      + ".table-direct-controls, "
      + "button, input, textarea, select, a, [contenteditable='false']"
    )) return;
    const editorDom = editor.view.dom;
    const bounds = blockSelectionBoundsForElement(editorDom);
    if (!pointIsInsideBlockSelectionBounds(bounds, event.clientX, event.clientY)) return;
    const startedInsideEditor = editorDom.contains(target);
    if (!startedInsideEditor || target === editorDom) {
      // 画布左右留白 / 编辑器 padding：没有原生文本选择，直接按行框选。
      event.preventDefault();
      selectDragRef.current = { startX: event.clientX, startY: event.clientY, active: false, fromText: false, blockTop: 0, blockBottom: 0, bounds };
      return;
    }
    // 文字区：记录起始块，拖出它的纵向范围后再切换
    const block = blockElementAtTarget(editorDom, target, event.clientY);
    if (!block) return;
    const rect = block.getBoundingClientRect();
    const fromText = pointIsOverRenderedText(block, event.clientX, event.clientY);
    selectDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      fromText,
      blockTop: fromText ? rect.top : 0,
      blockBottom: fromText ? rect.bottom : 0,
      bounds,
    };
  }, [actionMenu, commandMenu, editor, tablePicker]);

  useEffect(() => {
    document.addEventListener("mousedown", beginSelectDrag);
    return () => document.removeEventListener("mousedown", beginSelectDrag);
  }, [beginSelectDrag]);

  const moveSelectDrag = useCallback((event: MouseEvent) => {
    const drag = selectDragRef.current;
    if (!drag || !editor) return;
    if (!pointIsInsideBlockSelectionBounds(drag.bounds, event.clientX, event.clientY)) {
      if (drag.active) {
        window.getSelection()?.removeAllRanges();
        setSelectRect(null);
        setMultiSelectedBlocks(editor, []);
      }
      return;
    }
    if (!drag.active) {
      if (drag.fromText) {
        // 还在起始块内部：保持原生文本选择
        if (event.clientY >= drag.blockTop && event.clientY <= drag.blockBottom) return;
      } else if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) {
        return;
      }
      drag.active = true;
      setMultiSelectDragInProgress(true);
      // 冻结文本选择（Notion 切换到块选择时的表现）
      editor.view.dom.style.userSelect = "none";
      hoveredRef.current = null;
      setHoveredBlock(null);
    }
    // 浏览器的拖选以 mousedown 为锚点会在拖动中持续扩展文本选区，
    // 块多选激活期间每一帧都清掉它，避免文字高亮和块高亮打架
    window.getSelection()?.removeAllRanges();
    const top = Math.min(drag.startY, event.clientY);
    const bottom = Math.max(drag.startY, event.clientY);
    const left = Math.min(drag.startX, event.clientX);
    const right = Math.max(drag.startX, event.clientX);
    setSelectRect({ left, top, width: right - left, height: bottom - top });
    const positions: number[] = [];
    for (const child of Array.from(editor.view.dom.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const rect = child.getBoundingClientRect();
      if (rect.bottom < top || rect.top > bottom) continue;
      // 从 gutter/空白起拖按行选（纵向命中即可）；从文字起拖按矩形相交
      if (!drag.fromText || (rect.right >= left && rect.left <= right)) {
        positions.push(nodePosForElement(editor, child));
      }
    }
    setMultiSelectedBlocks(editor, positions);
  }, [editor]);

  const finishSelectDrag = useCallback((event: MouseEvent) => {
    const drag = selectDragRef.current;
    selectDragRef.current = null;
    if (!editor || !drag) return;
    if (drag.active) {
      // 拖动结束：恢复可选中，保留块多选高亮
      editor.view.dom.style.userSelect = "";
      setMultiSelectDragInProgress(false);
      setSelectRect(null);
      if (!pointIsInsideBlockSelectionBounds(drag.bounds, event.clientX, event.clientY)) {
        setMultiSelectedBlocks(editor, []);
      }
      return;
    }
    // 只是点击（没拖起来）：清空多选
    setMultiSelectedBlocks(editor, []);
    // Notion 风格：点击正文末尾下方的空白区域，把光标放到最后一行；
    // 最后一个块不是文本块（图片/表格等）时先补一个空段落
    const editorDom = editor.view.dom;
    if (!pointIsInsideBlockSelectionBounds(drag.bounds, event.clientX, event.clientY)) return;
    const lastChild = editorDom.lastElementChild;
    if (lastChild && event.clientY > lastChild.getBoundingClientRect().bottom) {
      const lastNode = editor.state.doc.lastChild;
      if (lastNode && !lastNode.isTextblock) {
        const end = editor.state.doc.content.size;
        editor
          .chain()
          .focus()
          .insertContentAt(end, { type: "paragraph" })
          .setTextSelection(end + 1)
          .run();
      } else {
        editor.commands.focus("end");
      }
    }
  }, [editor]);

  useEffect(() => {
    window.addEventListener("mousemove", moveSelectDrag, true);
    window.addEventListener("mouseup", finishSelectDrag, true);
    return () => {
      window.removeEventListener("mousemove", moveSelectDrag, true);
      window.removeEventListener("mouseup", finishSelectDrag, true);
      selectDragRef.current = null;
      setMultiSelectDragInProgress(false);
      if (editor) editor.view.dom.style.userSelect = "";
    };
  }, [editor, finishSelectDrag, moveSelectDrag]);

  // 多选状态同步到 React（隐藏光标用）；插件在输入/点击时会自动清空，这里跟随
  useEffect(() => {
    if (!editor) return;
    const sync = () => setBlockSelectCount(getMultiSelectedBlocks(editor).length);
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  // tippy（BubbleMenu 底层）在 interactive 模式下会给参考元素挂 aria-expanded，
  // 而参考元素是包裹 ProseMirror 的普通 div（无任何交互角色）——aria-expanded 在
  // 此无语义且违反 ARIA（axe aria-allowed-attr critical）。tippy 6 无开关（v5 的
  // a11y prop 已移除），TipTap v2 也不透传 reference 替换：这里在挂上的瞬间摘除。
  // 只动 shell 的直接子 div；Radix 菜单触发器的 aria-expanded 是合法状态，不受影响。
  useEffect(() => {
    const root = rootRef.current;
    if (!editor || !root) return;
    const strip = () => {
      const wrapper = root.querySelector<HTMLElement>(":scope > div[aria-expanded]");
      if (wrapper) wrapper.removeAttribute("aria-expanded");
    };
    strip();
    const observer = new MutationObserver(strip);
    observer.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded"],
    });
    return () => observer.disconnect();
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
  }, [editor, pageTemplate]);

  if (!editor) return null;

  return (
    <div
      className="relative organize-editor-shell"
      ref={rootRef}
      onMouseMove={updateHoveredBlock}
      data-block-selecting={blockSelectCount > 0 ? "true" : "false"}
      data-table-fullscreen={tableFullscreen ? "true" : "false"}
    >
      <SectionHeadingLabels
        editor={editor}
        rootRef={rootRef}
        enabled={pageTemplate === "red-blue"}
        editable={editable}
      />
      <button
        type="button"
        className="note-new-section"
        hidden={pageTemplate !== "red-blue" || !editable}
        tabIndex={pageTemplate === "red-blue" && editable ? 0 : -1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const pos = editor.state.doc.content.size;
          const paragraph = editor.schema.nodes.paragraph.create({ sectionStart: true });
          const transaction = editor.state.tr.insert(pos, paragraph);
          transaction.setSelection(TextSelection.near(transaction.doc.resolve(pos + 1), 1));
          editor.view.dispatch(transaction.scrollIntoView());
          editor.view.focus();
        }}
      >＋ 新背景块</button>
      <BubbleMenu
        editor={editor}
        shouldShow={shouldShowTextToolbar}
        tippyOptions={{ duration: 150, maxWidth: "none", zIndex: 50 }}
      >
        <BubbleToolbar editor={editor} onUploadImage={() => uploadImage()} onAddImageUrl={addImageUrl} onUploadAttachment={uploadAttachment} onAddTable={addTable} onAddReference={() => addReadingReference()} />
      </BubbleMenu>
      <BubbleMenu
        editor={editor}
        pluginKey="organizeTableToolbar"
        shouldShow={({ editor: currentEditor, from, to }) =>
          currentEditor.isActive("table")
          && (from === to || currentEditor.state.selection instanceof CellSelection)
        }
        tippyOptions={{
          duration: 120,
          maxWidth: "none",
          zIndex: 140,
          placement: "top",
          getReferenceClientRect: () => activeTableReferenceRect(editor),
        }}
      >
        <TableToolbar
          editor={editor}
          fullscreen={tableFullscreen}
          onToggleFullscreen={() => setTableFullscreen((value) => !value)}
        />
      </BubbleMenu>
      <EditorContent editor={editor} />
      <TableDirectControls editor={editor} />
      <div
        className="organize-block-handle"
        data-visible={hoveredBlock ? "true" : "false"}
        data-dragging={isDraggingBlock ? "true" : "false"}
        style={{ top: hoveredBlock?.top ?? 0, left: hoveredBlock?.left ?? 1 }}
        aria-hidden={!hoveredBlock}
      >
        <button
          type="button"
          className="organize-block-add"
          aria-label="在下方添加区块"
          data-tooltip={"点击以在下方添加块\n按住 Option 键点击以在上方添加块"}
          tabIndex={hoveredBlock ? 0 : -1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={insertBlockBelow}
        >
          <Plus aria-hidden="true" />
        </button>
        <button
          type="button"
          className="organize-block-grip"
          aria-label="拖动区块或打开菜单"
          data-tooltip={"拖动以移动\n点击 或 ⌘/ 打开菜单"}
          tabIndex={hoveredBlock ? 0 : -1}
          draggable={false}
          onClick={openBlockActions}
          onPointerDown={beginBlockPointerDrag}
        >
          <span className="organize-grip-dots" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
          </span>
        </button>
      </div>
      {dropTarget && (
        <div className="organize-block-drop-indicator" style={{ top: dropTarget.top }} aria-hidden="true" />
      )}
      {selectRect && <div className="organize-select-rect" style={selectRect} aria-hidden="true" />}
      {commandMenu && <BlockCommandMenu editor={editor} pos={commandMenu.pos} point={commandMenu.point} clearTrigger={Boolean(commandMenu.slash)} nested={commandMenu.nested} range={commandMenu.range} onClose={closeMenus} />}
      {actionMenu && <BlockActionMenu editor={editor} noteId={noteId} target={actionMenu.target} point={actionMenu.point} skills={skills} commentCount={commentCounts[actionMenu.target.id] || 0} onClose={closeMenus} onPresent={(target) => setPresentationStart(target.id)} />}
      {tablePicker && (
        <EditorPopover
          point={tablePicker.point}
          onClose={() => {
            setTablePicker(null);
            editor.commands.focus();
          }}
          className="table-picker-popover"
        >
          <TableGridPicker
            onSelect={(rows, cols) => addTableAt(tablePicker.pos, rows, cols)}
          />
        </EditorPopover>
      )}
      <EditorDialogs editor={editor} noteId={noteId} dialog={dialog} onClose={() => setDialog(null)} />
      {presentationStart && <PresentationMode doc={editor.getJSON()} startBlockId={presentationStart} onClose={() => setPresentationStart(null)} />}
    </div>
  );
}
