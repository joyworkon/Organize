import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";
import TaskList from "@tiptap/extension-task-list";
import type { Transaction } from "@tiptap/pm/state";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Details from "@tiptap/extension-details";
import DetailsContent from "@tiptap/extension-details-content";
import DetailsSummary from "@tiptap/extension-details-summary";
import type { InternalLinkStateRow } from "@/lib/note-links";
import { Callout } from "./extensions/callout";
import { InlineMath, MathBlock, MathCommands } from "./extensions/math";
import { Columns, Column } from "./extensions/columns";
import { ListBackspaceFix } from "./extensions/list-backspace";
import { ListStyleExtension } from "./extensions/list-style";
import {
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
import { DatabaseBlock } from "./extensions/database-block";
import { SlashCommand } from "./extensions/slash-command";
import { BlockDeepLink } from "./extensions/deep-link";
import { InternalLinkStateDecorations } from "./extensions/internal-link-state";
import { TransformedBlockSelection } from "./extensions/block-selection";
import { BlockMultiSelect } from "./extensions/block-multi-select";
import { BlockStyle } from "./extensions/block-style";
import { TaskItemLinked } from "./extensions/task-item-linked";
import { TaskItemToggleGuard } from "./extensions/task-item-toggle-guard";
import { BLOCK_ID_TYPES } from "./block-utils";
import type { HocuspocusProvider } from "@hocuspocus/provider";

/**
 * 编辑器扩展装配（R09 自 tiptap-editor 抽离，数组逐字保持）：
 * - 扩展集合与各 configure 参数是文档序列化/解析合同的一部分，改动需谨慎；
 * - collab 模式下 History 由 Collaboration 的 Yjs UndoManager 接管（TipTap 合同）；
 * - UniqueID 协作模式只给本地事务补 id（远端节点自带 id，否则两端各自生成会冲突）。
 * 由 tiptap-editor 的 useMemo 以 [collab, disableTaskItemToggle] 为依赖调用——
 * 与抽离前一致：这两个值不变时数组引用稳定，不会重建编辑器。
 */
export interface EditorCollabBinding {
  provider: HocuspocusProvider;
  user: { name: string; color: string };
  seedContent: Record<string, unknown> | null;
}

export function buildEditorExtensions(options: {
  collab: EditorCollabBinding | null;
  disableTaskItemToggle: boolean;
  getInternalLinkStates: () => Record<string, InternalLinkStateRow>;
}) {
  const { collab, disableTaskItemToggle, getInternalLinkStates } = options;
  return [
    // 协作模式下 History 由 Collaboration 的 Yjs UndoManager 接管（TipTap 合同）
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      ...(collab ? { history: false } : {}),
    }),
    ListStyleExtension,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    Underline,
    ResizableImage.configure({ inline: false, allowBase64: true }),
    Link.configure({ openOnClick: false }),
    Placeholder.configure({ placeholder: topLevelBlockPlaceholder }),
    TaskList,
    TaskItemLinked.configure({ nested: true }),
    // 匿名可编辑公开链接（072）：拦截本端 taskItem 勾选（任务属主不可匿名变更）
    ...(disableTaskItemToggle ? [TaskItemToggleGuard.configure({ enabled: true })] : []),
    OrganizeTable.configure({
      resizable: true,
      allowTableNodeSelection: true,
      lastColumnResizable: true,
      cellMinWidth: 48,
      View: OrganizeTableView,
    }),
    OrganizeTableRow,
    OrganizeTableCell,
    OrganizeTableHeader,
    // persist: 展开/收起状态写入文档（刷新后保持）；默认展开，
    // 新建折叠块直接进入可编辑状态，旧文档里没有 open 属性的折叠块也会展开显示。
    Details.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          open: {
            default: true,
            parseHTML: (el: HTMLElement) => el.hasAttribute("open"),
            renderHTML: (attributes: { open?: boolean }) =>
              attributes.open ? { open: "" } : {},
          },
        };
      },
    }).configure({ persist: true }),
    DetailsContent,
    // level>0 的 summary 渲染为折叠标题样式（data-level，CSS 控制字号）
    DetailsSummary.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          level: {
            default: 0,
            parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-level") || 0),
            renderHTML: (attributes: { level?: number }) =>
              attributes.level ? { "data-level": String(attributes.level) } : {},
          },
        };
      },
    }),
    Callout,
    InlineMath,
    MathBlock,
    MathCommands,
    Columns,
    Column,
    HtmlEmbed,
    FileAttachment,
    TableOfContents,
    Breadcrumb,
    ButtonBlock,
    Tabs,
    Tab,
    Mermaid,
    Embed,
    SyncedBlock,
    DatabaseBlock,
    SlashCommand,
    BlockDeepLink,
    InternalLinkStateDecorations.configure({
      getStates: getInternalLinkStates,
    }),
    TransformedBlockSelection,
    BlockMultiSelect,
    BlockStyle,
    ListBackspaceFix,
    UniqueID.configure({
      types: BLOCK_ID_TYPES,
      // 协作：只给本地事务补 id（远端节点自带 id，否则两端各自生成会冲突）
      ...(collab
        ? { filterTransaction: (transaction: Transaction) => !transaction.getMeta("y-sync$") }
        : {}),
    }),
    ...(collab
      ? [
          Collaboration.configure({ document: collab.provider.document }),
          CollaborationCursor.configure({
            provider: collab.provider,
            user: collab.user,
          }),
        ]
      : []),
  ];
}

