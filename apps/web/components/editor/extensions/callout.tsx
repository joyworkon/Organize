import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CALLOUT_ICON_GRID_COLUMNS,
  CALLOUT_TONES,
  DEFAULT_CALLOUT_EMOJI,
  filterCalloutIcons,
  normalizeCalloutEmoji,
  normalizeCalloutTone,
} from "@/lib/editor/callout-icons";

/**
 * 图标网格：方向键漫游焦点（roving tabindex，只有一个按钮在 Tab 序列里），
 * Enter/Space 原生触发按钮点击；ArrowUp 从第一行回到顶部搜索框；
 * Esc / 点外关闭由 Radix Popover 处理（Esc 后焦点回触发按钮）。
 */
function CalloutIconGrid({
  query,
  active,
  onPick,
  searchRef,
}: {
  query: string;
  active: string;
  onPick: (emoji: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const matched = filterCalloutIcons(query);

  useEffect(() => {
    setFocusedIndex(0);
  }, [query]);

  const buttonAt = (index: number) =>
    containerRef.current?.querySelectorAll<HTMLButtonElement>("button")[index] ?? null;

  const moveFocus = (next: number) => {
    if (!matched.length) return;
    const clamped = Math.max(0, Math.min(matched.length - 1, next));
    setFocusedIndex(clamped);
    buttonAt(clamped)?.focus();
  };

  if (!matched.length) return <div className="callout-icon-empty">没有匹配的图标</div>;

  return (
    <div
      ref={containerRef}
      className="callout-icon-grid"
      role="group"
      aria-label="标注图标"
      style={{ gridTemplateColumns: `repeat(${CALLOUT_ICON_GRID_COLUMNS}, 1fr)` }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          moveFocus(focusedIndex + 1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          moveFocus(focusedIndex - 1);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          moveFocus(focusedIndex + CALLOUT_ICON_GRID_COLUMNS);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          if (focusedIndex < CALLOUT_ICON_GRID_COLUMNS) {
            searchRef.current?.focus();
            searchRef.current?.setSelectionRange(0, 0);
          } else {
            moveFocus(focusedIndex - CALLOUT_ICON_GRID_COLUMNS);
          }
        } else if (event.key === "Home") {
          event.preventDefault();
          moveFocus(0);
        } else if (event.key === "End") {
          event.preventDefault();
          moveFocus(matched.length - 1);
        }
      }}
    >
      {matched.map((option, index) => (
        <button
          key={option.emoji}
          type="button"
          className={option.emoji === active ? "active" : ""}
          aria-pressed={option.emoji === active}
          tabIndex={index === focusedIndex ? 0 : -1}
          onFocus={() => setFocusedIndex(index)}
          onClick={() => onPick(option.emoji)}
        >
          {option.emoji}
        </button>
      ))}
    </div>
  );
}

export function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const [editable, setEditable] = useState(editor.isEditable);
  const [query, setQuery] = useState("");
  const emoji = normalizeCalloutEmoji(node.attrs.emoji);
  const tone = normalizeCalloutTone(node.attrs.tone);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sync = () => {
      setEditable(editor.isEditable);
      if (!editor.isEditable) setOpen(false);
    };
    sync();
    editor.on("transaction", sync);
    editor.on("update", sync);
    return () => {
      editor.off("transaction", sync);
      editor.off("update", sync);
    };
  }, [editor]);

  useEffect(() => {
    if (open) {
      setQuery("");
      // 退出动画尚未结束时重开会复用同一弹层，不触发 Radix 的 mount autofocus。
      searchRef.current?.focus();
    }
  }, [open]);

  // 选择后由 Popover 还焦点，避免 editor.focus 的延迟帧抢走下次打开时的搜索焦点。
  const applyAndClose = (attrs: { emoji?: string; tone?: string }) => {
    if (!editor.isEditable || editor.isDestroyed) return;
    updateAttributes(attrs);
    setOpen(false);
  };

  return (
    <NodeViewWrapper
      as="div"
      data-callout=""
      data-emoji={emoji}
      {...(tone !== "default" ? { "data-tone": tone } : {})}
    >
      <Popover open={open && editable} onOpenChange={(value) => setOpen(value && editor.isEditable)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="callout-emoji"
            contentEditable={false}
            disabled={!editable}
            aria-label="更换标注图标"
            aria-haspopup="dialog"
            title="更换图标"
            onMouseDown={(event) => event.preventDefault()}
          >
            {emoji || <span className="callout-emoji-add" aria-hidden="true">＋</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="callout-icon-popover w-72 p-2"
          align="start"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            // 退出动画期间重新打开时，旧弹层的焦点归还不能覆盖新搜索框。
            if (openRef.current) event.preventDefault();
          }}
        >
          <input
            ref={searchRef}
            className="callout-icon-search"
            type="text"
            value={query}
            placeholder="搜索图标（如：警告 / done）"
            aria-label="搜索标注图标"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                containerFirstGridButton(searchRef.current)?.focus();
              }
            }}
          />
          <CalloutIconGrid query={query} active={emoji} onPick={(value) => applyAndClose({ emoji: value })} searchRef={searchRef} />
          <div className="callout-tone-row" role="group" aria-label="标注色调">
            {CALLOUT_TONES.map((item) => (
              <button
                key={item.value}
                type="button"
                className={item.value === tone ? "active" : ""}
                aria-pressed={item.value === tone}
                data-tone={item.value}
                onClick={() => {
                  if (editor.isEditable && !editor.isDestroyed) {
                    updateAttributes({ tone: item.value === "default" ? undefined : item.value });
                  }
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="callout-icon-remove"
            onClick={() => applyAndClose({ emoji: "" })}
          >
            移除图标
          </button>
        </PopoverContent>
      </Popover>
      <NodeViewContent className="callout-content" as="div" />
    </NodeViewWrapper>
  );
}

/** 从搜索框（或其所属弹层）找网格的第一个图标按钮，ArrowDown 进入网格用 */
function containerFirstGridButton(from: HTMLElement | null): HTMLButtonElement | null {
  const popover = from?.closest(".callout-icon-popover");
  return popover?.querySelector<HTMLButtonElement>(".callout-icon-grid button") ?? null;
}

/**
 * 标注（Callout）块：带 emoji 图标的提示块，参考 Notion 的 Callout。
 * 结构：div[data-callout] > button.callout-emoji + div.callout-content(内容洞)
 * 属性：
 * - emoji：图标字符；空串 = 无图标（新能力），旧文档均为非空、输出保持不变
 * - tone：语义色调 default/info/success/warning/danger；仅非 default 时输出 data-tone
 */
export interface CalloutOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { emoji?: string; tone?: string }) => ReturnType;
      toggleCallout: (attrs?: { emoji?: string; tone?: string }) => ReturnType;
    };
  }
}

