"use client";

import type { Editor } from "@tiptap/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Puzzle, Search, X } from "@/components/icons";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createEditorBridge } from "@/lib/plugin/editor-bridge";
import { slashCommandRegistry } from "@/lib/plugin/slash-commands";
import { useAiAvailability } from "@/hooks/use-ai-availability";
import { BLOCK_COMMANDS, commandMatches, executeNestedCommand, isCommandAvailableInContext } from "./block-commands";
import { EditorPopover } from "./editor-popover";
import type { SlashMenuEventDetail } from "./extensions/slash-command";
import { highlightMatch } from "./highlight-match";
import { pickRecentCommands, readRecentSlashCommands, rememberSlashCommand } from "./slash-recent-commands";
import { isSlashTriggerText, resolveTriggerDeleteRange } from "./slash-trigger";
import type { BlockCommandDefinition } from "./types";
import type { EditorMenuPoint } from "./types";

const CATEGORY_ORDER = ["基本区块", "媒体", "布局", "AI", "插件"] as const;
export const RECENT_GROUP_LABEL = "最近使用";
/** 无匹配之后再多打这么多字符，菜单自动收起（文本原样留在文档里） */
const NO_MATCH_CLOSE_EXTRA_CHARS = 2;

export function BlockCommandMenu({
  editor,
  pos,
  point,
  clearTrigger = false,
  nested = false,
  range,
  inline = false,
  query: inlineQuery = "",
  onClose,
}: {
  editor: Editor;
  pos: number;
  point: EditorMenuPoint;
  /** 由 "/" 触发时为 true：执行命令时需清掉块里的 "/查询词"；⌘/ 打开时为 false，块内容必须保留 */
  clearTrigger?: boolean;
  /** 嵌套场景（表格/列表内等） */
  nested?: boolean;
  /** 斜杠触发文本的范围（行内输入时覆盖 "/查询词" 全段） */
  range?: { from: number; to: number };
  /** 行内筛选模式（由 "/" 唤出）：焦点留在编辑器，查询词来自正文、键盘事件经 slash-menu-key 转交 */
  inline?: boolean;
  /** 行内模式下正文里 "/" 之后输入的查询词 */
  query?: string;
  onClose: () => void;
}) {
  const [inputQuery, setInputQuery] = useState("");
  const query = inline ? inlineQuery : inputQuery;
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // 菜单每次打开都是新挂载，这里一次读取即可
  const [recentIds] = useState(() => readRecentSlashCommands());

  // 插件贡献的斜杠命令（注册表订阅；插件停用后自动消失）
  const pluginSlashCommands = useSyncExternalStore(
    (onStoreChange) => slashCommandRegistry.subscribe(onStoreChange),
    () => slashCommandRegistry.list(),
    () => []
  );

  // 可用性由命令定义的 supportedContexts 统一判定（R06）：
  // 嵌套菜单只显示在嵌套上下文有真实执行路径的命令；插件命令需要顶层块位置语义
  const availableCommands = useMemo<BlockCommandDefinition[]>(() => {
    const builtin = BLOCK_COMMANDS.filter((cmd) => isCommandAvailableInContext(cmd, nested));
    if (nested || pluginSlashCommands.length === 0) return builtin;
    const pluginCommands: BlockCommandDefinition[] = pluginSlashCommands.map((entry) => ({
      id: entry.id,
      label: entry.command.icon ? `${entry.command.icon} ${entry.command.label}` : entry.command.label,
      description: entry.command.description,
      category: "插件",
      icon: Puzzle,
      keywords: entry.command.keywords ?? [],
      supportedContexts: ["top"] as const,
      run: (editor, pos) => {
        const bridge = createEditorBridge(editor, pos);
        return entry.command.handler(bridge, entry.ctx);
      },
    }));
    return [...builtin, ...pluginCommands];
  }, [nested, pluginSlashCommands]);

  const aiAvailable = useAiAvailability();
  const isDisabled = (command: BlockCommandDefinition) => command.requiresAI === true && aiAvailable === false;

  // 分组顺序决定键盘上下移动的顺序（options 由分组扁平化得出，视觉即键盘顺序）：
  // 空查询时「最近使用」置顶（只收当前上下文可用且未被 AI 配置置灰的命令，并从下方分类去重）；
  // 常用的基础区块在前，AI 类放在后面且未配置时置灰
  const sections = useMemo(() => {
    const sorted = availableCommands
      .filter((item) => commandMatches(item, query))
      .map((item, index) => ({ item, index }))
      .sort((a, b) => CATEGORY_ORDER.indexOf(a.item.category) - CATEGORY_ORDER.indexOf(b.item.category) || a.index - b.index)
      .map(({ item }) => item);
    const groups: Array<{ label: string; commands: BlockCommandDefinition[] }> = [];
    const recent = query.trim() || !recentIds.length
      ? []
      : pickRecentCommands(recentIds, sorted.filter((item) => !(item.requiresAI === true && aiAvailable === false)));
    if (recent.length) groups.push({ label: RECENT_GROUP_LABEL, commands: recent });
    for (const category of CATEGORY_ORDER) {
      const entries = sorted.filter((item) => item.category === category && !recent.includes(item));
      if (entries.length) groups.push({ label: category, commands: entries });
    }
    return groups;
  }, [availableCommands, query, recentIds, aiAvailable]);
  const options = useMemo(() => sections.flatMap((section) => section.commands), [sections]);

  // ⌘/ 打开：聚焦菜单内搜索框；"/" 行内模式不抢焦点，光标留在正文里继续输入
  useEffect(() => {
    if (!inline) inputRef.current?.focus();
  }, [inline]);
  useEffect(() => setActiveIndex(0), [query]);

  // 删除唤出菜单时输入的 "/查询词"：只删 suggestion 给出且落在块内容区内、以 "/" 开头的范围，
  // 块里原有文字绝不能被波及；校验不通过就保留文本只执行命令
  const clearTriggerText = () => {
    if (!clearTrigger) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node || !node.isTextblock || !node.content.size) return;
    const delRange = resolveTriggerDeleteRange({
      range,
      blockPos: pos,
      blockNodeSize: node.nodeSize,
      blockText: node.textContent,
    });
    if (!delRange) return;
    if (!isSlashTriggerText(editor.state.doc.textBetween(delRange.from, delRange.to))) return;
    editor.chain().deleteRange(delRange).run();
  };

  const execute = (index: number) => {
    const command = options[index];
    if (!command || isDisabled(command)) return;

    if (nested && range) {
      // 嵌套场景：只有能真实处理的命令才消费触发字符（R06 一致性约定）；
      // unsupported 时不动文档——"/" 与已输入字符保留，用户可继续编辑。
      // range 文本不是 "/查询词" 时同样不动文档（executeNestedCommand 会整段删掉它）
      if (!isSlashTriggerText(editor.state.doc.textBetween(range.from, range.to))) {
        onClose();
        return;
      }
      const result = executeNestedCommand(editor, command.id, range);
      if (result !== "handled") {
        onClose();
        return;
      }
    } else {
      clearTriggerText();
      command.run(editor, pos);
    }

    rememberSlashCommand(command.id);
    onClose();
  };

  // 行内模式的键盘：扩展对 ↑/↓/Enter/Tab 派发 cancelable 的 slash-menu-key 询问，
  // 这里 preventDefault 表示消费（扩展据此吞掉编辑器默认行为）。无匹配时不消费，Enter 照常分段
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const executeRef = useRef(execute);
  executeRef.current = execute;
  useEffect(() => {
    if (!inline) return;
    const editorDom = editor.view?.dom;
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<SlashMenuEventDetail | undefined>).detail;
      if (!detail || detail.type !== "slash-menu-key") return;
      if (editorDom && event.target !== editorDom) return;
      const count = optionsRef.current.length;
      if (!count) return;
      event.preventDefault();
      if (detail.key === "ArrowDown") setActiveIndex((value) => Math.min(value + 1, count - 1));
      else if (detail.key === "ArrowUp") setActiveIndex((value) => Math.max(value - 1, 0));
      else executeRef.current(activeIndexRef.current);
    };
    document.addEventListener("organize-editor-action", onAction);
    return () => document.removeEventListener("organize-editor-action", onAction);
  }, [inline, editor]);

  // 无匹配自动收起（C）：首次无匹配时记下查询长度，再多打 2 个字符（或出现空白）就关闭，文本留在文档里
  const noMatchSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!inline) return;
    if (options.length > 0) {
      noMatchSinceRef.current = null;
      return;
    }
    if (noMatchSinceRef.current === null) {
      noMatchSinceRef.current = query.length;
      return;
    }
    if (/\s/.test(query) || query.length >= noMatchSinceRef.current + NO_MATCH_CLOSE_EXTRA_CHARS) onClose();
  }, [inline, options.length, query, onClose]);

  return (
    <EditorPopover point={point} onClose={onClose} className="block-command-popover">
      {inline ? (
        <div className="editor-menu-filter-hint" role="status" aria-live="polite">
          <Search className="h-3.5 w-3.5" />
          {query
            ? <span>正在筛选：<strong>{query}</strong></span>
            : <span>输入以筛选 · ↑↓ 选择 · ↵ 执行</span>}
        </div>
      ) : (
        <div className="editor-menu-search">
          <Search className="h-4 w-4" />
          <input
            ref={inputRef}
            value={inputQuery}
            onChange={(event) => setInputQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((value) => Math.min(value + 1, options.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((value) => Math.max(value - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                execute(activeIndex);
              }
            }}
            placeholder="输入以筛选…"
            aria-label="筛选区块"
          />
          {inputQuery && <Button type="button" variant="ghost" size="icon" className="h-7 min-h-7 w-7 min-w-7 shrink-0 md:min-h-7" onClick={() => setInputQuery("")} aria-label="清空"><X className="h-3.5 w-3.5" /></Button>}
        </div>
      )}
      <div className="editor-menu-scroll" role="listbox" aria-label="区块命令">
        {options.length === 0 && <div className="editor-menu-empty">没有匹配的区块</div>}
        {sections.map((section) => (
          <div key={section.label} className="editor-menu-group">
            <div className="editor-menu-label">{section.label}</div>
            {section.commands.map((command) => {
              const index = options.indexOf(command);
              const Icon = command.icon;
              const disabled = isDisabled(command);
              return (
                <Button
                  key={command.id}
                  variant="ghost"
                  size="sm"
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  aria-current={index === activeIndex ? "true" : undefined}
                  disabled={disabled}
                  aria-disabled={disabled || undefined}
                  title={disabled ? "AI 服务未配置：请到「设置 › AI 服务」填写 API 地址和密钥" : undefined}
                  className={cn(
                    "h-auto w-full justify-start gap-2.5 whitespace-normal px-2 py-2 text-left font-normal md:min-h-[38px]",
                    index === activeIndex && "is-active bg-accent text-accent-foreground",
                    disabled && "is-disabled"
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => execute(index)}
                >
                  <Icon className="h-5 w-5" />
                  <span><strong>{highlightMatch(command.label, query)}</strong>{(disabled || command.description) && <small>{disabled ? "需先在「设置 › AI 服务」配置" : command.description}</small>}</span>
                  {command.shortcut && <kbd>{command.shortcut}</kbd>}
                </Button>
              );
            })}
          </div>
        ))}
      </div>
      <Button variant="ghost" size="sm" className="editor-menu-close h-auto w-full justify-between rounded-none border-t px-4 py-2 text-[13px] font-normal focus-visible:ring-inset focus-visible:ring-offset-0 md:min-h-10" type="button" onClick={onClose}><span>关闭菜单</span><kbd>esc</kbd></Button>
    </EditorPopover>
  );
}
