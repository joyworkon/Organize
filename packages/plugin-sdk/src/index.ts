import type { ComponentType } from "react";
import type { EditorBlockContext, Note, ReadingItem, ScrapeResult } from "@organize/shared";

// ============ 应用事件契约 ============

/**
 * 应用事件表：事件名 → payload 类型。
 * 插件通过 ctx.onAppEvent 订阅，宿主应用在对应行为发生时发射。
 */
export interface AppEventMap {
  /** 笔记内容保存成功（含自动保存） */
  "note:saved": { noteId: string; title: string };
  /** 笔记被打开 */
  "note:opened": { noteId: string; title: string };
  /** 新条目进入阅读库 */
  "reading:item-created": { itemId: string; url: string; title: string };
  /** 阅读状态流转（unread / reading / read） */
  "reading:status-changed": { itemId: string; from: string; to: string };
  /** 任务被标记完成 */
  "task:completed": { taskId: string; title: string };
}

export type AppEventName = keyof AppEventMap;

// ============ 命令贡献 ============

/** 插件贡献的命令：出现在命令面板（Cmd/Ctrl+K），可被用户搜索执行 */
export interface CommandContribution {
  /** 插件内唯一 id；宿主会加上插件 id 前缀避免冲突 */
  id: string;
  /** 展示标题，如「为当前条目生成摘要」 */
  title: string;
  /** 分组标签，缺省用插件名 */
  section?: string;
  /** emoji 图标 */
  icon?: string;
  /** 展示用快捷键文本（仅展示） */
  shortcut?: string;
  /** 搜索别名 */
  keywords?: string[];
  handler: (ctx: PluginContext) => void | Promise<void>;
}

// ============ 插件上下文 ============

export interface PluginContext {
  /** 当前用户 ID */
  userId: string;
  /** 获取当前阅读条目 */
  getCurrentItem: () => ReadingItem | null;
  /** 获取插件配置 */
  getConfig: <T = Record<string, unknown>>() => T;
  /** 更新插件配置 */
  setConfig: (config: Record<string, unknown>) => Promise<void>;
  /** 显示通知 */
  notify: (message: string, type?: "info" | "success" | "error") => void;
  /** 当前笔记，仅在 note-block 场景可用 */
  getCurrentNote?: () => Pick<Note, "id" | "title" | "content"> | null;
  /** 当前编辑器块，仅在 note-block 场景可用 */
  getCurrentBlock?: () => EditorBlockContext | null;
  /**
   * 注册命令到命令面板。插件停用时自动注销（Obsidian register* 语义），
   * 无需插件自行清理。
   */
  registerCommand?: (command: CommandContribution) => void;
  /** 订阅应用事件。插件停用时自动退订，无需插件自行清理。 */
  onAppEvent?: <K extends AppEventName>(
    event: K,
    handler: (payload: AppEventMap[K]) => void
  ) => void;
}

// ============ 插件配置 ============

export interface PluginConfig {
  [key: string]: unknown;
}

export interface PluginConfigField {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "select" | "textarea";
  default?: unknown;
  options?: { label: string; value: string }[];
  placeholder?: string;
  required?: boolean;
}

// ============ 扩展点类型 ============

/** 工具栏操作按钮 */
export interface ToolbarActionExtension {
  type: "toolbar-action";
  id: string;
  label: string;
  icon: string;
  handler: (ctx: PluginContext) => void | Promise<void>;
  supports?: ("reading" | "note-block")[];
}

/** 侧边栏面板 */
export interface SidebarPanelExtension {
  type: "sidebar-panel";
  id: string;
  label: string;
  icon: string;
  component: ComponentType<{ ctx: PluginContext }>;
}

/** 内容处理器（抓取后处理） */
export interface ContentProcessorExtension {
  type: "content-processor";
  id: string;
  label: string;
  handler: (
    result: ScrapeResult,
    ctx: PluginContext
  ) => ScrapeResult | Promise<ScrapeResult>;
}

/** AI 操作 */
export interface AIActionExtension {
  type: "ai-action";
  id: string;
  label: string;
  icon: string;
  handler: (text: string, ctx: PluginContext) => string | Promise<string>;
  supports?: ("reading" | "note-block")[];
}

export type PluginExtension =
  | ToolbarActionExtension
  | SidebarPanelExtension
  | ContentProcessorExtension
  | AIActionExtension;

// ============ 插件主接口 ============

export interface OrganizePlugin {
  /** 插件唯一标识 */
  id: string;
  /** 插件名称 */
  name: string;
  /** 版本号 */
  version: string;
  /** 插件描述 */
  description: string;
  /** 作者 */
  author?: string;
  /** 插件图标 (emoji 或 URL) */
  icon?: string;
  /** 配置字段定义 */
  configFields?: PluginConfigField[];
  /** 插件提供的功能扩展 */
  extensions: PluginExtension[];
  /** 安装时调用 */
  onInstall?: (config: PluginConfig) => Promise<void>;
  /** 激活时调用 */
  onActivate?: (ctx: PluginContext) => void;
  /** 停用时调用 */
  onDeactivate?: () => void;
}

// ============ 辅助函数 ============

export function definePlugin(plugin: OrganizePlugin): OrganizePlugin {
  return plugin;
}