export const Callout = Node.create<CalloutOptions>({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      // 空 data-emoji="" 是合法值（无图标）；缺失时回默认（旧文档/粘贴行为不变）
      emoji: {
        default: DEFAULT_CALLOUT_EMOJI,
        parseHTML: (el) => {
          const value = el.getAttribute("data-emoji");
          return value === null ? DEFAULT_CALLOUT_EMOJI : value;
        },
      },
      tone: {
        // 缺省属性用 undefined，JSON 序列化不新增键；UI 统一归一为 default。
        default: undefined,
        parseHTML: (el) => {
          const tone = normalizeCalloutTone(el.getAttribute("data-tone"));
          return tone === "default" ? undefined : tone;
        },
        renderHTML: (attributes: { tone?: string }) => {
          const tone = normalizeCalloutTone(attributes.tone);
          return tone !== "default" ? { "data-tone": tone } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]", contentElement: ".callout-content" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    // 保留旧版 HTML 的 emoji 属性及属性顺序；tone 只在非默认时额外输出。
    const emoji = normalizeCalloutEmoji(node.attrs.emoji);
    const children: Array<[string, Record<string, string>, string | 0]> = [];
    if (emoji) {
      children.push(["span", { class: "callout-emoji", contenteditable: "false" }, emoji]);
    }
    children.push(["div", { class: "callout-content" }, 0]);
    return ["div", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { "data-callout": "", "data-emoji": emoji }), ...children];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
      toggleCallout:
        (attrs) =>
        ({ commands }) =>
          commands.toggleWrap(this.name, attrs),
    };
  },
});

export default Callout;
